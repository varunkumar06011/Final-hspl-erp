import { Permission, hasPermission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

/**
 * Files across a procurement chain: MPR -> quotation -> PO -> goods receipt /
 * invoice -> payment request. Opening any record shows its own files, the files
 * of every record it came from (ancestors) and of everything raised from it
 * (descendants), so a photo added on the MPR is visible on the quotation, PO,
 * invoice and payment without being copied. Computed live from the database.
 */

export type ChainType = 'MPR' | 'QUOTATION' | 'PO' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT';

const TYPE_ALIASES: Record<string, ChainType> = {
  MATERIAL_PURCHASE_REQUEST: 'MPR',
  MPR: 'MPR',
  QUOTATION: 'QUOTATION',
  PURCHASE_ORDER: 'PO',
  PO: 'PO',
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  VENDOR_INVOICE: 'INVOICE',
  INVOICE: 'INVOICE',
  PAYMENT_REQUEST: 'PAYMENT',
  PAYMENT: 'PAYMENT',
};

/** Attachment.entityType values stored for each chain type. */
const ATTACHMENT_TYPES: Record<ChainType, string[]> = {
  MPR: ['MATERIAL_PURCHASE_REQUEST'],
  QUOTATION: ['QUOTATION'],
  PO: ['PURCHASE_ORDER'],
  GOODS_RECEIPT: ['GOODS_RECEIPT'],
  INVOICE: ['VENDOR_INVOICE', 'INVOICE'],
  PAYMENT: ['PAYMENT_REQUEST'],
};

const PERMISSION: Record<ChainType, Permission> = {
  MPR: Permission.VIEW_MPR,
  QUOTATION: Permission.VIEW_FINANCIALS,
  PO: Permission.VIEW_FINANCIALS,
  GOODS_RECEIPT: Permission.VIEW_FINANCIALS,
  INVOICE: Permission.VIEW_FINANCIALS,
  PAYMENT: Permission.VIEW_FINANCIALS,
};

export function chainTypeOf(entityType: string): ChainType | undefined {
  return TYPE_ALIASES[entityType.toUpperCase()];
}

export interface LinkedFile {
  key: string;
  source: 'ATTACHMENT' | 'RECORD';
  /** Id to pass to `fileRoute` (attachment id, or the owning record id) */
  id: string;
  fileName: string;
  mimeType: string | null;
  fileType: 'IMAGE' | 'DOCUMENT';
  description: string | null;
  uploadedBy: { id: string; name: string } | null;
  uploadedAt: Date;
  recordType: ChainType;
  recordId: string;
  recordLabel: string;
  /** True when the file belongs to the record that was asked for. */
  own: boolean;
  /** API path (under /api) that serves the file */
  fileRoute: string;
  canDelete: boolean;
  deleteRoute?: string;
}

export interface Ids {
  MPR: Set<string>;
  QUOTATION: Set<string>;
  PO: Set<string>;
  GOODS_RECEIPT: Set<string>;
  INVOICE: Set<string>;
  PAYMENT: Set<string>;
}

const isImage = (m?: string | null) => !!m && m.startsWith('image/');
const userSelect = { select: { id: true, name: true } } as const;

/** Ids of the record, everything it came from, and everything raised from it. */
export async function resolveChain(projectId: string, type: ChainType, id: string): Promise<Ids | null> {
  const ids: Ids = {
    MPR: new Set(),
    QUOTATION: new Set(),
    PO: new Set(),
    GOODS_RECEIPT: new Set(),
    INVOICE: new Set(),
    PAYMENT: new Set(),
  };
  const where = (extra: Record<string, unknown> = {}) => ({ projectId, deletedAt: null, ...extra });

  // ── Ancestors ──
  let payment: { invoiceId: string | null; poId: string | null } | null = null;
  if (type === 'PAYMENT') {
    payment = await prisma.paymentRequest.findFirst({ where: where({ id }), select: { invoiceId: true, poId: true } });
    if (!payment) return null;
    ids.PAYMENT.add(id);
  }
  let invoicePoId: string | null = null;
  const invoiceId = type === 'INVOICE' ? id : payment?.invoiceId ?? null;
  if (invoiceId) {
    const inv = await prisma.vendorInvoice.findFirst({ where: where({ id: invoiceId }), select: { poId: true } });
    if (!inv) return type === 'INVOICE' ? null : ids.PAYMENT.size ? ids : null;
    ids.INVOICE.add(invoiceId);
    invoicePoId = inv.poId;
  }
  let grPoId: string | null = null;
  if (type === 'GOODS_RECEIPT') {
    const gr = await prisma.goodsReceipt.findFirst({ where: where({ id }), select: { poId: true } });
    if (!gr) return null;
    ids.GOODS_RECEIPT.add(id);
    grPoId = gr.poId;
  }
  const poId = type === 'PO' ? id : invoicePoId ?? grPoId ?? payment?.poId ?? null;
  let quotationId: string | null = type === 'QUOTATION' ? id : null;
  let mprId: string | null = type === 'MPR' ? id : null;
  if (poId) {
    const po = await prisma.purchaseOrder.findFirst({ where: where({ id: poId }), select: { quotationId: true, mprId: true } });
    if (!po) return type === 'PO' ? null : ids;
    ids.PO.add(poId);
    quotationId = po.quotationId;
    mprId = po.mprId;
  }
  if (quotationId) {
    const q = await prisma.quotation.findFirst({ where: where({ id: quotationId }), select: { mprId: true } });
    if (!q) return type === 'QUOTATION' ? null : ids;
    ids.QUOTATION.add(quotationId);
    mprId = q.mprId ?? mprId;
  }
  if (mprId) {
    const m = await prisma.materialPurchaseRequest.findFirst({ where: where({ id: mprId }), select: { id: true } });
    if (!m) return type === 'MPR' ? null : ids;
    ids.MPR.add(mprId);
  }

  // ── Descendants ──
  if (type === 'MPR') {
    const [qs, pos] = await Promise.all([
      prisma.quotation.findMany({ where: where({ mprId: id }), select: { id: true } }),
      prisma.purchaseOrder.findMany({ where: where({ mprId: id }), select: { id: true } }),
    ]);
    qs.forEach((r) => ids.QUOTATION.add(r.id));
    pos.forEach((r) => ids.PO.add(r.id));
  }
  if (type === 'MPR' || type === 'QUOTATION') {
    const pos = await prisma.purchaseOrder.findMany({
      where: where({ quotationId: { in: [...ids.QUOTATION] } }),
      select: { id: true },
    });
    pos.forEach((r) => ids.PO.add(r.id));
  }
  if (type === 'MPR' || type === 'QUOTATION' || type === 'PO') {
    const po = [...ids.PO];
    const [grs, invs] = await Promise.all([
      prisma.goodsReceipt.findMany({ where: where({ poId: { in: po } }), select: { id: true } }),
      prisma.vendorInvoice.findMany({ where: where({ poId: { in: po } }), select: { id: true } }),
    ]);
    grs.forEach((r) => ids.GOODS_RECEIPT.add(r.id));
    invs.forEach((r) => ids.INVOICE.add(r.id));
  }
  if (type !== 'PAYMENT' && type !== 'GOODS_RECEIPT') {
    // Payments hang off the PO (advances) or an invoice. Only the opened record and what was
    // raised from it count, so an invoice never picks up a sibling invoice's payments.
    const downstream = type === 'MPR' || type === 'QUOTATION' || type === 'PO';
    const or: Record<string, unknown>[] = [{ invoiceId: { in: [...ids.INVOICE] } }];
    if (downstream) or.push({ poId: { in: [...ids.PO] } });
    const pays = await prisma.paymentRequest.findMany({ where: where({ OR: or }), select: { id: true } });
    pays.forEach((r) => ids.PAYMENT.add(r.id));
  }
  return ids;
}

export async function listLinkedFiles(
  projectId: string,
  role: string,
  entityType: string,
  entityId: string
): Promise<LinkedFile[] | null> {
  const type = chainTypeOf(entityType);
  if (!type) return null;
  const ids = await resolveChain(projectId, type, entityId);
  if (!ids) return null;

  const can = (t: ChainType) => hasPermission(role, PERMISSION[t]);
  const visible = (Object.keys(ids) as ChainType[]).filter((t) => ids[t].size > 0 && can(t));

  // Labels for every record in the chain
  const labels = new Map<string, string>();
  const [mprs, qs, pos, grs, invs, pays] = await Promise.all([
    can('MPR') && ids.MPR.size
      ? prisma.materialPurchaseRequest.findMany({ where: { id: { in: [...ids.MPR] } }, select: { id: true, mprNumber: true, receiptFilePath: true, receiptFileName: true, receiptFileMimeType: true, createdAt: true, createdByUser: userSelect } })
      : [],
    can('QUOTATION') && ids.QUOTATION.size
      ? prisma.quotation.findMany({ where: { id: { in: [...ids.QUOTATION] } }, select: { id: true, quotationNumber: true, filePath: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect } })
      : [],
    can('PO') && ids.PO.size ? prisma.purchaseOrder.findMany({ where: { id: { in: [...ids.PO] } }, select: { id: true, poNumber: true } }) : [],
    can('GOODS_RECEIPT') && ids.GOODS_RECEIPT.size ? prisma.goodsReceipt.findMany({ where: { id: { in: [...ids.GOODS_RECEIPT] } }, select: { id: true, receiptNumber: true } }) : [],
    can('INVOICE') && ids.INVOICE.size
      ? prisma.vendorInvoice.findMany({ where: { id: { in: [...ids.INVOICE] } }, select: { id: true, invoiceCode: true, filePath: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect } })
      : [],
    can('PAYMENT') && ids.PAYMENT.size
      ? prisma.paymentRequest.findMany({ where: { id: { in: [...ids.PAYMENT] } }, select: { id: true, paymentCode: true, filePath: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect } })
      : [],
  ]);
  mprs.forEach((r) => labels.set(`MPR:${r.id}`, r.mprNumber));
  qs.forEach((r) => labels.set(`QUOTATION:${r.id}`, r.quotationNumber));
  pos.forEach((r) => labels.set(`PO:${r.id}`, r.poNumber));
  grs.forEach((r) => labels.set(`GOODS_RECEIPT:${r.id}`, r.receiptNumber));
  invs.forEach((r) => labels.set(`INVOICE:${r.id}`, r.invoiceCode));
  pays.forEach((r) => labels.set(`PAYMENT:${r.id}`, r.paymentCode));

  const out: LinkedFile[] = [];
  const isOwn = (t: ChainType, id: string) => t === type && id === entityId;

  // ── Generic attachments (any number per record) ──
  const attachmentTypeToChain = new Map<string, ChainType>();
  for (const t of visible) for (const a of ATTACHMENT_TYPES[t]) attachmentTypeToChain.set(a, t);
  if (attachmentTypeToChain.size) {
    const rows = await prisma.attachment.findMany({
      where: {
        projectId,
        OR: visible.map((t) => ({ entityType: { in: ATTACHMENT_TYPES[t] }, entityId: { in: [...ids[t]] } })),
      },
      include: { user: userSelect },
      orderBy: { createdAt: 'desc' },
    });
    for (const a of rows) {
      const t = attachmentTypeToChain.get(a.entityType);
      if (!t) continue;
      out.push({
        key: `ATTACHMENT:${a.id}`,
        source: 'ATTACHMENT',
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileType: a.fileType === 'IMAGE' ? 'IMAGE' : 'DOCUMENT',
        description: a.description,
        uploadedBy: a.user,
        uploadedAt: a.createdAt,
        recordType: t,
        recordId: a.entityId,
        recordLabel: labels.get(`${t}:${a.entityId}`) ?? '',
        own: isOwn(t, a.entityId),
        fileRoute: `/attachments/${a.id}/file`,
        canDelete: true,
        deleteRoute: `/attachments/${a.id}`,
      });
    }
  }

  // ── The single file stored directly on a record (quotation copy, invoice scan, ...) ──
  const direct = (
    t: ChainType,
    r: { id: string; createdAt: Date; createdByUser: { id: string; name: string } },
    fileName: string | null,
    mimeType: string | null,
    route: string
  ) => {
    out.push({
      key: `RECORD:${t}:${r.id}`,
      source: 'RECORD',
      id: r.id,
      fileName: fileName ?? 'file',
      mimeType,
      fileType: isImage(mimeType) ? 'IMAGE' : 'DOCUMENT',
      description: null,
      uploadedBy: r.createdByUser,
      uploadedAt: r.createdAt,
      recordType: t,
      recordId: r.id,
      recordLabel: labels.get(`${t}:${r.id}`) ?? '',
      own: isOwn(t, r.id),
      fileRoute: route,
      canDelete: false,
    });
  };
  for (const r of mprs) if (r.receiptFilePath) direct('MPR', r, r.receiptFileName, r.receiptFileMimeType, `/material-purchase-requests/${r.id}/receipt`);
  for (const r of qs) if (r.filePath) direct('QUOTATION', r, r.fileName, r.fileMimeType, `/quotations/${r.id}/file`);
  for (const r of invs) if (r.filePath) direct('INVOICE', r, r.fileName, r.fileMimeType, `/invoices/${r.id}/file`);
  for (const r of pays) if (r.filePath) direct('PAYMENT', r, r.fileName, r.fileMimeType, `/payments/${r.id}/file`);

  // Own files first, then by stage order, newest first within a stage.
  const stage: ChainType[] = ['MPR', 'QUOTATION', 'PO', 'GOODS_RECEIPT', 'INVOICE', 'PAYMENT'];
  out.sort(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      stage.indexOf(a.recordType) - stage.indexOf(b.recordType) ||
      b.uploadedAt.getTime() - a.uploadedAt.getTime()
  );
  return out;
}
