import { Permission, hasPermission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

/**
 * Combined Records: every purchase as ONE record, from the material request to the
 * payment (MPR -> quotations -> POs -> goods receipts -> invoices -> payments).
 * A record is rooted at its MPR; quotations without a request and POs without
 * either (contract sub-POs, site-bill POs, older POs) are records of their own.
 * Searching any number in the chain (PO60, Q12, MPR7, an invoice code), a vendor
 * or a material finds the whole record. Read-only; actions use the normal endpoints.
 */

export type StepKey = 'REQUEST' | 'QUOTATION' | 'PO' | 'DELIVERY' | 'INVOICE' | 'PAYMENT';
export type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'rejected';
export type RootType = 'mpr' | 'quotation' | 'po';

/** What the record is waiting for (a translation key on the frontend). */
export type NextAction =
  | 'submitRequest'
  | 'approveRequest'
  | 'addQuotation'
  | 'finalizeQuotation'
  | 'enterPoAmount'
  | 'approvePo'
  | 'receiveGoods'
  | 'addInvoice'
  | 'makePayment'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface Step {
  key: StepKey;
  state: StepState;
}

const DEAD = ['DELETED', 'CANCELLED', 'REJECTED'];
const FINALIZED_Q = ['APPROVED', 'CONVERTED_TO_PO'];
const OPEN_Q = ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'];
const APPROVED_PO = ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'];

/** Minimal shape the stage logic needs (both the list and the detail build it). */
export interface ChainShape {
  mpr?: { status: string; nonVendor: boolean; isSiteBill?: boolean } | null;
  quotations: { status: string }[];
  pos: { status: string; grandTotal: number; netPayable: number; isContract?: boolean }[];
  goodsReceipts: { status: string }[];
  invoices: { paymentStatus: string }[];
  /** Paid amount per payment request (only PAID ones count). */
  payments: { status: string; amount: number }[];
}

/** Steps of the record and what it is waiting for. */
export function computeStages(c: ChainShape): { steps: Step[]; current: StepKey | 'DONE' | 'CLOSED'; next: NextAction } {
  const steps: Step[] = [];
  const livePos = c.pos.filter((p) => !DEAD.includes(p.status) && !p.isContract);
  const deadPos = c.pos.filter((p) => DEAD.includes(p.status));
  const finalized = c.quotations.filter((q) => FINALIZED_Q.includes(q.status));
  const openQ = c.quotations.filter((q) => OPEN_Q.includes(q.status));

  // ── Request ──
  let requestDone = true;
  if (c.mpr) {
    const s = c.mpr.status;
    if (s === 'REJECTED') return closed('REQUEST', 'rejected');
    if (s === 'CANCELLED') return closed('REQUEST', 'cancelled');
    requestDone = !['DRAFT', 'SUBMITTED'].includes(s);
    steps.push({ key: 'REQUEST', state: requestDone ? 'done' : 'current' });
  } else {
    steps.push({ key: 'REQUEST', state: 'skipped' });
  }

  // ── Quotations ── (non-vendor requests and site bills have none)
  const noQuotations = !!c.mpr && (c.mpr.nonVendor || !!c.mpr.isSiteBill);
  let quotationDone: boolean;
  if (noQuotations || (!c.mpr && c.quotations.length === 0)) {
    steps.push({ key: 'QUOTATION', state: 'skipped' });
    quotationDone = true;
  } else {
    quotationDone = finalized.length > 0;
    steps.push({ key: 'QUOTATION', state: quotationDone ? 'done' : requestDone ? 'current' : 'todo' });
  }

  // ── Purchase order ── (a PO only rejected so far shows as rejected until a new one is raised)
  const poApproved = livePos.length > 0 && livePos.every((p) => APPROVED_PO.includes(p.status));
  const poMissingAmount = livePos.some((p) => p.status === 'PENDING_APPROVAL' && p.grandTotal <= 0);
  const poRejected = livePos.length === 0 && deadPos.length > 0;
  const poReachable = requestDone && quotationDone;
  steps.push({
    key: 'PO',
    state: poApproved ? 'done' : livePos.length > 0 ? 'current' : poRejected ? 'rejected' : poReachable ? 'current' : 'todo',
  });

  // ── Delivery and invoice ── (site bills: bought, billed and paid at site already)
  const siteBill = !!c.mpr?.isSiteBill;
  const delivered = livePos.length > 0 && livePos.every((p) => p.status === 'DELIVERED');
  const invoiced = c.invoices.length > 0;
  steps.push({ key: 'DELIVERY', state: siteBill ? 'skipped' : delivered ? 'done' : poApproved ? 'current' : 'todo' });
  steps.push({ key: 'INVOICE', state: siteBill ? 'skipped' : invoiced ? 'done' : poApproved ? 'current' : 'todo' });

  // ── Payment ──
  const payable = livePos.reduce((s, p) => s + (p.netPayable || p.grandTotal), 0);
  const paid = c.payments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const fullyPaid = payable > 0 && paid >= payable - 0.5;
  steps.push({ key: 'PAYMENT', state: fullyPaid ? 'done' : poApproved ? 'current' : 'todo' });

  // ── What it waits for, in flow order ──
  let next: NextAction;
  let current: StepKey | 'DONE';
  if (c.mpr && c.mpr.status === 'DRAFT') [next, current] = ['submitRequest', 'REQUEST'];
  else if (c.mpr && c.mpr.status === 'SUBMITTED') [next, current] = ['approveRequest', 'REQUEST'];
  else if (!quotationDone) [next, current] = [openQ.length > 0 ? 'finalizeQuotation' : 'addQuotation', 'QUOTATION'];
  else if (poRejected) [next, current] = ['rejected', 'PO'];
  else if (livePos.length === 0) [next, current] = [finalized.length > 0 ? 'finalizeQuotation' : 'enterPoAmount', 'PO'];
  else if (poMissingAmount) [next, current] = ['enterPoAmount', 'PO'];
  else if (!poApproved) [next, current] = ['approvePo', 'PO'];
  else if (!siteBill && !delivered && !invoiced) [next, current] = ['receiveGoods', 'DELIVERY'];
  else if (!siteBill && !invoiced) [next, current] = ['addInvoice', 'INVOICE'];
  else if (!fullyPaid) [next, current] = ['makePayment', 'PAYMENT'];
  else [next, current] = ['completed', 'DONE'];
  return { steps, current, next };

  function closed(at: StepKey, why: 'rejected' | 'cancelled') {
    const keys: StepKey[] = ['REQUEST', 'QUOTATION', 'PO', 'DELIVERY', 'INVOICE', 'PAYMENT'];
    return {
      steps: keys.map((key) => ({ key, state: (key === at ? 'rejected' : 'todo') as StepState })),
      current: 'CLOSED' as const,
      next: why as NextAction,
    };
  }
}

// ───────────────────────── search ─────────────────────────

/** Lower-case letters and digits only, leading zeros of every number dropped: "VGH-PO060" -> "vghpo60". */
export function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(^|[a-z])0+(?=\d)/g, '$1');
}

/** The number part of a document number, without leading zeros: "VGH-PO060" -> "60". */
function numberPart(s: string): string | null {
  const m = /(\d+)\D*$/.exec(s);
  return m ? String(Number(m[1])) : null;
}

export interface SearchDoc {
  numbers: string[];
  texts: string[];
}

/**
 * True when every word of the query matches the record. A word of digits only
 * matches a document number exactly (60 finds PO060, not PO160) or an amount;
 * a word ending in digits must end a number ("po1" finds PO001, not PO010);
 * other words match inside any number ("po") or any text (vendor, material…).
 */
export function matchesQuery(doc: SearchDoc, query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const nums = doc.numbers.map(normalizeToken);
  const numParts = doc.numbers.map(numberPart).filter((n): n is string => !!n);
  const texts = doc.texts.map((t) => t.toLowerCase());
  return words.every((raw) => {
    const w = normalizeToken(raw);
    if (!w) return true;
    if (/^\d+$/.test(w)) return numParts.includes(w) || texts.some((t) => t === raw.toLowerCase());
    const lw = raw.toLowerCase();
    const endsInDigit = /\d$/.test(w);
    return nums.some((n) => (endsInDigit ? n.endsWith(w) : n.includes(w))) || texts.some((t) => t.includes(lw));
  });
}

// ───────────────────────── list ─────────────────────────

export interface CombinedListQuery {
  q?: string;
  stage?: string; // all | REQUEST | QUOTATION | PO | DELIVERY | INVOICE | PAYMENT | DONE | CLOSED
  page?: number;
  pageSize?: number;
}

interface Viewer {
  role: string;
  extraPermissions?: readonly string[] | null;
}

const money = (v: unknown) => Number(v ?? 0);

/** Every record of the project (lightweight), newest activity first. */
export async function listCombinedRecords(projectId: string, viewer: Viewer, query: CombinedListQuery) {
  const fin = hasPermission(viewer.role, Permission.VIEW_FINANCIALS, viewer.extraPermissions);
  const base = { projectId, deletedAt: null };

  const [mprs, quotations, pos, siteBills, grs, invoices, payments] = await Promise.all([
    prisma.materialPurchaseRequest.findMany({
      where: { ...base, isSiteBill: false },
      select: {
        id: true, mprNumber: true, date: true, updatedAt: true, status: true, requestType: true, description: true,
        estimatedTotal: true, vendor: { select: { name: true, vendorType: true } },
        items: { select: { materialName: true } },
      },
    }),
    fin
      ? prisma.quotation.findMany({
          where: { ...base, status: { not: 'DELETED' } },
          select: {
            id: true, quotationNumber: true, mprId: true, status: true, grandTotal: true, date: true, updatedAt: true,
            vendor: { select: { name: true } }, items: { select: { materialName: true } },
          },
        })
      : [],
    fin
      ? prisma.purchaseOrder.findMany({
          where: { ...base, status: { not: 'DELETED' }, isContract: false },
          select: {
            id: true, poNumber: true, quotationId: true, mprId: true, status: true, grandTotal: true, netPayable: true,
            date: true, updatedAt: true, isSiteBillBatch: true, reimburseTo: true,
            vendor: { select: { name: true } }, items: { select: { materialName: true } },
          },
        })
      : [],
    fin
      ? prisma.materialPurchaseRequest.findMany({
          where: { ...base, isSiteBill: true, sitePoId: { not: null } },
          select: { mprNumber: true, sitePoId: true, billShopName: true },
        })
      : [],
    fin ? prisma.goodsReceipt.findMany({ where: base, select: { poId: true, receiptNumber: true, status: true, updatedAt: true } }) : [],
    fin
      ? prisma.vendorInvoice.findMany({
          where: { ...base, poId: { not: null } },
          select: { id: true, poId: true, invoiceCode: true, invoiceNumber: true, paymentStatus: true, updatedAt: true },
        })
      : [],
    fin
      ? prisma.paymentRequest.findMany({
          where: { ...base, OR: [{ poId: { not: null } }, { invoiceId: { not: null } }] },
          select: { poId: true, invoiceId: true, paymentCode: true, requestNumber: true, status: true, amount: true, updatedAt: true },
        })
      : [],
  ]);

  // ── group into records ──
  interface Rec {
    type: RootType;
    id: string;
    mpr?: (typeof mprs)[number];
    quotations: (typeof quotations)[number][];
    pos: (typeof pos)[number][];
  }
  const records: Rec[] = [];
  const recByMpr = new Map<string, Rec>();
  const recByQuotation = new Map<string, Rec>();
  for (const m of mprs) {
    const r: Rec = { type: 'mpr', id: m.id, mpr: m, quotations: [], pos: [] };
    records.push(r);
    recByMpr.set(m.id, r);
  }
  for (const q of quotations) {
    let r = q.mprId ? recByMpr.get(q.mprId) : undefined;
    if (!r) {
      r = { type: 'quotation', id: q.id, quotations: [], pos: [] };
      records.push(r);
    }
    r.quotations.push(q);
    recByQuotation.set(q.id, r);
  }
  for (const p of pos) {
    let r = (p.quotationId && recByQuotation.get(p.quotationId)) || (p.mprId && recByMpr.get(p.mprId)) || undefined;
    if (!r) {
      r = { type: 'po', id: p.id, quotations: [], pos: [] };
      records.push(r);
    }
    r.pos.push(p);
  }

  const grsByPo = groupBy(grs, (g) => g.poId);
  const invByPo = groupBy(invoices, (i) => i.poId ?? '');
  const invPo = new Map(invoices.map((i) => [i.id, i.poId]));
  const payByPo = groupBy(payments, (p) => p.poId ?? (p.invoiceId ? invPo.get(p.invoiceId) ?? '' : ''));
  const billsByPo = groupBy(siteBills, (b) => b.sitePoId ?? '');

  const rows = records.map((r) => {
    const poIds = r.pos.map((p) => p.id);
    const rGrs = poIds.flatMap((id) => grsByPo.get(id) ?? []);
    const rInv = poIds.flatMap((id) => invByPo.get(id) ?? []);
    const rPay = poIds.flatMap((id) => payByPo.get(id) ?? []);
    const rBills = poIds.flatMap((id) => billsByPo.get(id) ?? []);
    const isSiteBatch = r.pos.some((p) => p.isSiteBillBatch);

    const stages = computeStages({
      mpr: r.mpr
        ? { status: r.mpr.status, nonVendor: r.mpr.vendor?.vendorType === 'NON_VENDOR' }
        : isSiteBatch
          ? { status: 'APPROVED', nonVendor: true, isSiteBill: true }
          : null,
      quotations: r.quotations,
      pos: r.pos.map((p) => ({ status: p.status, grandTotal: money(p.grandTotal), netPayable: money(p.netPayable) })),
      goodsReceipts: rGrs,
      invoices: rInv,
      payments: rPay.map((p) => ({ status: p.status, amount: money(p.amount) })),
    });

    const vendors = uniq([r.mpr?.vendor?.name, ...r.quotations.map((q) => q.vendor.name), ...r.pos.map((p) => p.vendor.name)]);
    const materials = uniq([
      ...(r.mpr?.items.map((i) => i.materialName) ?? []),
      ...r.quotations.flatMap((q) => q.items.map((i) => i.materialName)),
      ...r.pos.flatMap((p) => p.items.map((i) => i.materialName)),
    ]);
    const finalized = r.quotations.filter((q) => FINALIZED_Q.includes(q.status));
    const livePos = r.pos.filter((p) => !DEAD.includes(p.status));
    const amount = livePos.length
      ? livePos.reduce((s, p) => s + money(p.grandTotal), 0)
      : finalized.length
        ? finalized.reduce((s, q) => s + money(q.grandTotal), 0)
        : r.mpr
          ? money(r.mpr.estimatedTotal)
          : r.quotations.length
            ? r.quotations.reduce((max, q) => Math.max(max, money(q.grandTotal)), 0)
            : r.pos.reduce((s, p) => s + money(p.grandTotal), 0);
    const dates = [
      r.mpr?.updatedAt, ...r.quotations.map((q) => q.updatedAt), ...r.pos.map((p) => p.updatedAt),
      ...rGrs.map((g) => g.updatedAt), ...rInv.map((i) => i.updatedAt), ...rPay.map((p) => p.updatedAt),
    ].filter((d): d is Date => !!d);
    const startDate = r.mpr?.date ?? r.quotations[0]?.date ?? r.pos[0]?.date;

    const doc: SearchDoc = {
      numbers: [
        r.mpr?.mprNumber, ...r.quotations.map((q) => q.quotationNumber), ...r.pos.map((p) => p.poNumber),
        ...rGrs.map((g) => g.receiptNumber), ...rInv.flatMap((i) => [i.invoiceCode, i.invoiceNumber]),
        ...rPay.flatMap((p) => [p.paymentCode, p.requestNumber]), ...rBills.map((b) => b.mprNumber),
      ].filter((n): n is string => !!n),
      texts: [
        ...vendors, ...materials, r.mpr?.description, ...rBills.map((b) => b.billShopName),
        ...r.pos.map((p) => p.reimburseTo), String(Math.round(amount)),
      ].filter((t): t is string => !!t),
    };

    return {
      key: `${r.type}:${r.id}`,
      type: r.type,
      id: r.id,
      title: r.mpr?.mprNumber ?? r.quotations[0]?.quotationNumber ?? r.pos[0]?.poNumber ?? '',
      isSiteBills: isSiteBatch,
      requestType: r.mpr?.requestType ?? null,
      date: startDate ?? null,
      lastActivity: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : startDate ?? null,
      vendors,
      materials: materials.slice(0, 6),
      materialCount: materials.length,
      amount: Math.round(amount * 100) / 100,
      numbers: {
        mpr: r.mpr ? { id: r.mpr.id, number: r.mpr.mprNumber, status: r.mpr.status } : null,
        quotations: r.quotations.map((q) => ({ id: q.id, number: q.quotationNumber, status: q.status })),
        pos: r.pos.map((p) => ({ id: p.id, number: p.poNumber, status: p.status })),
        goodsReceipts: rGrs.length,
        invoices: rInv.length,
        bills: rBills.length,
      },
      ...stages,
      _doc: doc,
    };
  });

  const q = query.q?.trim() ?? '';
  const searched = q ? rows.filter((r) => matchesQuery(r._doc, q)) : rows;

  const counts: Record<string, number> = { all: searched.length };
  for (const r of searched) counts[r.current] = (counts[r.current] ?? 0) + 1;

  const stage = query.stage && query.stage !== 'all' ? query.stage : null;
  const filtered = stage ? searched.filter((r) => r.current === stage) : searched;
  filtered.sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0));

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const data = filtered.slice((page - 1) * pageSize, page * pageSize).map(({ _doc, ...rest }) => rest);
  return { data, counts, pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) } };
}

// ───────────────────────── detail ─────────────────────────

/** The root record (mpr / quotation / po) a record of any type belongs to. */
export async function resolveRoot(projectId: string, type: string, id: string): Promise<{ type: RootType; id: string } | null> {
  const where = { id, projectId, deletedAt: null };
  if (type === 'mpr') {
    const m = await prisma.materialPurchaseRequest.findFirst({ where, select: { id: true, isSiteBill: true, sitePoId: true } });
    if (!m) return null;
    if (m.isSiteBill) return m.sitePoId ? { type: 'po', id: m.sitePoId } : null;
    return { type: 'mpr', id: m.id };
  }
  if (type === 'quotation') {
    const q = await prisma.quotation.findFirst({ where, select: { id: true, mprId: true } });
    if (!q) return null;
    return q.mprId ? { type: 'mpr', id: q.mprId } : { type: 'quotation', id: q.id };
  }
  if (type === 'po') {
    const p = await prisma.purchaseOrder.findFirst({ where, select: { id: true, mprId: true, quotation: { select: { id: true, mprId: true } } } });
    if (!p) return null;
    if (p.quotation?.mprId) return { type: 'mpr', id: p.quotation.mprId };
    if (p.mprId) return { type: 'mpr', id: p.mprId };
    if (p.quotation) return { type: 'quotation', id: p.quotation.id };
    return { type: 'po', id: p.id };
  }
  return null;
}

const workflowInclude = {
  include: {
    steps: {
      orderBy: { stepNumber: 'asc' as const },
      include: { approverUser: { select: { id: true, name: true, role: true } } },
    },
  },
};

/** The full record: request, all quotations, POs and what followed them. */
export async function getCombinedRecord(projectId: string, viewer: Viewer, type: string, id: string) {
  const root = await resolveRoot(projectId, type, id);
  if (!root) return null;
  const fin = hasPermission(viewer.role, Permission.VIEW_FINANCIALS, viewer.extraPermissions);
  const base = { projectId, deletedAt: null };

  const mpr = root.type === 'mpr'
    ? await prisma.materialPurchaseRequest.findFirst({
        where: { ...base, id: root.id },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          vendor: { select: { id: true, name: true, vendorType: true, phone: true, vendorCode: true } },
          createdByUser: { select: { id: true, name: true } },
          requestRaisedBy: { select: { id: true, name: true } },
          approvalWorkflow: workflowInclude,
        },
      })
    : null;
  if (root.type === 'mpr' && !mpr) return null;

  const quotationWhere = root.type === 'mpr' ? { mprId: root.id } : root.type === 'quotation' ? { id: root.id } : null;
  const quotations = fin && quotationWhere
    ? await prisma.quotation.findMany({
        where: { ...base, ...quotationWhere, status: { not: 'DELETED' } },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          vendor: { select: { id: true, name: true, vendorCode: true } },
          createdByUser: { select: { id: true, name: true } },
          approvalWorkflow: { select: { status: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const poOr: Record<string, unknown>[] = [];
  if (root.type === 'po') poOr.push({ id: root.id });
  if (root.type === 'mpr') poOr.push({ mprId: root.id });
  if (quotations.length) poOr.push({ quotationId: { in: quotations.map((q) => q.id) } });
  const pos = fin && poOr.length
    ? await prisma.purchaseOrder.findMany({
        where: { ...base, OR: poOr, isContract: false },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          vendor: { select: { id: true, name: true, vendorCode: true } },
          budgetHead: { select: { id: true, particulars: true, allocatedAmount: true, committedAmount: true } },
          createdByUser: { select: { id: true, name: true } },
          approvalWorkflow: workflowInclude,
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  if (root.type !== 'mpr' && !fin) return null;
  if (root.type === 'po' && pos.length === 0) return null;
  if (root.type === 'quotation' && quotations.length === 0) return null;

  const poIds = pos.map((p) => p.id);
  const [goodsReceipts, invoices, siteBills, finalizers] = await Promise.all([
    poIds.length
      ? prisma.goodsReceipt.findMany({
          where: { ...base, poId: { in: poIds } },
          select: { id: true, poId: true, receiptNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [],
    poIds.length
      ? prisma.vendorInvoice.findMany({
          where: { ...base, poId: { in: poIds } },
          select: { id: true, poId: true, invoiceCode: true, invoiceNumber: true, totalAmount: true, paymentStatus: true, date: true },
          orderBy: { date: 'asc' },
        })
      : [],
    poIds.length
      ? prisma.materialPurchaseRequest.findMany({
          where: { ...base, isSiteBill: true, sitePoId: { in: poIds } },
          select: {
            id: true, mprNumber: true, sitePoId: true, billDate: true, billShopName: true, billPaymentMode: true,
            estimatedTotal: true, receiptFileName: true, requestRaisedBy: { select: { name: true } },
          },
          orderBy: { billDate: 'asc' },
        })
      : [],
    prisma.user.findMany({
      where: { id: { in: quotations.map((q) => q.finalizedBy).filter((u): u is string => !!u) } },
      select: { id: true, name: true },
    }),
  ]);
  const invoiceIds = invoices.map((i) => i.id);
  const payments = poIds.length
    ? await prisma.paymentRequest.findMany({
        where: { ...base, OR: [{ poId: { in: poIds } }, ...(invoiceIds.length ? [{ invoiceId: { in: invoiceIds } }] : [])] },
        select: { id: true, poId: true, invoiceId: true, paymentCode: true, requestNumber: true, type: true, amount: true, status: true, paymentMode: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const finalizerName = new Map(finalizers.map((u) => [u.id, u.name]));
  const isSiteBatch = pos.some((p) => p.isSiteBillBatch);
  const stages = computeStages({
    mpr: mpr
      ? { status: mpr.status, nonVendor: mpr.vendor?.vendorType === 'NON_VENDOR' }
      : isSiteBatch
        ? { status: 'APPROVED', nonVendor: true, isSiteBill: true }
        : null,
    quotations,
    pos: pos.map((p) => ({ status: p.status, grandTotal: money(p.grandTotal), netPayable: money(p.netPayable) })),
    goodsReceipts,
    invoices,
    payments: payments.map((p) => ({ status: p.status, amount: money(p.amount) })),
  });

  // Request materials not yet covered by a finalized quotation (they still need one).
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const covered = new Set(quotations.filter((q) => FINALIZED_Q.includes(q.status)).flatMap((q) => q.items.map((i) => norm(i.materialName))));
  const uncoveredMaterials = mpr ? mpr.items.filter((i) => !covered.has(norm(i.materialName))).map((i) => i.materialName) : [];

  return {
    root,
    canSeeFinancials: fin,
    ...stages,
    uncoveredMaterials,
    mpr,
    quotations: quotations.map((q) => ({
      ...q,
      finalizedByName: q.finalizedBy ? finalizerName.get(q.finalizedBy) ?? null : null,
      purchaseOrderIds: pos.filter((p) => p.quotationId === q.id).map((p) => p.id),
    })),
    purchaseOrders: pos.map((p) => ({ ...p, siteBills: siteBills.filter((b) => b.sitePoId === p.id) })),
    goodsReceipts,
    invoices,
    payments,
  };
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const k = v.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v.trim());
  }
  return out;
}
