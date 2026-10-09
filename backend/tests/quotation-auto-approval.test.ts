import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findFirst: vi.fn() },
  vendorMaterial: { createMany: vi.fn() },
  quotation: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  materialPurchaseRequest: { updateMany: vi.fn(), findFirst: vi.fn() },
  materialPurchaseRequestItem: { findMany: vi.fn() },
  approvalWorkflow: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/services/sequence.service', () => ({ generateProjectSequenceNumber: vi.fn(async () => 'Q001') }));
vi.mock('../src/services/push.service', () => ({ notifyApprovers: vi.fn(async () => undefined) }));
vi.mock('../src/services/po-from-quotation.service', () => ({
  createPoFromApprovedQuotation: vi.fn(async () => ({ id: 'po1', poNumber: 'PO001' })),
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));

import { createQuotation, createQuotationFromMpr, finalizeQuotation, QuotationActionError } from '../src/services/quotation.service';
import { createPoFromApprovedQuotation } from '../src/services/po-from-quotation.service';
import { notifyApprovers } from '../src/services/push.service';

const base = {
  projectId: 'p1',
  vendorId: 'v1',
  createdBy: 'u1',
  items: [{ materialName: 'Cement', quantity: 10, unitPrice: 50 }],
};
const head = { id: 'u-head', role: 'PROJECT_HEAD', extraPermissions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.vendor.findFirst.mockResolvedValue({ id: 'v1', name: 'ABC', materials: [{ name: 'Cement' }] });
  prismaMock.quotation.create.mockResolvedValue({ id: 'q1', vendor: { name: 'ABC' } });
  prismaMock.quotation.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.quotation.findMany.mockResolvedValue([]);
  prismaMock.materialPurchaseRequest.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.materialPurchaseRequestItem.findMany.mockResolvedValue([]);
});

describe('createQuotation (no approval process)', () => {
  it('stores every quotation as SUBMITTED, waiting to be finalized, with no workflow and no PO', async () => {
    await createQuotation({ ...base, mprId: 'mpr1' });

    expect(prismaMock.quotation.create.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(prismaMock.approvalWorkflow.create).not.toHaveBeenCalled();
    expect(createPoFromApprovedQuotation).not.toHaveBeenCalled();
    expect(notifyApprovers).toHaveBeenCalledTimes(1);
  });

  it('does not push for the automatic quotation of a just-approved request', async () => {
    await createQuotation({ ...base, mprId: 'mpr1', source: 'AUTO_FROM_MPR' });
    expect(notifyApprovers).not.toHaveBeenCalled();
  });
});

describe('createQuotationFromMpr', () => {
  it('makes the first quotation from the request vendor, items and estimated rates', async () => {
    prismaMock.materialPurchaseRequest.findFirst.mockResolvedValue({
      id: 'mpr1', vendorId: 'v1', isSiteBill: false, description: 'For block A', estimatedGstRate: 18,
      vendor: { vendorType: 'VENDOR' },
      items: [{ materialName: 'Cement', quantity: 10, unit: 'bag', estimatedRate: 400 }],
    });
    prismaMock.quotation.count.mockResolvedValue(0);

    await createQuotationFromMpr('mpr1', 'p1', 'u1');

    const data = prismaMock.quotation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ mprId: 'mpr1', vendorId: 'v1', notes: 'For block A', totalAmount: 4000 });
    expect(data.items.create[0]).toMatchObject({ materialName: 'Cement', unitPrice: 400, gstRate: 18 });
  });

  it('skips non-vendor requests and requests that already have a quotation', async () => {
    prismaMock.materialPurchaseRequest.findFirst.mockResolvedValue({
      id: 'mpr1', vendorId: 'v1', isSiteBill: false, vendor: { vendorType: 'NON_VENDOR' }, items: [{ materialName: 'Sand', quantity: 1 }],
    });
    expect(await createQuotationFromMpr('mpr1', 'p1', 'u1')).toBeNull();

    prismaMock.materialPurchaseRequest.findFirst.mockResolvedValue({
      id: 'mpr1', vendorId: 'v1', isSiteBill: false, vendor: { vendorType: 'VENDOR' }, items: [{ materialName: 'Sand', quantity: 1 }],
    });
    prismaMock.quotation.count.mockResolvedValue(1);
    expect(await createQuotationFromMpr('mpr1', 'p1', 'u1')).toBeNull();
    expect(prismaMock.quotation.create).not.toHaveBeenCalled();
  });
});

describe('finalizeQuotation', () => {
  const waiting = {
    id: 'q1', mprId: 'mpr1', status: 'SUBMITTED', grandTotal: 500, approvalWorkflow: null,
    items: [{ materialName: 'Cement' }],
  };

  it('approves the quotation and raises its PO', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue(waiting);

    const result = await finalizeQuotation('q1', 'p1', head);

    expect(prismaMock.quotation.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'q1', status: 'SUBMITTED' },
      data: { status: 'APPROVED', finalizedBy: 'u-head' },
    });
    expect(createPoFromApprovedQuotation).toHaveBeenCalledWith('q1', 'u-head');
    expect(result.po).toMatchObject({ poNumber: 'PO001' });
  });

  it('is refused for roles outside the four finalizers', async () => {
    await expect(finalizeQuotation('q1', 'p1', { id: 'u2', role: 'SITE_SUPERVISOR', extraPermissions: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('lets a super admin finalize', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue(waiting);
    await finalizeQuotation('q1', 'p1', { id: 'u3', role: 'SITE_SUPERVISOR', extraPermissions: ['*'] });
    expect(createPoFromApprovedQuotation).toHaveBeenCalled();
  });

  it('refuses a quotation with no amount', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue({ ...waiting, grandTotal: 0 });
    await expect(finalizeQuotation('q1', 'p1', head)).rejects.toBeInstanceOf(QuotationActionError);
    expect(createPoFromApprovedQuotation).not.toHaveBeenCalled();
  });

  it('refuses a material already finalized for the same request, but allows a different one', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue(waiting);
    prismaMock.quotation.findMany.mockResolvedValueOnce([{ quotationNumber: 'Q002', items: [{ materialName: ' cement ' }] }]);
    await expect(finalizeQuotation('q1', 'p1', head)).rejects.toThrow(/already finalized in Q002/);

    prismaMock.quotation.findMany.mockResolvedValueOnce([{ quotationNumber: 'Q002', items: [{ materialName: 'Steel' }] }]);
    await finalizeQuotation('q1', 'p1', head);
    expect(createPoFromApprovedQuotation).toHaveBeenCalledTimes(1);
  });

  it('closes the other waiting quotations once every material is finalized', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue(waiting);
    prismaMock.quotation.findMany
      .mockResolvedValueOnce([]) // finalized siblings
      .mockResolvedValueOnce([
        { id: 'q1', quotationNumber: 'Q001', status: 'APPROVED', items: [{ materialName: 'Cement' }], approvalWorkflow: null },
        { id: 'q2', quotationNumber: 'Q002', status: 'SUBMITTED', items: [{ materialName: 'Cement' }], approvalWorkflow: null },
      ]);
    prismaMock.materialPurchaseRequestItem.findMany.mockResolvedValue([{ materialName: 'Cement' }]);

    const result = await finalizeQuotation('q1', 'p1', head);

    expect(result.notSelected).toEqual(['Q002']);
    expect(prismaMock.quotation.update).toHaveBeenCalledWith({ where: { id: 'q2' }, data: { status: 'REJECTED' } });
  });

  it('refuses when someone else changed it first (no second PO)', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue(waiting);
    prismaMock.quotation.updateMany.mockResolvedValue({ count: 0 });
    await expect(finalizeQuotation('q1', 'p1', head)).rejects.toMatchObject({ status: 409 });
    expect(createPoFromApprovedQuotation).not.toHaveBeenCalled();
  });
});
