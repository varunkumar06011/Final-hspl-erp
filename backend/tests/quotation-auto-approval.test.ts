import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: { findFirst: vi.fn() },
  vendorMaterial: { createMany: vi.fn() },
  quotation: { create: vi.fn(), update: vi.fn() },
  materialPurchaseRequest: { updateMany: vi.fn() },
  approvalWorkflow: { create: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/services/sequence.service', () => ({ generateProjectSequenceNumber: vi.fn(async () => 'Q001') }));
vi.mock('../src/services/approval.service', () => ({
  initiate: vi.fn(async () => ({ id: 'wf-open' })),
  HEAD_THEN_ADMIN_POLICY: 'HEAD_THEN_ADMIN',
}));
vi.mock('../src/services/push.service', () => ({ notifyApprovers: vi.fn(async () => undefined) }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));

import { createQuotation } from '../src/services/quotation.service';
import * as approvalService from '../src/services/approval.service';
import { notifyApprovers } from '../src/services/push.service';
import { logAudit } from '../src/services/audit.service';

const base = {
  projectId: 'p1',
  vendorId: 'v1',
  createdBy: 'u1',
  items: [{ materialName: 'Cement', quantity: 10, unitPrice: 50 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.vendor.findFirst.mockResolvedValue({ id: 'v1', name: 'ABC', materials: [{ name: 'Cement' }] });
  prismaMock.quotation.create.mockResolvedValue({ id: 'q1', vendor: { name: 'ABC' } });
  prismaMock.quotation.update.mockResolvedValue({ id: 'q1' });
  prismaMock.materialPurchaseRequest.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.approvalWorkflow.create.mockResolvedValue({ id: 'wf-auto' });
});

describe('createQuotation approval', () => {
  it('stores a quotation raised against an approved MPR as APPROVED, with no approval requested', async () => {
    await createQuotation({ ...base, mprId: 'mpr1' });

    expect(prismaMock.quotation.create.mock.calls[0][0].data.status).toBe('APPROVED');
    expect(prismaMock.approvalWorkflow.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'QUOTATION',
      entityId: 'q1',
      status: 'APPROVED',
    });
    expect(approvalService.initiate).not.toHaveBeenCalled();
    expect(notifyApprovers).not.toHaveBeenCalled();
    expect(prismaMock.quotation.update.mock.calls[0][0].data).toEqual({ approvalWorkflowId: 'wf-auto' });
    expect((logAudit as any).mock.calls[0][0].newValue).toMatchObject({ autoApproved: true, mprId: 'mpr1' });
  });

  it('still sends a quotation without an MPR through the normal approval workflow', async () => {
    await createQuotation(base);

    expect(prismaMock.quotation.create.mock.calls[0][0].data.status).toBe('SUBMITTED');
    expect(approvalService.initiate).toHaveBeenCalledTimes(1);
    expect(prismaMock.approvalWorkflow.create).not.toHaveBeenCalled();
    expect(notifyApprovers).toHaveBeenCalledTimes(1);
  });
});
