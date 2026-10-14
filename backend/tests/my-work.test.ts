import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  materialPurchaseRequest: { findMany: vi.fn() },
  quotation: { findMany: vi.fn() },
  purchaseOrder: { findMany: vi.fn(), groupBy: vi.fn() },
  vendorInvoice: { findMany: vi.fn() },
  paymentRequest: { findMany: vi.fn() },
  goodsReceipt: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: db }));

import { buildFlags, describeWaiting, getMyWork, summarizeLines } from '../src/services/my-work.service';

const day = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

describe('my work helpers', () => {
  it('says who a record is waiting on and since when', () => {
    const created = daysAgo(5);
    const w = describeWaiting(
      {
        approvalPolicy: null,
        createdAt: created,
        steps: [
          { approverRole: 'PROJECT_HEAD', approverUserId: 'u1', status: 'APPROVED', decidedAt: daysAgo(2) },
          { approverRole: 'ADMIN', approverUserId: null, status: 'PENDING', decidedAt: null },
        ],
      },
      created,
    );
    expect(w.waitingOn).toEqual(['ADMIN']);
    expect(Math.round((Date.now() - w.since.getTime()) / day)).toBe(2);
  });

  it('flags a total well above the estimate, a missing budget head and a long wait', () => {
    const flags = buildFlags({ amount: 1120, estimate: 1000, budgetHeadMissing: true, waitingSince: daysAgo(4) });
    expect(flags.map((f) => f.code)).toEqual(['OVER_ESTIMATE', 'NO_BUDGET_HEAD', 'WAITING_LONG']);
    expect(flags[0].value).toBe(12);
  });

  it('does not flag a small difference or a fresh record', () => {
    expect(buildFlags({ amount: 1020, estimate: 1000, waitingSince: daysAgo(0) })).toEqual([]);
  });

  it('shortens the item list', () => {
    expect(summarizeLines([])).toBeNull();
    expect(
      summarizeLines([
        { materialName: 'Cement', quantity: 50, unit: 'bag' },
        { materialName: 'Sand', quantity: 2 },
        { materialName: 'Steel', quantity: 1 },
      ]),
    ).toBe('Cement × 50 bag, Sand × 2 +1');
  });
});

describe('getMyWork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.materialPurchaseRequest.findMany.mockResolvedValue([]);
    db.quotation.findMany.mockResolvedValue([]);
    db.purchaseOrder.findMany.mockResolvedValue([]);
    db.purchaseOrder.groupBy.mockResolvedValue([]);
    db.vendorInvoice.findMany.mockResolvedValue([]);
    db.paymentRequest.findMany.mockResolvedValue([]);
    db.goodsReceipt.findMany.mockResolvedValue([]);
  });

  const mpr = (over: Record<string, unknown>) => ({
    id: 'm1',
    mprNumber: 'VGH-MPR001',
    status: 'SUBMITTED',
    createdBy: 'creator',
    description: 'Pipes for block B',
    department: null,
    priority: 'Urgent',
    requiredBy: null,
    estimatedTotal: 5000,
    updatedAt: daysAgo(1),
    vendor: { name: 'Lakshmi' },
    createdByUser: { name: 'Ravi' },
    items: [{ materialName: 'Pipe', quantity: 10, unit: 'm' }],
    approvalWorkflow: {
      approvalPolicy: null,
      createdAt: daysAgo(1),
      steps: [{ approverRole: 'PROJECT_HEAD', approverUserId: null, status: 'PENDING', decidedAt: null }],
    },
    ...over,
  });

  it('puts a request the viewer can approve in "needs action", with its reason', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([mpr({})]);
    const r = await getMyWork('p1', { id: 'head', role: 'PROJECT_HEAD' });
    expect(r.needsAction).toHaveLength(1);
    expect(r.needsAction[0]).toMatchObject({ kind: 'MPR', action: 'APPROVE', why: 'Pipes for block B', summary: 'Pipe × 10 m' });
    expect(r.needsAction[0].flags.map((f) => f.code)).toContain('URGENT');
    expect(r.waiting).toHaveLength(0);
  });

  it('shows the creator the same request as "waiting" and not as something to approve', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([mpr({})]);
    const r = await getMyWork('p1', { id: 'creator', role: 'SITE_SUPERVISOR' });
    expect(r.needsAction).toHaveLength(0);
    expect(r.waiting).toHaveLength(1);
    expect(r.waiting[0].waitingOn).toEqual(['PROJECT_HEAD']);
  });

  it('ignores other people\'s requests that the viewer can neither approve nor started', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([mpr({})]);
    const r = await getMyWork('p1', { id: 'other', role: 'ACCOUNTANT' });
    expect(r.needsAction).toHaveLength(0);
    expect(r.waiting).toHaveLength(0);
  });

  it('lists the viewer\'s drafts and sent-back records', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([
      mpr({ id: 'd', status: 'DRAFT', approvalWorkflow: null }),
      mpr({ id: 'r', status: 'REJECTED' }),
    ]);
    const r = await getMyWork('p1', { id: 'creator', role: 'SITE_SUPERVISOR' });
    expect(r.drafts.map((i) => i.id)).toEqual(['d']);
    expect(r.sentBack.map((i) => i.id)).toEqual(['r']);
    expect(r.drafts[0].action).toBe('SUBMIT');
    expect(r.sentBack[0].action).toBe('FIX');
  });

  it('only lets finalizer roles act on a waiting quotation', async () => {
    db.quotation.findMany.mockResolvedValue([
      {
        id: 'q1',
        quotationNumber: 'VGH-Q001',
        status: 'SUBMITTED',
        createdBy: 'creator',
        grandTotal: 1200,
        notes: null,
        createdAt: daysAgo(1),
        vendor: { name: 'Lakshmi' },
        createdByUser: { name: 'Ravi' },
        items: [],
        mpr: { mprNumber: 'VGH-MPR001', description: 'Pipes', estimatedTotal: 1000 },
      },
    ]);
    const head = await getMyWork('p1', { id: 'head', role: 'PROJECT_HEAD' });
    expect(head.needsAction[0]).toMatchObject({ kind: 'QUOTATION', action: 'FINALIZE', why: 'Pipes' });
    expect(head.needsAction[0].flags.find((f) => f.code === 'OVER_ESTIMATE')?.value).toBe(20);
    const acct = await getMyWork('p1', { id: 'acct', role: 'ACCOUNTANT' });
    expect(acct.needsAction).toHaveLength(0);
  });

  it('reminds the store supervisor to receive paid POs and to inspect / post goods receipts', async () => {
    const po = (over: Record<string, unknown>) => ({
      id: 'po1', poNumber: 'VGH-PO010', status: 'APPROVED', paymentType: 'FULL_PAYMENT', grandTotal: 25000, notes: null,
      createdBy: 'x', updatedAt: daysAgo(4), vendor: { id: 'v', name: 'Lakshmi Steels' }, createdByUser: { name: 'Ravi' },
      items: [{ materialName: 'TMT 12mm', quantity: 10, unit: 'nos' }], mpr: { description: 'Columns block B' }, goodsReceipts: [], ...over,
    });
    // first findMany = POs awaiting approval (none), second = POs to receive
    db.purchaseOrder.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([po({}), po({ id: 'po2', goodsReceipts: [{ id: 'g' }] })]);
    db.goodsReceipt.findMany.mockResolvedValue([
      { id: 'g1', receiptNumber: 'VGH-GRN004', status: 'PENDING_INSPECTION', createdAt: daysAgo(1), updatedAt: daysAgo(1), inspectedAt: null,
        createdByUser: { name: 'Store' }, items: [{ materialName: 'Cement', deliveredQty: 50, unit: 'bags' }], purchaseOrder: { poNumber: 'VGH-PO009', vendor: { name: 'ABC' } } },
    ]);

    const r = await getMyWork('p1', { id: 'store', role: 'SUPERVISOR' });

    const receive = r.needsAction.find((i) => i.action === 'RECEIVE')!;
    expect(receive).toMatchObject({ kind: 'PO', id: 'po1', path: '/goods-receipts?po=po1', summary: 'TMT 12mm × 10 nos' });
    expect(receive.flags.map((f) => f.code)).toEqual(['PAID_IN_ADVANCE', 'WAITING_LONG']);
    expect(r.needsAction.some((i) => i.id === 'po2')).toBe(false); // its open receipt is the task instead
    expect(r.needsAction.find((i) => i.kind === 'GRN')).toMatchObject({ action: 'INSPECT', number: 'VGH-GRN004', why: 'VGH-PO009' });

    db.purchaseOrder.findMany.mockReset().mockResolvedValue([]);
    const head = await getMyWork('p1', { id: 'head', role: 'PROJECT_HEAD' });
    expect(head.needsAction.some((i) => i.action === 'RECEIVE' || i.kind === 'GRN')).toBe(false);
  });
});
