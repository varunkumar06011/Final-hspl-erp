import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { getStorageService } from './storage.service';
import type { LinkedFile } from './linked-files.service';

type ProofFile = LinkedFile & { filePath: string };

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 36;
const CAPTION_H = 34;

const STAGE_LABEL: Record<string, string> = {
  MPR: 'Material request',
  QUOTATION: 'Quotation',
  PO: 'Purchase order',
  GOODS_RECEIPT: 'Goods receipt',
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
};

// pdf-lib's standard fonts only draw WinAnsi characters; anything else would throw.
const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');

/**
 * The PO document followed by every proof file of its chain (MPR bill, quotation copy,
 * photos, receipts, invoice scan, payment proof) merged into one PDF. Images get a page
 * each, PDFs are appended page by page. Word/Excel files cannot be merged and are skipped.
 */
export async function buildPoWithProof(
  poPdf: Buffer,
  files: ProofFile[]
): Promise<{ pdf: Buffer; included: number; skipped: string[] }> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  const po = await PDFDocument.load(poPdf);
  (await out.copyPages(po, po.getPageIndices())).forEach((p) => out.addPage(p));

  const storage = getStorageService();
  const skipped: string[] = [];
  let included = 0;

  const caption = (page: ReturnType<typeof out.addPage>, f: ProofFile, n: number, pageNo?: number) => {
    const label = `${STAGE_LABEL[f.recordType] ?? f.recordType}${f.recordLabel ? ` ${f.recordLabel}` : ''}`;
    page.drawText(safe(`Proof ${n}: ${label}${pageNo ? ` (page ${pageNo})` : ''}`), {
      x: MARGIN, y: PAGE_H - MARGIN - 8, size: 11, font: bold, color: rgb(0.06, 0.3, 0.3),
    });
    const meta = [f.fileName, f.description, f.uploadedBy?.name].filter(Boolean).join('  |  ');
    page.drawText(safe(meta).slice(0, 110), {
      x: MARGIN, y: PAGE_H - MARGIN - 22, size: 8.5, font, color: rgb(0.35, 0.35, 0.35),
    });
  };

  for (const f of files) {
    const mime = (f.mimeType ?? '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(f.fileName);
    const isImg = mime.startsWith('image/');
    if (!isPdf && !isImg) {
      skipped.push(f.fileName);
      continue;
    }
    try {
      const buf = await storage.getFile(f.filePath);
      const n = included + 1;
      if (isPdf) {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p, i) => {
          out.addPage(p);
          // Stamp a small label in the top margin so each page says which record it belongs to.
          const { height } = p.getSize();
          p.drawText(safe(`Proof ${n}: ${STAGE_LABEL[f.recordType] ?? f.recordType} ${f.recordLabel} - ${f.fileName} (page ${i + 1}/${pages.length})`).slice(0, 120), {
            x: 8, y: height - 10, size: 7, font, color: rgb(0.06, 0.3, 0.3),
          });
        });
      } else {
        // Normalise any format (HEIC/WebP/PNG/JPEG) and the camera's EXIF rotation to JPEG.
        const jpeg = await sharp(buf).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
        const img = await out.embedJpg(jpeg);
        const page = out.addPage([PAGE_W, PAGE_H]);
        caption(page, f, n);
        const maxW = PAGE_W - MARGIN * 2;
        const maxH = PAGE_H - MARGIN * 2 - CAPTION_H;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (PAGE_W - w) / 2, y: PAGE_H - MARGIN - CAPTION_H - h, width: w, height: h });
      }
      included += 1;
    } catch (err) {
      console.error('[PO proof] could not add', f.fileName, err);
      skipped.push(f.fileName);
    }
  }

  return { pdf: Buffer.from(await out.save()), included, skipped };
}
