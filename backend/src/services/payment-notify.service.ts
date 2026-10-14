/**
 * "Your money has been paid" notices. When accounts records a payment against a PO
 * (advance, full payment, or an invoice of the PO), the people waiting on it are told
 * in the app and by push, so nobody has to phone the accountant:
 *  - whoever raised the PO and the material request behind it (they chase the vendor);
 *  - for a site-bill PO, everyone who paid those bills at site (their reimbursement).
 * The person who recorded the payment is never told about their own action.
 */
import { prisma } from '../config/prisma';
import { notifyUsers } from './push.service';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(Math.round(n * 100) / 100)}`;

const TYPE_LABEL: Record<string, string> = { ADVANCE: 'advance', INVOICE: 'bill', EXPENSE: 'expense' };

const poSelect = {
  id: true,
  poNumber: true,
  createdBy: true,
  isSiteBillBatch: true,
  vendor: { select: { name: true } },
  mpr: { select: { mprNumber: true, createdBy: true, requestRaisedById: true } },
  quotation: { select: { mpr: { select: { mprNumber: true, createdBy: true, requestRaisedById: true } } } },
} as const;

export interface PaymentNotice {
  userIds: string[];
  title: string;
  body: string;
  url: string;
  entityId: string;
}

/** Who is told, and what, for one paid request. Exported for tests. */
export async function buildPaymentNotices(paymentRequestId: string, actorId: string): Promise<PaymentNotice[]> {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentRequestId },
    select: {
      id: true,
      projectId: true,
      paymentCode: true,
      type: true,
      amount: true,
      vendor: { select: { name: true } },
      purchaseOrder: { select: poSelect },
      invoice: { select: { invoiceCode: true, invoiceNumber: true, purchaseOrder: { select: poSelect } } },
    },
  });
  if (!pr) return [];
  const po = pr.purchaseOrder ?? pr.invoice?.purchaseOrder ?? null;
  if (!po) return [];

  const amount = money(Number(pr.amount));
  const kind = TYPE_LABEL[pr.type] ?? 'payment';
  const notices: PaymentNotice[] = [];
  const skip = new Set([actorId]);
  const keep = (ids: Array<string | null | undefined>) => {
    const out = [...new Set(ids.filter((id): id is string => !!id && !skip.has(id)))];
    out.forEach((id) => skip.add(id));
    return out;
  };

  if (po.isSiteBillBatch) {
    // Each payer hears about their own bills; the money for the whole PO goes out in one go.
    const bills = await prisma.materialPurchaseRequest.findMany({
      where: { sitePoId: po.id, deletedAt: null },
      select: { createdBy: true, requestRaisedById: true, estimatedTotal: true },
    });
    const byPayer = new Map<string, { count: number; total: number }>();
    for (const b of bills) {
      const payer = b.requestRaisedById ?? b.createdBy;
      const cur = byPayer.get(payer) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(b.estimatedTotal);
      byPayer.set(payer, cur);
    }
    for (const [payer, { count, total }] of byPayer) {
      const [id] = keep([payer]);
      if (!id) continue;
      notices.push({
        userIds: [id],
        title: 'Site bills reimbursed',
        body: `${count} of your site bill${count === 1 ? '' : 's'} (${money(total)}) ${count === 1 ? 'was' : 'were'} paid back under ${po.poNumber}.`,
        url: '/site-bills',
        entityId: po.id,
      });
    }
  }

  const mpr = po.mpr ?? po.quotation?.mpr ?? null;
  const watchers = keep([po.createdBy, mpr?.createdBy, mpr?.requestRaisedById]);
  if (watchers.length) {
    const vendor = pr.vendor?.name ?? po.vendor?.name ?? 'the vendor';
    notices.push({
      userIds: watchers,
      title: `Payment made: ${po.poNumber}`,
      body: `${amount} ${kind} paid to ${vendor} for ${po.poNumber}${mpr?.mprNumber ? ` (${mpr.mprNumber})` : ''}.`,
      url: `/pos?id=${po.id}`,
      entityId: po.id,
    });
  }
  return notices;
}

/** Fire-and-forget: in-app notification + push for each paid request. Never throws. */
export async function notifyPaymentsMade(projectId: string, paymentRequestIds: string[], actorId: string): Promise<void> {
  try {
    for (const id of paymentRequestIds) {
      const notices = await buildPaymentNotices(id, actorId);
      for (const n of notices) {
        await prisma.appNotification.createMany({
          data: n.userIds.map((userId) => ({
            userId,
            projectId,
            type: 'PAYMENT_MADE',
            title: n.title,
            body: n.body,
            url: n.url,
            entityId: n.entityId,
            entityType: 'PURCHASE_ORDER',
          })),
        });
        await notifyUsers(n.userIds, { entityType: 'PURCHASE_ORDER', entityId: n.entityId, title: n.title, body: n.body, url: n.url }, 'approval_result');
      }
    }
  } catch (err) {
    console.error('[Payments] paid notification failed:', err);
  }
}
