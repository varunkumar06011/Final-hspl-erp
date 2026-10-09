import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => {
  const m: Record<string, unknown> = {
    quotation: { findFirst: vi.fn(), updateMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn(), update: vi.fn() },
    goodsReceipt: { count: vi.fn() },
    vendorInvoice: { count: vi.fn() },
    paymentRequest: { count: vi.fn() },
    budgetHead: { findUnique: vi.fn(), update: vi.fn() },
    approvalWorkflow: { updateMany: vi.fn() },
  };
  m.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/services/sequence.service', () => ({ generateProjectSequenceNumber: vi.fn(async () => 'Q001') }));
vi.mock('../src/services/push.service', () => ({ notifyApprovers: vi.fn(async () => undefined) }));
vi.mock('../src/services/po-from-quotation.service', () => ({ createPoFromApprovedQuotation: vi.fn() }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));

import { cancelQuotation, QuotationActionError } from '../src/services/quotation.service';
import { logAudit } from '../src/services/audit.service';

const director = { id: 'u-head', role: 'PROJECT_HEAD', extraPermissions: [] };
const quotation = { id: 'q1', status: 'APPROVED', projectId: 'p1' };
const pendingPo = {
  id: 'po1',
  poNumber: 'VGH-PO044',
  status: 'PENDING_APPROVAL',
  budgetHeadId: null,
  grandTotal: 1000,
  editedAt: null,
  approvalWorkflowId: 'wf1',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.quotation.findFirst.mockResolvedValue(quotation);
  prismaMock.quotation.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.purchaseOrder.findMany.mockResolvedValue([pendingPo]);
  prismaMock.purchaseOrder.update.mockResolvedValue({});
  prismaMock.goodsReceipt.count.mockResolvedValue(0);
  prismaMock.vendorInvoice.count.mockResolvedValue(0);
  prismaMock.paymentRequest.count.mockResolvedValue(0);
  prismaMock.approvalWorkflow.updateMany.mockResolvedValue({ count: 1 });
});

describe('cancelQuotation', () => {
  it('refuses a user who cannot finalize quotations', async () => {
    await expect(
      cancelQuotation('q1', 'p1', { id: 'u1', role: 'ACCOUNTANT', extraPermissions: [] } as never, 'wrong vendor')
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a quotation that is still waiting (use Not selected instead)', async () => {
    prismaMock.quotation.findFirst.mockResolvedValue({ ...quotation, status: 'SUBMITTED' });
    await expect(cancelQuotation('q1', 'p1', director as never, 'wrong vendor')).rejects.toBeInstanceOf(QuotationActionError);
    expect(prismaMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the PO is already approved, and names it', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ ...pendingPo, status: 'APPROVED' }]);
    await expect(cancelQuotation('q1', 'p1', director as never, 'wrong vendor')).rejects.toThrow(/VGH-PO044 already approved/);
    expect(prismaMock.quotation.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('refuses when the PO already has a goods receipt, invoice or payment', async () => {
    prismaMock.paymentRequest.count.mockResolvedValue(1);
    await expect(cancelQuotation('q1', 'p1', director as never, 'wrong vendor')).rejects.toThrow(/cannot be cancelled here/);
    expect(prismaMock.quotation.updateMany).not.toHaveBeenCalled();
  });

  it('cancels the quotation, closes its pending PO, rejects the open workflow and audits it', async () => {
    const result = await cancelQuotation('q1', 'p1', director as never, 'wrong vendor');

    expect(prismaMock.quotation.updateMany).toHaveBeenCalledWith({
      where: { id: 'q1', status: 'APPROVED' },
      data: { status: 'CANCELLED' },
    });
    expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po1' }, data: { status: 'DELETED' } });
    expect(prismaMock.approvalWorkflow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'wf1' }), data: { status: 'REJECTED' } })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'q1', newValue: expect.objectContaining({ reason: 'wrong vendor' }) }));
    expect(result).toEqual({ quotationId: 'q1', cancelledPoIds: ['po1'] });
  });

  it('releases the budget held by an approved-then-edited PO that is waiting for re-approval', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ ...pendingPo, budgetHeadId: 'bh1', editedAt: new Date(), grandTotal: 1000 }]);
    prismaMock.budgetHead.findUnique.mockResolvedValue({ committedAmount: 5000 });

    await cancelQuotation('q1', 'p1', director as never, 'wrong vendor');

    expect(prismaMock.budgetHead.update).toHaveBeenCalledWith({
      where: { id: 'bh1' },
      data: { committedAmount: { decrement: 1000 } },
    });
  });

  it('does not release budget for a pending PO that never held a commitment', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ ...pendingPo, budgetHeadId: 'bh1', editedAt: null }]);

    await cancelQuotation('q1', 'p1', director as never, 'wrong vendor');

    expect(prismaMock.budgetHead.update).not.toHaveBeenCalled();
  });

  it('cancels a finalized quotation that has no PO yet', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([]);
    const result = await cancelQuotation('q1', 'p1', director as never, 'wrong vendor');
    expect(prismaMock.purchaseOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.quotation.updateMany).toHaveBeenCalled();
    expect(result.cancelledPoIds).toEqual([]);
  });
});
