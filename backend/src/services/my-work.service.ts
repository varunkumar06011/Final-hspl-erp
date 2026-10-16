import {
  MPRStatus,
  POStatus,
  QuotationStatus,
  PaymentStatus,
  InvoiceVerificationStatus,
  canFinalizeQuotation,
  findApprovableStep,
  isWorkflowOpenToRole,
  QUOTATION_FINALIZER_ROLES,
  GoodsReceiptStatus,
  POPaymentType,
  UserRole,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { EXCLUDE_PART_POS } from './part-po.service';

// ═══════════════════════════════════════════════════════════
// "My Work" — one list per person of what needs them and what they started.
//
// Read-only. Each record is turned into a card that says what it is, why it
// exists (the request's own description), who it is waiting on and for how long,
// plus a few plain "check this" flags so a person who never saw the request can
// decide quickly. Records are always filtered by the caller's project.
// ═══════════════════════════════════════════════════════════

export type WorkKind = 'MPR' | 'QUOTATION' | 'PO' | 'INVOICE' | 'PAYMENT' | 'GRN';
/** RECEIVE: goods of an approved PO still to arrive at site; INSPECT / POST_STOCK: a goods receipt still to be checked / put into stock. */
export type WorkAction = 'APPROVE' | 'FINALIZE' | 'REVIEW' | 'SUBMIT' | 'FIX' | 'RECEIVE' | 'INSPECT' | 'POST_STOCK';

export interface WorkFlag {
  code: 'OVER_ESTIMATE' | 'NO_BUDGET_HEAD' | 'NEW_VENDOR' | 'URGENT' | 'NEEDED_SOON' | 'WAITING_LONG' | 'PAID_IN_ADVANCE';
  level: 'warn' | 'info';
  /** Number the flag talks about (percent over, days waiting, days left). */
  value?: number;
}

export interface WorkItem {
  kind: WorkKind;
  id: string;
  number: string;
  /** Vendor or payee name, when there is one. */
  party: string | null;
  amount: number | null;
  /** What is being bought, shortened ("Cement × 50 bag, Sand × 2 +1"). */
  summary: string | null;
  /** Why the record exists, in the requester's own words. */
  why: string | null;
  status: string;
  action: WorkAction;
  requestedBy: string | null;
  /** Roles still to decide, as readable labels. */
  waitingOn: string[];
  /** Since when the record has been waiting on them. */
  waitingSince: string;
  /** Page that opens this record. */
  path: string;
  flags: WorkFlag[];
}

export interface MyWork {
  needsAction: WorkItem[];
  drafts: WorkItem[];
  sentBack: WorkItem[];
  waiting: WorkItem[];
}

interface Step {
  approverRole: string;
  approverUserId: string | null;
  status: string;
  decidedAt: Date | null;
}
interface Workflow {
  approvalPolicy: string | null;
  createdAt: Date;
  steps: Step[];
}

const DAY_MS = 86_400_000;
export const WAITING_LONG_DAYS = 3;
const PER_TYPE_LIMIT = 100;

/** Roles that still have to decide, and the time since the last decision (or creation). */
export function describeWaiting(
  workflow: Workflow | null | undefined,
  fallbackSince: Date,
): { waitingOn: string[]; since: Date } {
  if (!workflow) return { waitingOn: [], since: fallbackSince };
  const pending = workflow.steps.filter((s) => s.status === 'PENDING');
  const decided = workflow.steps
    .filter((s) => s.status !== 'PENDING' && s.decidedAt)
    .map((s) => s.decidedAt as Date);
  const since = decided.length > 0 ? new Date(Math.max(...decided.map((d) => d.getTime()))) : fallbackSince;
  const roles = [...new Set(pending.map((s) => s.approverRole))];
  return { waitingOn: roles, since };
}

/** Short, plain-language checks for someone seeing the record for the first time. */
export function buildFlags(input: {
  amount?: number | null;
  estimate?: number | null;
  priority?: string | null;
  requiredBy?: Date | null;
  budgetHeadMissing?: boolean;
  newVendor?: boolean;
  waitingSince: Date;
  now?: Date;
}): WorkFlag[] {
  const now = input.now ?? new Date();
  const flags: WorkFlag[] = [];
  if (input.amount && input.estimate && input.estimate > 0) {
    const pct = Math.round(((input.amount - input.estimate) / input.estimate) * 100);
    if (pct >= 5) flags.push({ code: 'OVER_ESTIMATE', level: 'warn', value: pct });
  }
  if (input.budgetHeadMissing) flags.push({ code: 'NO_BUDGET_HEAD', level: 'warn' });
  if (input.newVendor) flags.push({ code: 'NEW_VENDOR', level: 'info' });
  if (input.priority === 'Urgent' || input.priority === 'Critical') flags.push({ code: 'URGENT', level: 'warn' });
  if (input.requiredBy) {
    const daysLeft = Math.ceil((input.requiredBy.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft <= 2) flags.push({ code: 'NEEDED_SOON', level: 'warn', value: daysLeft });
  }
  const waited = Math.floor((now.getTime() - input.waitingSince.getTime()) / DAY_MS);
  if (waited >= WAITING_LONG_DAYS) flags.push({ code: 'WAITING_LONG', level: 'warn', value: waited });
  return flags;
}

interface LineLike {
  materialName: string;
  quantity: unknown;
  unit?: string | null;
}
export function summarizeLines(items: LineLike[] | null | undefined): string | null {
  if (!items || items.length === 0) return null;
  const text = items
    .slice(0, 2)
    .map((i) => `${i.materialName} × ${Number(i.quantity)}${i.unit ? ' ' + i.unit : ''}`)
    .join(', ');
  return items.length > 2 ? `${text} +${items.length - 2}` : text;
}

const clean = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim();
  return v ? v : null;
};

interface Viewer {
  id: string;
  role: string;
  extraPermissions?: string[];
}

function canDecide(workflow: Workflow | null | undefined, viewer: Viewer, stepsDecidedByViewerBlock: boolean): boolean {
  if (!workflow) return false;
  if (!isWorkflowOpenToRole(workflow, viewer.role, viewer.extraPermissions)) return false;
  const step = findApprovableStep(workflow.steps, viewer);
  if (!step) return false;
  const already = workflow.steps.some(
    (s) => s.approverUserId === viewer.id && (stepsDecidedByViewerBlock ? s.status !== 'PENDING' : s.status === 'APPROVED'),
  );
  return !already;
}

/**
 * Store / site staff (Supervisor) receive goods: every approved PO whose goods have not all
 * arrived, whatever its payment type (advance and full-payment POs too, so paid material
 * still reaches inventory), and every goods receipt not yet inspected or posted to stock.
 * Heads, accountants and admins can do it as well but are not reminded of it.
 */
export const isGoodsReceiver = (viewer: Viewer) => viewer.role === UserRole.SUPERVISOR;

const byOldest = (a: WorkItem, b: WorkItem) => new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime();
const byNewest = (a: WorkItem, b: WorkItem) => new Date(b.waitingSince).getTime() - new Date(a.waitingSince).getTime();

const WORKFLOW_SELECT = {
  approvalPolicy: true,
  createdAt: true,
  steps: { select: { approverRole: true, approverUserId: true, status: true, decidedAt: true } },
} as const;
const LINE_SELECT = { materialName: true, quantity: true, unit: true } as const;

export async function getMyWork(projectId: string, viewer: Viewer): Promise<MyWork> {
  const receiver = isGoodsReceiver(viewer);
  const [mprs, quotations, pos, invoices, payments, toReceive, openReceipts] = await Promise.all([
    prisma.materialPurchaseRequest.findMany({
      where: {
        projectId,
        deletedAt: null,
        isSiteBill: false,
        OR: [
          { status: { in: [MPRStatus.SUBMITTED, MPRStatus.APPROVED] } },
          { createdBy: viewer.id, status: { in: [MPRStatus.DRAFT, MPRStatus.REJECTED] } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: PER_TYPE_LIMIT,
      include: {
        vendor: { select: { name: true } },
        createdByUser: { select: { name: true } },
        items: { select: LINE_SELECT },
        approvalWorkflow: { select: WORKFLOW_SELECT },
      },
    }),
    prisma.quotation.findMany({
      where: { projectId, deletedAt: null, status: { in: [QuotationStatus.SUBMITTED, QuotationStatus.UNDER_REVIEW] } },
      orderBy: { createdAt: 'asc' },
      take: PER_TYPE_LIMIT,
      include: {
        vendor: { select: { name: true } },
        createdByUser: { select: { name: true } },
        items: { select: LINE_SELECT },
        mpr: { select: { mprNumber: true, description: true, estimatedTotal: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [
          { status: POStatus.PENDING_APPROVAL },
          { createdBy: viewer.id, status: POStatus.REJECTED },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: PER_TYPE_LIMIT,
      include: {
        vendor: { select: { id: true, name: true } },
        createdByUser: { select: { name: true } },
        items: { select: LINE_SELECT },
        mpr: { select: { description: true, estimatedTotal: true } },
        approvalWorkflow: { select: WORKFLOW_SELECT },
      },
    }),
    prisma.vendorInvoice.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [
          { verificationStatus: InvoiceVerificationStatus.PENDING },
          { createdBy: viewer.id, verificationStatus: InvoiceVerificationStatus.REJECTED },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: PER_TYPE_LIMIT,
      include: {
        vendor: { select: { name: true } },
        createdByUser: { select: { name: true } },
        purchaseOrder: { select: { poNumber: true, notes: true, mpr: { select: { description: true } } } },
        approvalWorkflow: { select: WORKFLOW_SELECT },
      },
    }),
    prisma.paymentRequest.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [
          { status: PaymentStatus.PENDING },
          { createdBy: viewer.id, status: PaymentStatus.REJECTED },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: PER_TYPE_LIMIT,
      include: {
        vendor: { select: { name: true } },
        createdByUser: { select: { name: true } },
        approvalWorkflow: { select: WORKFLOW_SELECT },
      },
    }),
    receiver
      ? prisma.purchaseOrder.findMany({
          where: {
            projectId,
            deletedAt: null,
            isSiteBillBatch: false, // bought and used at site already
            NOT: { isContract: true, grandTotal: 0 }, // an umbrella contract has nothing to deliver
            AND: [EXCLUDE_PART_POS], // a balance sub-PO is received on its main PO
            status: { in: [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED] },
          },
          orderBy: { updatedAt: 'asc' },
          take: PER_TYPE_LIMIT,
          include: {
            vendor: { select: { name: true } },
            createdByUser: { select: { name: true } },
            items: { select: LINE_SELECT },
            mpr: { select: { description: true } },
            goodsReceipts: { where: { deletedAt: null, status: { in: [GoodsReceiptStatus.PENDING_INSPECTION, GoodsReceiptStatus.READY_TO_POST] } }, select: { id: true } },
          },
        })
      : Promise.resolve([]),
    receiver
      ? prisma.goodsReceipt.findMany({
          where: { projectId, deletedAt: null, status: { in: [GoodsReceiptStatus.PENDING_INSPECTION, GoodsReceiptStatus.READY_TO_POST] } },
          orderBy: { createdAt: 'asc' },
          take: PER_TYPE_LIMIT,
          include: {
            createdByUser: { select: { name: true } },
            items: { select: { materialName: true, deliveredQty: true, unit: true } },
            purchaseOrder: { select: { poNumber: true, vendor: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Vendors that already have an approved/delivered PO are "known"; the rest are new to the project.
  const vendorIds = [...new Set(pos.map((p) => p.vendor.id))];
  const known = vendorIds.length
    ? await prisma.purchaseOrder.groupBy({
        by: ['vendorId'],
        where: {
          projectId,
          vendorId: { in: vendorIds },
          status: { in: [POStatus.APPROVED, POStatus.DELIVERED, POStatus.PARTIALLY_DELIVERED] },
        },
      })
    : [];
  const knownVendors = new Set(known.map((k) => k.vendorId));

  const needsAction: WorkItem[] = [];
  const drafts: WorkItem[] = [];
  const sentBack: WorkItem[] = [];
  const waiting: WorkItem[] = [];

  const place = (item: WorkItem, mine: boolean, mode: 'decide' | 'draft' | 'rejected' | 'pending') => {
    if (mode === 'decide') needsAction.push(item);
    else if (!mine) return;
    else if (mode === 'draft') drafts.push(item);
    else if (mode === 'rejected') sentBack.push(item);
    else waiting.push(item);
  };

  // ── Material requests ──
  for (const r of mprs) {
    const wf = (r.approvalWorkflow as Workflow | null) ?? null;
    const { waitingOn, since } = describeWaiting(wf, r.updatedAt);
    const amount = Number(r.estimatedTotal) || null;
    const base: WorkItem = {
      kind: 'MPR',
      id: r.id,
      number: r.mprNumber,
      party: r.vendor?.name ?? null,
      amount,
      summary: summarizeLines(r.items),
      why: clean(r.description) ?? clean(r.department),
      status: r.status,
      action: 'REVIEW',
      requestedBy: r.createdByUser?.name ?? null,
      waitingOn,
      waitingSince: since.toISOString(),
      path: `/material-purchase-requests?id=${r.id}`,
      flags: [],
    };
    const mine = r.createdBy === viewer.id;
    if ((r.status === MPRStatus.SUBMITTED || r.status === MPRStatus.APPROVED) && canDecide(wf, viewer, true)) {
      place(
        {
          ...base,
          action: 'APPROVE',
          flags: buildFlags({ priority: r.priority, requiredBy: r.requiredBy, waitingSince: since }),
        },
        mine,
        'decide',
      );
    } else if (r.status === MPRStatus.DRAFT) {
      place({ ...base, action: 'SUBMIT' }, mine, 'draft');
    } else if (r.status === MPRStatus.REJECTED) {
      place({ ...base, action: 'FIX' }, mine, 'rejected');
    } else if (r.status === MPRStatus.SUBMITTED) {
      place(base, mine, 'pending');
    }
  }

  // ── Quotations waiting to be finalized ──
  const canFinalize = canFinalizeQuotation(viewer.role, viewer.extraPermissions);
  for (const q of quotations) {
    const amount = Number(q.grandTotal) || null;
    const since = q.createdAt;
    const item: WorkItem = {
      kind: 'QUOTATION',
      id: q.id,
      number: q.quotationNumber,
      party: q.vendor?.name ?? null,
      amount,
      summary: summarizeLines(q.items),
      why: clean(q.mpr?.description) ?? clean(q.notes),
      status: q.status,
      action: 'FINALIZE',
      requestedBy: q.createdByUser?.name ?? null,
      waitingOn: canFinalize ? [] : [...QUOTATION_FINALIZER_ROLES],
      waitingSince: since.toISOString(),
      path: `/quotations?id=${q.id}`,
      flags: buildFlags({ amount, estimate: Number(q.mpr?.estimatedTotal) || null, waitingSince: since }),
    };
    place(item, q.createdBy === viewer.id, canFinalize ? 'decide' : 'pending');
  }

  // ── Purchase orders ──
  for (const p of pos) {
    const wf = (p.approvalWorkflow as Workflow | null) ?? null;
    const { waitingOn, since } = describeWaiting(wf, p.updatedAt);
    const amount = Number(p.grandTotal) || null;
    const base: WorkItem = {
      kind: 'PO',
      id: p.id,
      number: p.poNumber,
      party: p.vendor?.name ?? null,
      amount,
      summary: summarizeLines(p.items),
      why: clean(p.mpr?.description) ?? clean(p.notes),
      status: p.status,
      action: 'REVIEW',
      requestedBy: p.createdByUser?.name ?? null,
      waitingOn,
      waitingSince: since.toISOString(),
      path: `/pos?id=${p.id}`,
      flags: [],
    };
    const mine = p.createdBy === viewer.id;
    if (p.status === POStatus.PENDING_APPROVAL && canDecide(wf, viewer, false)) {
      place(
        {
          ...base,
          action: 'APPROVE',
          flags: buildFlags({
            amount,
            estimate: Number(p.mpr?.estimatedTotal) || null,
            budgetHeadMissing: !p.budgetHeadId,
            newVendor: !knownVendors.has(p.vendor.id),
            waitingSince: since,
          }),
        },
        mine,
        'decide',
      );
    } else if (p.status === POStatus.REJECTED) {
      place({ ...base, action: 'FIX' }, mine, 'rejected');
    } else if (p.status === POStatus.PENDING_APPROVAL) {
      place(base, mine, 'pending');
    }
  }

  // ── Invoices ──
  for (const inv of invoices) {
    const wf = (inv.approvalWorkflow as Workflow | null) ?? null;
    const { waitingOn, since } = describeWaiting(wf, inv.updatedAt);
    const amount = Number(inv.totalAmount) || null;
    const base: WorkItem = {
      kind: 'INVOICE',
      id: inv.id,
      number: inv.invoiceCode,
      party: inv.vendor?.name ?? null,
      amount,
      summary: inv.purchaseOrder ? inv.purchaseOrder.poNumber : null,
      why: clean(inv.purchaseOrder?.mpr?.description) ?? clean(inv.purchaseOrder?.notes) ?? clean(inv.notes),
      status: inv.verificationStatus,
      action: 'REVIEW',
      requestedBy: inv.createdByUser?.name ?? null,
      waitingOn,
      waitingSince: since.toISOString(),
      path: `/invoices?id=${inv.id}`,
      flags: [],
    };
    const mine = inv.createdBy === viewer.id;
    if (inv.verificationStatus === InvoiceVerificationStatus.PENDING && canDecide(wf, viewer, false)) {
      place({ ...base, action: 'APPROVE', flags: buildFlags({ waitingSince: since }) }, mine, 'decide');
    } else if (inv.verificationStatus === InvoiceVerificationStatus.REJECTED) {
      place({ ...base, action: 'FIX' }, mine, 'rejected');
    } else {
      place(base, mine, 'pending');
    }
  }

  // ── Payments ──
  for (const pay of payments) {
    const wf = (pay.approvalWorkflow as Workflow | null) ?? null;
    const { waitingOn, since } = describeWaiting(wf, pay.updatedAt);
    const amount = Number(pay.amount) || null;
    const base: WorkItem = {
      kind: 'PAYMENT',
      id: pay.id,
      number: pay.paymentCode,
      party: pay.vendor?.name ?? null,
      amount,
      summary: clean(pay.category),
      why: clean(pay.description) ?? clean(pay.notes),
      status: pay.status,
      action: 'REVIEW',
      requestedBy: pay.createdByUser?.name ?? null,
      waitingOn,
      waitingSince: since.toISOString(),
      path: `/payments?id=${pay.id}`,
      flags: [],
    };
    const mine = pay.createdBy === viewer.id;
    if (pay.status === PaymentStatus.PENDING && canDecide(wf, viewer, false)) {
      place({ ...base, action: 'APPROVE', flags: buildFlags({ waitingSince: since }) }, mine, 'decide');
    } else if (pay.status === PaymentStatus.REJECTED) {
      place({ ...base, action: 'FIX' }, mine, 'rejected');
    } else {
      place(base, mine, 'pending');
    }
  }

  // ── Goods to receive at site (store / site staff) ──
  for (const p of toReceive) {
    // A PO with a receipt already open is handled through that receipt (below).
    if (p.goodsReceipts.length > 0) continue;
    if (p.status !== POStatus.APPROVED && p.status !== POStatus.PARTIALLY_DELIVERED) continue;
    const since = p.updatedAt;
    needsAction.push({
      kind: 'PO',
      id: p.id,
      number: p.poNumber,
      party: p.vendor?.name ?? null,
      amount: Number(p.grandTotal) || null,
      summary: summarizeLines(p.items),
      why: clean(p.mpr?.description) ?? clean(p.notes),
      status: p.status,
      action: 'RECEIVE',
      requestedBy: p.createdByUser?.name ?? null,
      waitingOn: [],
      waitingSince: since.toISOString(),
      path: `/goods-receipts?po=${p.id}`,
      flags: [
        ...(p.paymentType !== POPaymentType.AFTER_DELIVERY ? [{ code: 'PAID_IN_ADVANCE' as const, level: 'info' as const }] : []),
        ...buildFlags({ waitingSince: since }),
      ],
    });
  }
  for (const r of openReceipts) {
    const inspect = r.status === GoodsReceiptStatus.PENDING_INSPECTION;
    const since = inspect ? r.createdAt : (r.inspectedAt ?? r.updatedAt);
    needsAction.push({
      kind: 'GRN',
      id: r.id,
      number: r.receiptNumber,
      party: r.purchaseOrder?.vendor?.name ?? null,
      amount: null,
      summary: summarizeLines(r.items.map((i) => ({ materialName: i.materialName, quantity: i.deliveredQty, unit: i.unit }))),
      why: r.purchaseOrder?.poNumber ?? null,
      status: r.status,
      action: inspect ? 'INSPECT' : 'POST_STOCK',
      requestedBy: r.createdByUser?.name ?? null,
      waitingOn: [],
      waitingSince: since.toISOString(),
      path: `/goods-receipts?id=${r.id}`,
      flags: buildFlags({ waitingSince: since }),
    });
  }

  return {
    needsAction: needsAction.sort(byOldest),
    drafts: drafts.sort(byNewest),
    sentBack: sentBack.sort(byNewest),
    waiting: waiting.sort(byOldest),
  };
}
