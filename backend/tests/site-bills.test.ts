import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => {
  const m = {
    vendor: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    materialPurchaseRequest: { findMany: vi.fn(), updateMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    approvalWorkflow: { create: vi.fn() },
    budgetHead: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('../src/services/push.service', () => ({ notifyApprovers: vi.fn(async () => undefined) }));
vi.mock('../src/services/sequence.service', () => ({ generateProjectSequenceNumber: vi.fn(async () => 'V001') }));
vi.mock('../src/services/non-vendor-po.service', () => ({
  generatePONumber: vi.fn(async () => 'VGH-PO061'),
  getActiveAdminRoles: vi.fn(async () => ['ADMIN']),
}));
vi.mock('../src/routes/ledger.routes', () => ({ ensureVendorLedger: vi.fn(async () => 'ledger') }));

import { priceSiteBill, generateSiteBillPo, SiteBillError } from '../src/services/site-bill.service';

const bill = (id: string, total: number, sitePoId: string | null = null) => ({
  id,
  mprNumber: `MPR-${id}`,
  sitePoId,
  billShopName: 'Shop',
  billPaymentMode: 'CASH',
  billDate: new Date('2026-10-09'),
  date: new Date('2026-10-09'),
  estimatedTotal: total,
  requestRaisedBy: { name: 'Ravi' },
  items: [{ materialName: `Item ${id}`, quantity: 1, unit: 'nos', estimatedRate: total, estimatedAmount: total }],
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  prismaMock.vendor.findFirst.mockResolvedValue({ id: 'site-vendor', deletedAt: null });
  prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
  prismaMock.purchaseOrder.create.mockResolvedValue({ id: 'po1' });
  prismaMock.purchaseOrder.update.mockResolvedValue({ id: 'po1', poNumber: 'VGH-PO061', approvalWorkflowId: 'wf1' });
  prismaMock.approvalWorkflow.create.mockResolvedValue({ id: 'wf1' });
});

describe('priceSiteBill', () => {
  it('accepts a bill up to ₹5,000', () => {
    expect(priceSiteBill([{ materialName: 'Nails', quantity: 2, rate: 2500 }]).total).toBe(5000);
  });

  it('refuses a bill above ₹5,000 and an empty one', () => {
    expect(() => priceSiteBill([{ materialName: 'Nails', quantity: 2, rate: 2500.5 }])).toThrow(SiteBillError);
    expect(() => priceSiteBill([{ materialName: 'Nails', quantity: 1, rate: 0 }])).toThrow(/amount/);
  });
});

describe('generateSiteBillPo', () => {
  it('makes one full-payment PO from all selected bills, sent for approval with no budget head', async () => {
    prismaMock.materialPurchaseRequest.findMany.mockResolvedValue([bill('a', 1200), bill('b', 3000)]);
    prismaMock.materialPurchaseRequest.updateMany.mockResolvedValue({ count: 2 });

    const po = await generateSiteBillPo({ projectId: 'p1', userId: 'u1', billIds: ['a', 'b'], paymentType: 'FULL_PAYMENT' });

    const data = prismaMock.purchaseOrder.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      vendorId: 'site-vendor',
      status: 'PENDING_APPROVAL',
      paymentType: 'FULL_PAYMENT',
      advanceAmount: 4200,
      grandTotal: 4200,
      budgetHeadId: null,
      isSiteBillBatch: true,
      reimburseTo: 'Ravi',
    });
    expect(data.items.create).toHaveLength(2);
    expect(prismaMock.materialPurchaseRequest.updateMany.mock.calls[0][0].data).toEqual({ sitePoId: 'po1', status: 'CLOSED' });
    expect(po.poNumber).toBe('VGH-PO061');
  });

  it('refuses bills that are already in a live PO', async () => {
    prismaMock.materialPurchaseRequest.findMany.mockResolvedValue([bill('a', 1200, 'po-old')]);
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ id: 'po-old' }]);
    await expect(generateSiteBillPo({ projectId: 'p1', userId: 'u1', billIds: ['a'], paymentType: 'FULL_PAYMENT' })).rejects.toThrow(/Already in a purchase order/);
    expect(prismaMock.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('lets a bill whose PO was rejected be used again', async () => {
    prismaMock.materialPurchaseRequest.findMany.mockResolvedValue([bill('a', 1200, 'po-rejected')]);
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    prismaMock.materialPurchaseRequest.updateMany.mockResolvedValue({ count: 1 });
    await generateSiteBillPo({ projectId: 'p1', userId: 'u1', billIds: ['a'], paymentType: 'FULL_PAYMENT' });
    expect(prismaMock.materialPurchaseRequest.updateMany.mock.calls[0][0].where.OR).toEqual([{ sitePoId: null }, { sitePoId: { in: ['po-rejected'] } }]);
  });

  it('saves nothing when another PO took a bill meanwhile', async () => {
    prismaMock.materialPurchaseRequest.findMany.mockResolvedValue([bill('a', 1200), bill('b', 300)]);
    prismaMock.materialPurchaseRequest.updateMany.mockResolvedValue({ count: 1 });
    await expect(generateSiteBillPo({ projectId: 'p1', userId: 'u1', billIds: ['a', 'b'], paymentType: 'FULL_PAYMENT' })).rejects.toMatchObject({ status: 409 });
  });
});
