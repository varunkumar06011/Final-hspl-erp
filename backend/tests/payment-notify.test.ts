/**
 * "Payment made" notices: the PO / MPR people hear when accounts pays a PO, and the
 * site people hear when their site bills are reimbursed. Prisma and push are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, pushed, inApp } = vi.hoisted(() => ({
  db: { pr: null as any, bills: [] as any[] },
  pushed: [] as any[],
  inApp: [] as any[],
}));

vi.mock('../src/config/prisma', () => ({
  prisma: {
    paymentRequest: { findUnique: vi.fn(async () => db.pr) },
    materialPurchaseRequest: { findMany: vi.fn(async () => db.bills) },
    appNotification: { createMany: vi.fn(async ({ data }: any) => inApp.push(...data)) },
  },
}));
vi.mock('../src/services/push.service', () => ({
  notifyUsers: vi.fn(async (userIds: string[], payload: any) => pushed.push({ userIds, ...payload })),
}));

import { buildPaymentNotices, notifyPaymentsMade } from '../src/services/payment-notify.service';

const po = (extra: Record<string, unknown> = {}) => ({
  id: 'po-1',
  poNumber: 'VGH-PO012',
  createdBy: 'u-po',
  isSiteBillBatch: false,
  vendor: { name: 'ABC Traders' },
  mpr: null,
  quotation: { mpr: { mprNumber: 'VGH-MPR007', createdBy: 'u-mpr', requestRaisedById: 'u-site' } },
  ...extra,
});

describe('payment notifications', () => {
  beforeEach(() => {
    db.pr = null;
    db.bills = [];
    pushed.length = 0;
    inApp.length = 0;
  });

  it('tells the PO raiser and the MPR people when an advance is paid, not the accountant', async () => {
    db.pr = { id: 'pr-1', projectId: 'p', paymentCode: 'PAY1', type: 'ADVANCE', amount: 50000, vendor: { name: 'ABC Traders' }, purchaseOrder: po(), invoice: null };
    const notices = await buildPaymentNotices('pr-1', 'u-accounts');
    expect(notices).toHaveLength(1);
    expect(notices[0].userIds.sort()).toEqual(['u-mpr', 'u-po', 'u-site']);
    expect(notices[0].body).toContain('₹50,000 advance paid to ABC Traders for VGH-PO012 (VGH-MPR007)');
  });

  it('finds the PO through the invoice for a bill payment', async () => {
    db.pr = { id: 'pr-2', projectId: 'p', paymentCode: 'PAY2', type: 'INVOICE', amount: 1200, vendor: null, purchaseOrder: null, invoice: { invoiceCode: 'INV1', invoiceNumber: '9', purchaseOrder: po() } };
    const notices = await buildPaymentNotices('pr-2', 'u-po');
    expect(notices[0].userIds.sort()).toEqual(['u-mpr', 'u-site']); // the payer (u-po) is left out
  });

  it('tells each site-bill payer that their bills were reimbursed', async () => {
    db.pr = { id: 'pr-3', projectId: 'p', paymentCode: 'PAY3', type: 'ADVANCE', amount: 4500, vendor: null, purchaseOrder: po({ isSiteBillBatch: true, quotation: null, createdBy: 'u-accounts' }), invoice: null };
    db.bills = [
      { createdBy: 'u-x', requestRaisedById: 'u-ashok', estimatedTotal: 3000 },
      { createdBy: 'u-ashok', requestRaisedById: null, estimatedTotal: 500 },
      { createdBy: 'u-ravi', requestRaisedById: null, estimatedTotal: 1000 },
    ];
    const notices = await buildPaymentNotices('pr-3', 'u-accounts');
    const ashok = notices.find((n) => n.userIds.includes('u-ashok'))!;
    expect(ashok.title).toBe('Site bills reimbursed');
    expect(ashok.body).toContain('2 of your site bills (₹3,500)');
    expect(notices.find((n) => n.userIds.includes('u-ravi'))!.body).toContain('1 of your site bill (₹1,000) was paid back');
  });

  it('saves an in-app notification and sends a push; never throws', async () => {
    db.pr = { id: 'pr-1', projectId: 'p', paymentCode: 'PAY1', type: 'ADVANCE', amount: 10, vendor: null, purchaseOrder: po(), invoice: null };
    await notifyPaymentsMade('p', ['pr-1'], 'u-accounts');
    expect(inApp.map((n) => n.userId).sort()).toEqual(['u-mpr', 'u-po', 'u-site']);
    expect(inApp[0]).toMatchObject({ type: 'PAYMENT_MADE', projectId: 'p', url: '/pos?id=po-1' });
    expect(pushed).toHaveLength(1);

    db.pr = undefined;
    await expect(notifyPaymentsMade('p', ['missing'], 'u')).resolves.toBeUndefined();
  });
});
