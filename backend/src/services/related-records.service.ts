import { Permission, hasPermission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { ChainType, Ids, chainTypeOf, resolveChain } from './linked-files.service';

/**
 * Records linked to one procurement record, for the "Related" dropdown in the top bar:
 * MPR -> quotation -> PO -> gate pass / goods receipt / invoice -> payment.
 * Same chain as the linked-files service, plus gate passes. Computed live, read-only.
 */

export type RelatedType = ChainType | 'GATE_PASS';

export interface RelatedItem {
  id: string;
  label: string;
  status: string | null;
  /** In-app route that opens the record (page deep-link `?id=`). */
  path: string;
  /** True for the record that was asked for. */
  own: boolean;
}

export interface RelatedGroup {
  type: RelatedType;
  items: RelatedItem[];
}

const ORDER: RelatedType[] = ['MPR', 'QUOTATION', 'PO', 'GATE_PASS', 'GOODS_RECEIPT', 'INVOICE', 'PAYMENT'];

const PAGE: Record<RelatedType, string> = {
  MPR: '/material-purchase-requests',
  QUOTATION: '/quotations',
  PO: '/pos',
  GATE_PASS: '/gate-passes',
  GOODS_RECEIPT: '/goods-receipts',
  INVOICE: '/invoices',
  PAYMENT: '/payments',
};

const PERMISSION: Record<RelatedType, Permission> = {
  MPR: Permission.VIEW_MPR,
  QUOTATION: Permission.VIEW_FINANCIALS,
  PO: Permission.VIEW_FINANCIALS,
  GATE_PASS: Permission.VIEW_GATE_PASSES,
  GOODS_RECEIPT: Permission.VIEW_FINANCIALS,
  INVOICE: Permission.VIEW_FINANCIALS,
  PAYMENT: Permission.VIEW_FINANCIALS,
};

export function relatedTypeOf(entityType: string): RelatedType | undefined {
  if (entityType.toUpperCase() === 'GATE_PASS') return 'GATE_PASS';
  return chainTypeOf(entityType);
}

export async function listRelatedRecords(
  projectId: string,
  role: string,
  entityType: string,
  entityId: string
): Promise<RelatedGroup[] | null> {
  const type = relatedTypeOf(entityType);
  if (!type) return null;
  const where = (extra: Record<string, unknown> = {}) => ({ projectId, deletedAt: null, ...extra });

  let ids: Ids | null;
  const gatePassIds = new Set<string>();

  if (type === 'GATE_PASS') {
    const gp = await prisma.gatePass.findFirst({
      where: where({ id: entityId }),
      select: { id: true, poId: true, invoiceId: true, invoice: { select: { poId: true } } },
    });
    if (!gp) return null;
    gatePassIds.add(gp.id);
    const poId = gp.poId ?? gp.invoice?.poId ?? null;
    ids = poId ? await resolveChain(projectId, 'PO', poId) : null;
    if (!ids) {
      ids = { MPR: new Set(), QUOTATION: new Set(), PO: new Set(), GOODS_RECEIPT: new Set(), INVOICE: new Set(), PAYMENT: new Set() };
      if (gp.invoiceId) ids.INVOICE.add(gp.invoiceId);
    }
  } else {
    ids = await resolveChain(projectId, type, entityId);
    if (!ids) return null;
  }

  // Gate passes raised against the PO / invoice, or referenced by a goods receipt in the chain.
  if (type !== 'GATE_PASS') {
    const grs = ids.GOODS_RECEIPT.size
      ? await prisma.goodsReceipt.findMany({ where: where({ id: { in: [...ids.GOODS_RECEIPT] } }), select: { gatePassId: true } })
      : [];
    const or: Record<string, unknown>[] = [];
    if (ids.PO.size) or.push({ poId: { in: [...ids.PO] } });
    if (ids.INVOICE.size) or.push({ invoiceId: { in: [...ids.INVOICE] } });
    const grGp = grs.map((g) => g.gatePassId).filter((g): g is string => !!g);
    if (grGp.length) or.push({ id: { in: grGp } });
    if (or.length) {
      const gps = await prisma.gatePass.findMany({ where: where({ OR: or }), select: { id: true } });
      gps.forEach((g) => gatePassIds.add(g.id));
    }
  } else if (ids.PO.size) {
    const gps = await prisma.gatePass.findMany({ where: where({ poId: { in: [...ids.PO] } }), select: { id: true } });
    gps.forEach((g) => gatePassIds.add(g.id));
  }

  const can = (t: RelatedType) => hasPermission(role, PERMISSION[t]);
  const inIds = (s: Set<string>) => ({ id: { in: [...s] } });
  const [mprs, qs, pos, gps, grs, invs, pays] = await Promise.all([
    can('MPR') && ids.MPR.size ? prisma.materialPurchaseRequest.findMany({ where: inIds(ids.MPR), select: { id: true, mprNumber: true, status: true, date: true } }) : [],
    can('QUOTATION') && ids.QUOTATION.size ? prisma.quotation.findMany({ where: inIds(ids.QUOTATION), select: { id: true, quotationNumber: true, status: true, date: true } }) : [],
    can('PO') && ids.PO.size ? prisma.purchaseOrder.findMany({ where: inIds(ids.PO), select: { id: true, poNumber: true, status: true, date: true } }) : [],
    can('GATE_PASS') && gatePassIds.size ? prisma.gatePass.findMany({ where: inIds(gatePassIds), select: { id: true, passNumber: true, status: true, date: true } }) : [],
    can('GOODS_RECEIPT') && ids.GOODS_RECEIPT.size ? prisma.goodsReceipt.findMany({ where: inIds(ids.GOODS_RECEIPT), select: { id: true, receiptNumber: true, status: true, createdAt: true } }) : [],
    can('INVOICE') && ids.INVOICE.size ? prisma.vendorInvoice.findMany({ where: inIds(ids.INVOICE), select: { id: true, invoiceCode: true, paymentStatus: true, date: true } }) : [],
    can('PAYMENT') && ids.PAYMENT.size ? prisma.paymentRequest.findMany({ where: inIds(ids.PAYMENT), select: { id: true, paymentCode: true, status: true, createdAt: true } }) : [],
  ]);

  type Row = { id: string; status: string | null; date?: Date; createdAt?: Date };
  const make = (t: RelatedType, rows: Row[], label: (r: never) => string): RelatedGroup => ({
    type: t,
    items: [...rows]
      .sort((a, b) => (a.date ?? a.createdAt ?? new Date(0)).getTime() - (b.date ?? b.createdAt ?? new Date(0)).getTime())
      .map((r) => ({
        id: r.id,
        label: label(r as never),
        status: r.status ?? null,
        path: `${PAGE[t]}?id=${r.id}`,
        own: t === type && r.id === entityId,
      })),
  });

  const groups: Record<RelatedType, RelatedGroup> = {
    MPR: make('MPR', mprs, (r: { mprNumber: string }) => r.mprNumber),
    QUOTATION: make('QUOTATION', qs, (r: { quotationNumber: string }) => r.quotationNumber),
    PO: make('PO', pos, (r: { poNumber: string }) => r.poNumber),
    GATE_PASS: make('GATE_PASS', gps, (r: { passNumber: string }) => r.passNumber),
    GOODS_RECEIPT: make('GOODS_RECEIPT', grs, (r: { receiptNumber: string }) => r.receiptNumber),
    INVOICE: make('INVOICE', invs.map((r) => ({ ...r, status: r.paymentStatus })),(r: { invoiceCode: string }) => r.invoiceCode),
    PAYMENT: make('PAYMENT', pays, (r: { paymentCode: string }) => r.paymentCode),
  };
  return ORDER.map((t) => groups[t]).filter((g) => g.items.length > 0);
}
