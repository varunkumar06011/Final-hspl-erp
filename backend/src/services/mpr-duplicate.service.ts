/**
 * Duplicate check for material requests. Before (or right after) a request is saved it is
 * compared with every earlier live request of the SAME vendor in the SAME project:
 *
 *  - DUPLICATE: every line (item + specification + quantity) is the same, or the estimated
 *    total is the same and at least one line matches. This is the "entered twice" case.
 *  - POSSIBLE: at least one line (item + specification + quantity) is the same.
 *
 * For each match it reports the POs raised from it and what has been paid on them, and it
 * lists payments of the same vendor with no PO whose amount equals the request total, so
 * accounts can see that the money has already gone out. Read-only: it never writes.
 */
import { catalogSpecKey, lineKey } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

export type MprDuplicateLevel = 'NONE' | 'POSSIBLE' | 'DUPLICATE';
export type MprDuplicateReason = 'SAME_LINES' | 'SAME_TOTAL' | 'SOME_LINES';

export interface DuplicateLine {
  itemId?: string | null;
  materialName: string;
  specification?: string | null;
  quantity: number;
  amount?: number | null;
}

export interface DuplicateCandidate {
  vendorId: string | null | undefined;
  total: number;
  lines: DuplicateLine[];
}

export interface OtherMpr {
  id: string;
  mprNumber: string;
  status: string;
  date: Date;
  estimatedTotal: number;
  lines: DuplicateLine[];
  purchaseOrders: { id: string; poNumber: string; status: string; grandTotal: number }[];
  /** Money actually paid against this request's POs, by payment request. */
  payments: { code: string; amount: number; date: Date | null; status: string }[];
}

export interface LoosePayment {
  code: string;
  amount: number;
  date: Date | null;
  status: string;
  poNumber: string | null;
}

export interface MprDuplicateMatch {
  level: Exclude<MprDuplicateLevel, 'NONE'>;
  reason: MprDuplicateReason;
  mprId: string;
  mprNumber: string;
  status: string;
  date: Date;
  total: number;
  matchedLines: string[];
  purchaseOrders: OtherMpr['purchaseOrders'];
  payments: OtherMpr['payments'];
  paidAmount: number;
}

export interface MprDuplicateResult {
  level: MprDuplicateLevel;
  /** How many times this request now exists: 1 = only this one, 2 = "entered twice", ... */
  times: number;
  matches: MprDuplicateMatch[];
  /** Payments to the same vendor (no request link) for exactly the request total. */
  loosePayments: LoosePayment[];
  /** Plain-English one-liner for Miko, logs and API clients. The app builds its own translated text. */
  message: string | null;
}

const QTY_TOLERANCE = 0.005;
const MONEY_TOLERANCE = 0.01;
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(Math.round(n * 100) / 100)}`;

const sameQty = (a: number, b: number) => Math.abs(a - b) <= QTY_TOLERANCE;
const sameMoney = (a: number, b: number) => Math.abs(a - b) <= MONEY_TOLERANCE;

/** Same item + specification (by catalog id when both lines have one, else by name). */
export function sameLine(a: DuplicateLine, b: DuplicateLine): boolean {
  if (a.itemId && b.itemId) return a.itemId === b.itemId && catalogSpecKey(a.specification) === catalogSpecKey(b.specification);
  return lineKey(a) === lineKey(b);
}

const labelOf = (l: DuplicateLine) => `${l.materialName}${l.specification ? ` - ${l.specification}` : ''} x ${l.quantity}`;

/** Pure matching rules; exported for tests. */
export function evaluateMprDuplicates(candidate: DuplicateCandidate, others: OtherMpr[], loose: LoosePayment[] = []): MprDuplicateResult {
  const matches: MprDuplicateMatch[] = [];
  const mine = candidate.lines.filter((l) => l.quantity > 0);

  for (const other of others) {
    const matched = mine.filter((l) => other.lines.some((o) => sameLine(l, o) && sameQty(l.quantity, o.quantity)));
    if (!matched.length) continue;
    const everyLine = matched.length === mine.length && other.lines.length === mine.length;
    const sameTotal = candidate.total > 0 && sameMoney(candidate.total, other.estimatedTotal);
    const level = everyLine || sameTotal ? 'DUPLICATE' : 'POSSIBLE';
    const reason: MprDuplicateReason = everyLine ? 'SAME_LINES' : sameTotal ? 'SAME_TOTAL' : 'SOME_LINES';
    matches.push({
      level,
      reason,
      mprId: other.id,
      mprNumber: other.mprNumber,
      status: other.status,
      date: other.date,
      total: other.estimatedTotal,
      matchedLines: matched.map(labelOf),
      purchaseOrders: other.purchaseOrders,
      payments: other.payments,
      paidAmount: other.payments.reduce((s, p) => s + p.amount, 0),
    });
  }
  matches.sort((a, b) => (a.level === b.level ? b.date.getTime() - a.date.getTime() : a.level === 'DUPLICATE' ? -1 : 1));

  const duplicates = matches.filter((m) => m.level === 'DUPLICATE').length;
  const level: MprDuplicateLevel = duplicates ? 'DUPLICATE' : matches.length ? 'POSSIBLE' : 'NONE';
  const loosePayments = candidate.total > 0 ? loose.filter((p) => sameMoney(p.amount, candidate.total)) : [];

  return {
    level,
    times: 1 + duplicates,
    matches,
    loosePayments,
    message: level === 'NONE' && !loosePayments.length ? null : describe(level, duplicates, matches, loosePayments),
  };
}

function describe(level: MprDuplicateLevel, duplicates: number, matches: MprDuplicateMatch[], loose: LoosePayment[]): string {
  const parts: string[] = [];
  if (level !== 'NONE') {
    const first = matches[0];
    const times = duplicates + 1;
    const head =
      level === 'DUPLICATE'
        ? `Entered ${times === 2 ? 'twice' : `${times} times`}: this matches ${first.mprNumber} (same vendor, ${first.reason === 'SAME_LINES' ? 'same items and quantities' : 'same total and items'}, ${money(first.total)})`
        : `Possible duplicate of ${first.mprNumber}: ${first.matchedLines.join(', ')} already requested from the same vendor`;
    const po = first.purchaseOrders.length ? `; PO ${first.purchaseOrders.map((p) => `${p.poNumber} (${p.status})`).join(', ')}` : '';
    const paid = first.paidAmount > 0 ? `; ${money(first.paidAmount)} already paid` : '; nothing paid yet';
    parts.push(`${head}${po}${paid}.`);
  }
  if (loose.length) parts.push(`A payment of the same amount to this vendor exists: ${loose.map((p) => p.code).join(', ')}.`);
  return parts.join(' ');
}

const PAID_STATUSES = ['PAID', 'ADVANCE_PAID', 'PARTIALLY_PAID'];
const DEAD_MPR = ['CANCELLED', 'REJECTED'];

export interface FindArgs {
  projectId: string;
  vendorId: string | null | undefined;
  requestType?: string | null;
  /** The request being checked, so it never matches itself. */
  excludeId?: string | null;
  total: number;
  lines: DuplicateLine[];
}

/** Loads the vendor's earlier requests, their POs and payments, then applies the rules. Never throws. */
export async function findMprDuplicates(args: FindArgs): Promise<MprDuplicateResult> {
  const none: MprDuplicateResult = { level: 'NONE', times: 1, matches: [], loosePayments: [], message: null };
  try {
    if (!args.vendorId || !args.lines.some((l) => l.quantity > 0)) return none;

    const rows = await prisma.materialPurchaseRequest.findMany({
      where: {
        projectId: args.projectId,
        vendorId: args.vendorId,
        deletedAt: null,
        isSiteBill: false,
        status: { notIn: DEAD_MPR },
        requestType: args.requestType || 'MATERIAL',
        ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      },
      select: {
        id: true,
        mprNumber: true,
        status: true,
        date: true,
        estimatedTotal: true,
        items: { select: { itemId: true, materialName: true, specification: true, quantity: true, estimatedAmount: true } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });
    const mprIds = rows.map((r) => r.id);

    const pos = mprIds.length
      ? await prisma.purchaseOrder.findMany({
          where: {
            projectId: args.projectId,
            deletedAt: null,
            status: { notIn: ['DELETED', 'CANCELLED', 'REJECTED'] },
            OR: [{ mprId: { in: mprIds } }, { quotation: { mprId: { in: mprIds } } }],
          },
          select: { id: true, poNumber: true, status: true, grandTotal: true, mprId: true, quotation: { select: { mprId: true } } },
        })
      : [];
    const poIds = pos.map((p) => p.id);

    const prs = await prisma.paymentRequest.findMany({
      where: {
        projectId: args.projectId,
        deletedAt: null,
        status: { in: PAID_STATUSES },
        OR: [...(poIds.length ? [{ poId: { in: poIds } }] : []), { vendorId: args.vendorId }],
      },
      select: {
        paymentCode: true,
        amount: true,
        status: true,
        poId: true,
        createdAt: true,
        purchaseOrder: { select: { poNumber: true } },
        payments: { where: { status: 'PAID' }, select: { amount: true, date: true } },
      },
      take: 1000,
    });

    const paidOf = (pr: (typeof prs)[number]) => {
      const done = pr.payments.reduce((s, p) => s + Number(p.amount), 0);
      return done > 0 ? done : Number(pr.amount);
    };
    const dateOf = (pr: (typeof prs)[number]) => pr.payments[0]?.date ?? pr.createdAt;

    const others: OtherMpr[] = rows.map((r) => {
      const myPos = pos.filter((p) => (p.mprId ?? p.quotation?.mprId) === r.id);
      const myPoIds = new Set(myPos.map((p) => p.id));
      return {
        id: r.id,
        mprNumber: r.mprNumber,
        status: r.status,
        date: r.date,
        estimatedTotal: Number(r.estimatedTotal),
        lines: r.items.map((i) => ({ itemId: i.itemId, materialName: i.materialName, specification: i.specification, quantity: Number(i.quantity), amount: Number(i.estimatedAmount) })),
        purchaseOrders: myPos.map((p) => ({ id: p.id, poNumber: p.poNumber, status: p.status, grandTotal: Number(p.grandTotal) })),
        payments: prs.filter((pr) => pr.poId && myPoIds.has(pr.poId)).map((pr) => ({ code: pr.paymentCode, amount: paidOf(pr), date: dateOf(pr), status: pr.status })),
      };
    });

    // Payments of this vendor that point at no PO of a matched request (expense / advance entered by hand).
    const linked = new Set(pos.map((p) => p.id));
    const loose: LoosePayment[] = prs
      .filter((pr) => !pr.poId || !linked.has(pr.poId))
      .map((pr) => ({ code: pr.paymentCode, amount: paidOf(pr), date: dateOf(pr), status: pr.status, poNumber: pr.purchaseOrder?.poNumber ?? null }));

    return evaluateMprDuplicates({ vendorId: args.vendorId, total: args.total, lines: args.lines }, others, loose);
  } catch (err) {
    console.error('[MprDuplicate] check failed:', err);
    return none;
  }
}
