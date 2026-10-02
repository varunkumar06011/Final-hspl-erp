import { Permission, hasPermission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

/**
 * Document library: one read-only view over every file a person uploaded,
 * wherever it was stored (generic attachments, the file on a quotation /
 * invoice / payment request / payment sheet, an MPR receipt, standalone
 * documents). App-generated PDFs are never stored, so they never appear here.
 *
 * Each file is reported with the record it belongs to (type, number, link).
 */

export type LibraryCategory =
  | 'PURCHASE_ORDER'
  | 'QUOTATION'
  | 'INVOICE'
  | 'PAYMENT'
  | 'VOUCHER'
  | 'MPR'
  | 'VENDOR'
  | 'GOODS_RECEIPT'
  | 'GATE_PASS'
  | 'CONTRACT'
  | 'INVENTORY'
  | 'OTHER'
  | 'GENERAL';

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  'PURCHASE_ORDER',
  'QUOTATION',
  'INVOICE',
  'PAYMENT',
  'VOUCHER',
  'MPR',
  'VENDOR',
  'GOODS_RECEIPT',
  'GATE_PASS',
  'CONTRACT',
  'INVENTORY',
  'OTHER',
  'GENERAL',
];

interface LinkKind {
  category: LibraryCategory;
  /** Prisma delegate name */
  model: string;
  /** Attachment.entityType values that point at this model */
  attachmentTypes: string[];
  /** Columns searched / shown to name the record (first non-empty wins) */
  labelFields: string[];
  path: string;
  permission?: Permission;
  /** Extra Prisma include (e.g. vendor name for contracts) */
  include?: Record<string, unknown>;
  label?: (row: Record<string, any>) => string; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const LINK_KINDS: LinkKind[] = [
  { category: 'PURCHASE_ORDER', model: 'purchaseOrder', attachmentTypes: ['PURCHASE_ORDER'], labelFields: ['poNumber'], path: '/pos', permission: Permission.VIEW_FINANCIALS },
  { category: 'QUOTATION', model: 'quotation', attachmentTypes: ['QUOTATION'], labelFields: ['quotationNumber'], path: '/quotations', permission: Permission.VIEW_FINANCIALS },
  { category: 'INVOICE', model: 'vendorInvoice', attachmentTypes: ['VENDOR_INVOICE', 'INVOICE'], labelFields: ['invoiceCode', 'invoiceNumber'], path: '/invoices', permission: Permission.VIEW_FINANCIALS },
  { category: 'PAYMENT', model: 'paymentRequest', attachmentTypes: ['PAYMENT_REQUEST'], labelFields: ['paymentCode', 'requestNumber'], path: '/payments', permission: Permission.VIEW_FINANCIALS },
  { category: 'VOUCHER', model: 'journalVoucher', attachmentTypes: ['VOUCHER', 'JOURNAL_VOUCHER'], labelFields: ['jvNumber'], path: '/vouchers', permission: Permission.VIEW_FINANCIALS },
  { category: 'MPR', model: 'materialPurchaseRequest', attachmentTypes: ['MATERIAL_PURCHASE_REQUEST'], labelFields: ['mprNumber'], path: '/material-purchase-requests', permission: Permission.VIEW_MPR },
  { category: 'VENDOR', model: 'vendor', attachmentTypes: ['VENDOR'], labelFields: ['name', 'vendorCode'], path: '/vendors', permission: Permission.VIEW_FINANCIALS },
  { category: 'GOODS_RECEIPT', model: 'goodsReceipt', attachmentTypes: ['GOODS_RECEIPT'], labelFields: ['receiptNumber'], path: '/goods-receipts', permission: Permission.VIEW_FINANCIALS },
  { category: 'GATE_PASS', model: 'gatePass', attachmentTypes: ['GATE_PASS'], labelFields: ['passNumber'], path: '/gate-passes', permission: Permission.VIEW_GATE_PASSES },
  {
    category: 'CONTRACT',
    model: 'contract',
    attachmentTypes: ['CONTRACT'],
    labelFields: [],
    path: '/contracts',
    permission: Permission.VIEW_FINANCIALS,
    include: { vendor: { select: { name: true } } },
    label: (r) => `Contract – ${r.vendor?.name ?? r.id.slice(0, 8)}`,
  },
  { category: 'INVENTORY', model: 'inventoryItem', attachmentTypes: ['INVENTORY_ITEM'], labelFields: ['name', 'sku'], path: '/assets' },
];

/** Record types a file can be uploaded against from the library. */
export const UPLOAD_TARGETS = LINK_KINDS.map((k) => k.category);

const KIND_BY_CATEGORY = new Map(LINK_KINDS.map((k) => [k.category, k]));
const KIND_BY_ATTACHMENT_TYPE = new Map(LINK_KINDS.flatMap((k) => k.attachmentTypes.map((t) => [t, k] as const)));

export function kindForCategory(category: string): LinkKind | undefined {
  return KIND_BY_CATEGORY.get(category as LibraryCategory);
}

/** Attachment.entityType to store when a file is uploaded against this category. */
export function attachmentTypeFor(category: LibraryCategory): string | undefined {
  return KIND_BY_CATEGORY.get(category)?.attachmentTypes[0];
}

function labelOf(kind: LinkKind, row: Record<string, any>): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (kind.label) return kind.label(row);
  for (const f of kind.labelFields) if (row[f]) return String(row[f]);
  return String(row.id).slice(0, 8);
}

function pathFor(kind: LinkKind, id: string): string {
  return kind.category === 'INVENTORY' ? `${kind.path}/${id}` : `${kind.path}?id=${id}`;
}

function delegate(model: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return (prisma as any)[model]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface LibraryItem {
  key: string;
  source: string;
  id: string;
  fileName: string;
  mimeType: string | null;
  fileType: 'IMAGE' | 'DOCUMENT';
  description: string | null;
  uploadedBy: { id: string; name: string } | null;
  uploadedAt: Date;
  category: LibraryCategory;
  linkedId: string | null;
  linkedLabel: string | null;
  linkedPath: string | null;
  /** API path (under /api) that serves the file */
  fileRoute: string;
  canDelete: boolean;
  /** API path (under /api) that deletes the file, when the library may delete it */
  deleteRoute?: string;
}

export interface LibraryFilters {
  category?: string;
  fileType?: string;
  uploadedBy?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

const PER_SOURCE_CAP = 3000;
const userSelect = { select: { id: true, name: true } } as const;

const isImageMime = (m?: string | null) => !!m && m.startsWith('image/');

/** Label + link for the records a batch of attachments points at. */
async function resolveRecords(projectId: string, entries: { kind: LinkKind; ids: string[] }[]) {
  const out = new Map<string, { label: string; path: string }>();
  await Promise.all(
    entries.map(async ({ kind, ids }) => {
      if (ids.length === 0) return;
      const rows = await delegate(kind.model).findMany({
        where: { id: { in: ids }, projectId },
        ...(kind.include ? { include: kind.include } : {}),
      });
      for (const r of rows) out.set(`${kind.category}:${r.id}`, { label: labelOf(kind, r), path: pathFor(kind, r.id) });
    })
  );
  return out;
}

export async function listLibrary(
  projectId: string,
  role: string,
  filters: LibraryFilters
): Promise<LibraryItem[]> {
  const can = (p?: Permission) => !p || hasPermission(role, p);
  const wants = (c: LibraryCategory) => !filters.category || filters.category === c;
  const dateWhere = {
    ...(filters.from ? { gte: filters.from } : {}),
    ...(filters.to ? { lte: filters.to } : {}),
  };
  const hasDate = Object.keys(dateWhere).length > 0;
  const items: LibraryItem[] = [];

  // ── 1. Attachments (files added on a record, or from the library) ──
  {
    const allowedKinds = LINK_KINDS.filter((k) => can(k.permission));
    const known = new Set(LINK_KINDS.flatMap((k) => k.attachmentTypes));
    const typeFilter: Record<string, unknown> = {};
    if (filters.category && filters.category !== 'GENERAL') {
      const kind = KIND_BY_CATEGORY.get(filters.category as LibraryCategory);
      if (kind) typeFilter.entityType = { in: kind.attachmentTypes };
      else if (filters.category === 'OTHER') typeFilter.entityType = { notIn: [...known] };
    }
    // Hide types the viewer may not open (financial records) from other roles.
    const blocked = LINK_KINDS.filter((k) => !can(k.permission)).flatMap((k) => k.attachmentTypes);

    if (filters.category !== 'GENERAL') {
      const rows = await prisma.attachment.findMany({
        where: {
          projectId,
          ...typeFilter,
          ...(blocked.length ? { AND: [{ entityType: { notIn: blocked } }] } : {}),
          ...(filters.fileType ? { fileType: filters.fileType } : {}),
          ...(filters.uploadedBy ? { uploadedBy: filters.uploadedBy } : {}),
          ...(hasDate ? { createdAt: dateWhere } : {}),
        },
        include: { user: userSelect },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE_CAP,
      });

      const idsByKind = new Map<LinkKind, Set<string>>();
      for (const a of rows) {
        const kind = KIND_BY_ATTACHMENT_TYPE.get(a.entityType);
        if (!kind || !allowedKinds.includes(kind)) continue;
        if (!idsByKind.has(kind)) idsByKind.set(kind, new Set());
        idsByKind.get(kind)!.add(a.entityId);
      }
      const resolved = await resolveRecords(
        projectId,
        [...idsByKind].map(([kind, ids]) => ({ kind, ids: [...ids] }))
      );

      for (const a of rows) {
        const kind = KIND_BY_ATTACHMENT_TYPE.get(a.entityType);
        const rec = kind ? resolved.get(`${kind.category}:${a.entityId}`) : undefined;
        items.push({
          key: `ATTACHMENT:${a.id}`,
          source: 'ATTACHMENT',
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileType: a.fileType === 'IMAGE' ? 'IMAGE' : 'DOCUMENT',
          description: a.description,
          uploadedBy: a.user,
          uploadedAt: a.createdAt,
          category: kind?.category ?? 'OTHER',
          linkedId: kind ? a.entityId : null,
          linkedLabel: rec?.label ?? (kind ? null : a.entityType),
          linkedPath: rec?.path ?? null,
          fileRoute: `/attachments/${a.id}/file`,
          canDelete: true,
          deleteRoute: `/attachments/${a.id}`,
        });
      }
    }
  }

  // ── 2. File stored directly on a record ──
  const sourceCommon = {
    projectId,
    deletedAt: null,
    ...(hasDate ? { createdAt: dateWhere } : {}),
    ...(filters.uploadedBy ? { createdBy: filters.uploadedBy } : {}),
  };
  const take = PER_SOURCE_CAP;

  if (wants('QUOTATION') && can(Permission.VIEW_FINANCIALS)) {
    const rows = await prisma.quotation.findMany({
      where: { ...sourceCommon, filePath: { not: null } },
      select: { id: true, quotationNumber: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect },
      orderBy: { createdAt: 'desc' },
      take,
    });
    for (const r of rows) {
      items.push(recordFile('QUOTATION', 'QUOTATION', r.id, r.quotationNumber, '/quotations', `/quotations/${r.id}/file`, r.fileName, r.fileMimeType, r.createdAt, r.createdByUser));
    }
  }
  if (wants('INVOICE') && can(Permission.VIEW_FINANCIALS)) {
    const rows = await prisma.vendorInvoice.findMany({
      where: { ...sourceCommon, filePath: { not: null } },
      select: { id: true, invoiceCode: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect },
      orderBy: { createdAt: 'desc' },
      take,
    });
    for (const r of rows) {
      items.push(recordFile('INVOICE', 'INVOICE', r.id, r.invoiceCode, '/invoices', `/invoices/${r.id}/file`, r.fileName, r.fileMimeType, r.createdAt, r.createdByUser));
    }
  }
  if (wants('PAYMENT') && can(Permission.VIEW_FINANCIALS)) {
    const [reqs, sheets] = await Promise.all([
      prisma.paymentRequest.findMany({
        where: { ...sourceCommon, filePath: { not: null } },
        select: { id: true, paymentCode: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      prisma.paymentSheet.findMany({
        where: { ...sourceCommon, filePath: { not: null } },
        select: { id: true, fileName: true, fileMimeType: true, createdAt: true, createdByUser: userSelect },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);
    for (const r of reqs) {
      items.push(recordFile('PAYMENT_REQUEST', 'PAYMENT', r.id, r.paymentCode, '/payments', `/payments/${r.id}/file`, r.fileName, r.fileMimeType, r.createdAt, r.createdByUser));
    }
    for (const r of sheets) {
      items.push(recordFile('PAYMENT_SHEET', 'PAYMENT', r.id, 'Payment sheet', '/payments', `/payment-sheets/${r.id}/file`, r.fileName, r.fileMimeType, r.createdAt, r.createdByUser));
    }
  }
  if (wants('MPR') && can(Permission.VIEW_MPR)) {
    const rows = await prisma.materialPurchaseRequest.findMany({
      where: { ...sourceCommon, receiptFilePath: { not: null } },
      select: { id: true, mprNumber: true, receiptFileName: true, receiptFileMimeType: true, createdAt: true, createdByUser: userSelect },
      orderBy: { createdAt: 'desc' },
      take,
    });
    for (const r of rows) {
      items.push(recordFile('MPR_RECEIPT', 'MPR', r.id, r.mprNumber, '/material-purchase-requests', `/material-purchase-requests/${r.id}/receipt`, r.receiptFileName, r.receiptFileMimeType, r.createdAt, r.createdByUser));
    }
  }

  // ── 3. Standalone documents (not tied to a record) ──
  if (wants('GENERAL')) {
    const rows = await prisma.document.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(hasDate ? { createdAt: dateWhere } : {}),
        ...(filters.uploadedBy ? { uploadedBy: filters.uploadedBy } : {}),
      },
      include: { uploadedByUser: userSelect },
      orderBy: { createdAt: 'desc' },
      take,
    });
    for (const d of rows) {
      items.push({
        key: `DOCUMENT:${d.id}`,
        source: 'DOCUMENT',
        id: d.id,
        fileName: d.fileName,
        mimeType: d.mimeType,
        fileType: isImageMime(d.mimeType) ? 'IMAGE' : 'DOCUMENT',
        description: d.description ? `${d.name} – ${d.description}` : d.name,
        uploadedBy: d.uploadedByUser,
        uploadedAt: d.createdAt,
        category: 'GENERAL',
        linkedId: null,
        linkedLabel: null,
        linkedPath: null,
        fileRoute: `/documents/${d.id}/file`,
        canDelete: true,
        deleteRoute: `/documents/${d.id}`,
      });
    }
  }

  const q = filters.search?.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (filters.fileType && i.fileType !== filters.fileType) return false;
    if (!q) return true;
    return [i.fileName, i.description, i.linkedLabel, i.uploadedBy?.name]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
  filtered.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  return filtered;
}

function recordFile(
  source: string,
  category: LibraryCategory,
  id: string,
  label: string,
  basePath: string,
  fileRoute: string,
  fileName: string | null,
  mimeType: string | null,
  uploadedAt: Date,
  uploadedBy: { id: string; name: string } | null
): LibraryItem {
  return {
    key: `${source}:${id}`,
    source,
    id,
    fileName: fileName ?? 'file',
    mimeType,
    fileType: isImageMime(mimeType) ? 'IMAGE' : 'DOCUMENT',
    description: null,
    uploadedBy,
    uploadedAt,
    category,
    linkedId: id,
    linkedLabel: label,
    linkedPath: `${basePath}?id=${id}`,
    fileRoute,
    canDelete: false,
  };
}

/** Records a file can be attached to, for the upload picker. */
export async function searchLinkTargets(projectId: string, role: string, category: string, q: string) {
  const kind = kindForCategory(category);
  if (!kind || (kind.permission && !hasPermission(role, kind.permission))) return null;
  const term = q.trim();
  const where: Record<string, unknown> = { projectId, deletedAt: null };
  if (term && kind.labelFields.length) {
    where.OR = kind.labelFields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } }));
  }
  const rows = await delegate(kind.model).findMany({
    where,
    ...(kind.include ? { include: kind.include } : {}),
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  return rows.map((r: Record<string, unknown> & { id: string }) => ({ id: r.id, label: labelOf(kind, r) }));
}

/** True when the record exists in this project (and the viewer may attach to it). */
export async function linkTargetExists(projectId: string, role: string, category: string, id: string) {
  const kind = kindForCategory(category);
  if (!kind || (kind.permission && !hasPermission(role, kind.permission))) return false;
  const row = await delegate(kind.model).findFirst({ where: { id, projectId, deletedAt: null }, select: { id: true } });
  return !!row;
}
