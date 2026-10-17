import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/push.service', () => ({
  notifyAllHeads: vi.fn(),
  notifyApprovers: vi.fn(),
  notifyUser: vi.fn(),
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn() }));

import { UserRole, createGoodsReceiptSchema } from '@hospital-erp/shared';
import { MPR_APPROVAL_POLICY, mprApprovalSteps } from '../src/services/approval.service';

describe('MPR approval is heads-only', () => {
  it('has steps for the Project Head and Head of Construction only (no admin)', () => {
    const roles = mprApprovalSteps().map((s) => s.approverRole);
    expect(roles).toEqual([UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION]);
    expect(MPR_APPROVAL_POLICY).toBe('ANY_APPROVERS');
  });
});

describe('goods receipt needs a gate pass', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const items = [{ materialName: 'Cement', deliveredQty: 5 }];
  it('rejects a receipt without a gate pass', () => {
    expect(() => createGoodsReceiptSchema.parse({ body: { poId: uuid, items } })).toThrow();
  });
  it('accepts a receipt with a gate pass', () => {
    expect(() => createGoodsReceiptSchema.parse({ body: { poId: uuid, gatePassId: uuid, items } })).not.toThrow();
  });
});
