import { PassThrough } from 'stream';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { Permission, hasPermission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { mprInclude } from '../routes/mpr.routes';
import { getStorageService } from './storage.service';
import { streamMprPdf } from './mpr-pdf.service';
import { streamQuotationPdf } from './quotation-pdf.service';
import { streamPurchaseOrderPdf } from './purchase-order-pdf.service';
import { listLinkedFiles, resolveChain, withStoragePaths, type ChainType } from './linked-files.service';
import { resolveRoot, type RootType } from './combined-records.service';

/**
 * Proofs of a combined record: everything a person needs to see before paying.
 *  - GENERATED: the PDFs the system makes itself (request, quotation, approved PO).
 *  - UPLOADED:  files people attached (bill photos, vendor quotation copy, invoice scan,
 *               payment proof...), from every record of the chain.
 * The same list drives the thumbnails on screen and the merged print/download PDF.
 */

export type ProofFormat = 'image' | 'pdf' | 'other';

export interface ProofItem {
  /** Stable id: `GEN:<stage>:<recordId>` or `UP:<linked file key>`. */
  key: string;
  kind: 'GENERATED' | 'UPLOADED';
  stage: ChainType;
  recordLabel: string;
  fileName: string;
  mimeType: string | null;
  format: ProofFormat;
  description: string | null;
  uploadedBy: string | null;
  uploadedAt: Date | null;
  /** API path (under /api) that serves the file / generates the PDF. */
  viewRoute: string;
}

type Internal = ProofItem & { filePath?: string; genStage?: 'MPR' | 'QUOTATION' | 'PO'; genId?: string };

const ENTITY: Record<RootType, string> = {
  mpr: 'MATERIAL_PURCHASE_REQUEST',
  quotation: 'QUOTATION',
  po: 'PURCHASE_ORDER',
};

/** A PO document is only issued once approved (same rule as GET /purchase-orders/:id/pdf). */
const PO_PDF_STATUSES = ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'];

export const MAX_PROOF_KEYS = 80;

export function proofFormatOf(mime: string | null | undefined, fileName: string): ProofFormat {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$/i.test(fileName)) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'pdf';
  return 'other';
}

async function collect(
  projectId: string,
  role: string,
  type: string,
  id: string
): Promise<Internal[] | null> {
  const root = await resolveRoot(projectId, type, id);
  if (!root) return null;
  const items: Internal[] = [];

  // ── System generated PDFs ──
  const ids = await resolveChain(projectId, root.type === 'mpr' ? 'MPR' : root.type === 'quotation' ? 'QUOTATION' : 'PO', root.id);
  if (ids) {
    const fin = hasPermission(role, Permission.VIEW_FINANCIALS);
    const live = { projectId, deletedAt: null };
    const [mprs, qs, pos] = await Promise.all([
      hasPermission(role, Permission.VIEW_MPR) && ids.MPR.size
        ? prisma.materialPurchaseRequest.findMany({ where: { ...live, id: { in: [...ids.MPR] } }, select: { id: true, mprNumber: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
        : [],
      fin && ids.QUOTATION.size
        ? prisma.quotation.findMany({ where: { ...live, id: { in: [...ids.QUOTATION] }, status: { not: 'DELETED' } }, select: { id: true, quotationNumber: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
        : [],
      fin && ids.PO.size
        ? prisma.purchaseOrder.findMany({ where: { ...live, id: { in: [...ids.PO] }, status: { in: PO_PDF_STATUSES as never[] } }, select: { id: true, poNumber: true, createdAt: true }, orderBy: { createdAt: 'asc' } })
        : [],
    ]);
    const gen = (stage: 'MPR' | 'QUOTATION' | 'PO', rid: string, label: string, route: string) =>
      items.push({
        key: `GEN:${stage}:${rid}`,
        kind: 'GENERATED',
        stage,
        recordLabel: label,
        fileName: `${label}.pdf`,
        mimeType: 'application/pdf',
        format: 'pdf',
        description: null,
        uploadedBy: null,
        uploadedAt: null,
        viewRoute: route,
        genStage: stage,
        genId: rid,
      });
    mprs.forEach((r) => gen('MPR', r.id, r.mprNumber, `/material-purchase-requests/${r.id}/pdf`));
    qs.forEach((r) => gen('QUOTATION', r.id, r.quotationNumber, `/quotations/${r.id}/pdf`));
    pos.forEach((r) => gen('PO', r.id, r.poNumber, `/purchase-orders/${r.id}/pdf`));
  }

  // ── Uploaded files (already filtered by what the role may see) ──
  const linked = (await listLinkedFiles(projectId, role, ENTITY[root.type], root.id)) ?? [];
  const withPaths = await withStoragePaths(projectId, linked);
  for (const f of withPaths) {
    items.push({
      key: `UP:${f.key}`,
      kind: 'UPLOADED',
      stage: f.recordType,
      recordLabel: f.recordLabel,
      fileName: f.fileName,
      mimeType: f.mimeType,
      format: proofFormatOf(f.mimeType, f.fileName),
      description: f.description,
      uploadedBy: f.uploadedBy?.name ?? null,
      uploadedAt: f.uploadedAt,
      viewRoute: f.fileRoute,
      filePath: f.filePath,
    });
  }
  return items;
}

/** What the screen needs: system PDFs and uploaded files, each in process order. */
export async function listCombinedProofs(projectId: string, role: string, type: string, id: string) {
  const items = await collect(projectId, role, type, id);
  if (!items) return null;
  const pub = items.map(({ filePath: _p, genStage: _s, genId: _g, ...rest }) => rest);
  return {
    generated: pub.filter((i) => i.kind === 'GENERATED'),
    uploaded: pub.filter((i) => i.kind === 'UPLOADED'),
  };
}

// ───────────────────────── merged PDF ─────────────────────────

const STAGE_LABEL: Record<string, string> = {
  MPR: 'Material request',
  QUOTATION: 'Quotation',
  PO: 'Purchase order',
  GOODS_RECEIPT: 'Goods receipt',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
};
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 36;
const CAPTION_H = 34;
// pdf-lib's standard fonts only draw WinAnsi characters; anything else would throw.
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');

async function renderGenerated(projectId: string, stage: 'MPR' | 'QUOTATION' | 'PO', id: string): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    sink.on('end', resolve);
    sink.on('error', reject);
  });
  const where = { id, projectId, deletedAt: null };
  const project = { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } };
  const workflow = {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { name: true, role: true } } },
      },
    },
  };
  if (stage === 'MPR') {
    const mpr = await prisma.materialPurchaseRequest.findFirst({ where, include: { ...mprInclude, project } });
    if (!mpr) throw new Error('Request not found');
    await streamMprPdf(sink, mpr);
  } else if (stage === 'QUOTATION') {
    const q = await prisma.quotation.findFirst({
      where,
      include: { vendor: true, items: true, createdByUser: { select: { name: true } }, approvalWorkflow: workflow, project },
    });
    if (!q) throw new Error('Quotation not found');
    await streamQuotationPdf(sink, q);
  } else {
    const po = await prisma.purchaseOrder.findFirst({
      where,
      include: {
        vendor: true,
        quotation: { select: { quotationNumber: true } },
        contractPo: { select: { poNumber: true, contractTitle: true } },
        parentPo: { select: { poNumber: true } },
        items: true,
        createdByUser: { select: { name: true } },
        approvalWorkflow: workflow,
        project,
      },
    });
    if (!po) throw new Error('Purchase order not found');
    if (!PO_PDF_STATUSES.includes(po.status)) throw new Error('PO not approved');
    await streamPurchaseOrderPdf(sink, po);
  }
  await done;
  return Buffer.concat(chunks);
}

/**
 * The chosen proofs merged into one PDF, in the order of `keys`: system PDFs as they are,
 * uploaded PDFs page by page, images one per page. Word/Excel files cannot be merged and
 * are reported as skipped. Keys the viewer may not see are ignored.
 */
export async function buildCombinedProofPdf(
  projectId: string,
  role: string,
  type: string,
  id: string,
  keys: string[]
): Promise<{ pdf: Buffer; included: number; skipped: string[] } | null> {
  const all = await collect(projectId, role, type, id);
  if (!all) return null;
  const byKey = new Map(all.map((i) => [i.key, i]));

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const storage = getStorageService();
  const skipped: string[] = [];
  let included = 0;

  const label = (i: Internal) => `${STAGE_LABEL[i.stage] ?? i.stage}${i.recordLabel ? ` ${i.recordLabel}` : ''}`;
  const stamp = (page: ReturnType<typeof out.addPage>, i: Internal, n: number, pageNo?: number, total?: number) => {
    const { height } = page.getSize();
    page.drawText(safe(`Proof ${n}: ${label(i)} - ${i.fileName}${pageNo ? ` (page ${pageNo}/${total})` : ''}`).slice(0, 120), {
      x: 8, y: height - 10, size: 7, font, color: rgb(0.06, 0.3, 0.3),
    });
  };

  for (const key of keys) {
    const item = byKey.get(key);
    if (!item) {
      skipped.push(key);
      continue;
    }
    try {
      const n = included + 1;
      let pdfBytes: Buffer | null = null;
      if (item.kind === 'GENERATED') pdfBytes = await renderGenerated(projectId, item.genStage!, item.genId!);
      else if (item.format === 'pdf') pdfBytes = await storage.getFile(item.filePath!);

      if (pdfBytes) {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p, idx) => {
          out.addPage(p);
          stamp(p, item, n, idx + 1, pages.length);
        });
      } else if (item.format === 'image') {
        const buf = await storage.getFile(item.filePath!);
        // Normalise any format (HEIC/WebP/PNG/JPEG) and the camera's EXIF rotation to JPEG.
        const jpeg = await sharp(buf).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
        const img = await out.embedJpg(jpeg);
        const page = out.addPage([PAGE_W, PAGE_H]);
        page.drawText(safe(`Proof ${n}: ${label(item)}`), { x: MARGIN, y: PAGE_H - MARGIN - 8, size: 11, font: bold, color: rgb(0.06, 0.3, 0.3) });
        const meta = [item.fileName, item.description, item.uploadedBy].filter(Boolean).join('  |  ');
        page.drawText(safe(meta).slice(0, 110), { x: MARGIN, y: PAGE_H - MARGIN - 22, size: 8.5, font, color: rgb(0.35, 0.35, 0.35) });
        const scale = Math.min((PAGE_W - MARGIN * 2) / img.width, (PAGE_H - MARGIN * 2 - CAPTION_H) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (PAGE_W - w) / 2, y: PAGE_H - MARGIN - CAPTION_H - h, width: w, height: h });
      } else {
        skipped.push(item.fileName);
        continue;
      }
      included += 1;
    } catch (err) {
      console.error('[combined proofs] could not add', item.fileName, err);
      skipped.push(item.fileName);
    }
  }

  if (included === 0) return { pdf: Buffer.alloc(0), included, skipped };
  return { pdf: Buffer.from(await out.save()), included, skipped };
}
