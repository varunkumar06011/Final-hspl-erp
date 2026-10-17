import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalStatus, ApprovalStepStatus, MPRStatus, UserRole } from '@hospital-erp/shared';

// In-memory rows for the few tables the MPR approval path touches.
const db = vi.hoisted(() => ({
  workflows: new Map<string, any>(),
  steps: new Map<string, any>(),
  mprs: new Map<string, any>(),
}));

vi.mock('../src/config/prisma', () => {
  const stepsOf = (workflowId: string) =>
    [...db.steps.values()].filter((s) => s.workflowId === workflowId).sort((a, b) => a.stepNumber - b.stepNumber);
  const users: Record<string, any> = {
    ph: { id: 'ph', role: UserRole.PROJECT_HEAD, name: 'PH' },
    hoc: { id: 'hoc', role: UserRole.HEAD_OF_CONSTRUCTION, name: 'HoC' },
  };
  let seq = 0;
  const prisma: any = {
    approvalWorkflow: {
      findUnique: vi.fn(async ({ where }: any) => {
        const wf = db.workflows.get(where.id);
        return wf ? { ...wf, steps: stepsOf(wf.id) } : null;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...db.workflows.values()]
          .filter((wf) => wf.entityType === where.entityType && where.status.in.includes(wf.status))
          .filter((wf) => wf.approvalPolicy === null || wf.approvalPolicy !== where.OR[1].approvalPolicy.not)
          .map((wf) => ({ ...wf, steps: stepsOf(wf.id), materialPurchaseRequest: db.mprs.get(wf.entityId) ?? null })),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const wf = db.workflows.get(where.id);
        Object.assign(wf, data);
        return { ...wf, steps: stepsOf(wf.id) };
      }),
    },
    approvalStep: {
      findUnique: vi.fn(async ({ where }: any) => {
        const step = db.steps.get(where.id);
        return step ? { ...step, workflow: db.workflows.get(step.workflowId) } : null;
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        [...db.steps.values()].find(
          (s) => s.workflowId === where.workflowId && s.approverUserId === where.approverUserId && where.status.in.includes(s.status),
        ) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.steps.get(where.id), data)),
      deleteMany: vi.fn(async ({ where }: any) => {
        where.id.in.forEach((id: string) => db.steps.delete(id));
        return { count: where.id.in.length };
      }),
      create: vi.fn(async ({ data }: any) => {
        const step = { id: `new-${++seq}`, approverUserId: null, ...data };
        db.steps.set(step.id, step);
        return step;
      }),
    },
    materialPurchaseRequest: {
      findUnique: vi.fn(async ({ where }: any) => db.mprs.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.mprs.get(where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const mpr = db.mprs.get(where.id);
        if (!mpr || mpr.status !== where.status) return { count: 0 };
        Object.assign(mpr, data);
        return { count: 1 };
      }),
    },
    user: { findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null) },
    comment: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return { prisma };
});
vi.mock('../src/services/push.service', () => ({
  notifyAllHeads: vi.fn(async () => undefined),
  notifyApprovers: vi.fn(async () => undefined),
  notifyUser: vi.fn(async () => undefined),
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('../src/services/quotation.service', () => ({ createQuotationFromMpr: vi.fn(async () => null) }));
vi.mock('../src/services/non-vendor-po.service', () => ({ createNonVendorPoFromMpr: vi.fn(async () => null) }));

import { approve, reject } from '../src/services/approval.service';
import { migrateLegacyMprWorkflows } from '../src/services/mpr-approval.service';
import { createQuotationFromMpr } from '../src/services/quotation.service';

/** An MPR workflow as created before the heads-only rule: heads, then every admin. */
function seedMpr(id: string, opts: { policy?: string | null; minApprovers?: number; mprStatus?: string; headApprovedBy?: string } = {}) {
  const wfId = `wf-${id}`;
  db.mprs.set(id, { id, status: opts.mprStatus ?? MPRStatus.SUBMITTED, createdBy: 'creator', projectId: 'p1' });
  db.workflows.set(wfId, {
    id: wfId, entityType: 'MATERIAL_PURCHASE_REQUEST', entityId: id, projectId: 'p1',
    status: opts.headApprovedBy ? ApprovalStatus.APPROVAL_2 : ApprovalStatus.VERIFICATION,
    currentStep: 0, minApprovers: opts.minApprovers ?? 2,
    approvalPolicy: opts.policy === undefined ? 'HEAD_THEN_ADMIN' : opts.policy,
  });
  [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2].forEach((role, i) => {
    const approved = role === UserRole.PROJECT_HEAD && opts.headApprovedBy;
    db.steps.set(`${id}-s${i + 1}`, {
      id: `${id}-s${i + 1}`, workflowId: wfId, stepNumber: i + 1, approverRole: role,
      status: approved ? ApprovalStepStatus.APPROVED : ApprovalStepStatus.PENDING,
      approverUserId: approved ? opts.headApprovedBy : null,
    });
  });
  return wfId;
}

describe('MPRs submitted before the heads-only rule', () => {
  beforeEach(() => {
    db.workflows.clear();
    db.steps.clear();
    db.mprs.clear();
    vi.clearAllMocks();
  });

  it('one head approval fully approves an old head-then-admin MPR (no admin needed)', async () => {
    const wfId = seedMpr('m1');
    const result = await approve('m1-s1', 'ph');
    expect(result.isFullyApproved).toBe(true);
    expect(db.workflows.get(wfId).status).toBe(ApprovalStatus.APPROVED);
    expect(db.mprs.get('m1').status).toBe(MPRStatus.APPROVED);
  });

  it('Head of Construction alone is enough too, on an old head-groups MPR', async () => {
    seedMpr('m2', { policy: 'HEAD_GROUPS', minApprovers: 3 });
    const result = await approve('m2-s2', 'hoc');
    expect(result.isFullyApproved).toBe(true);
  });

  it('one head rejection fully rejects an old MPR that needed several rejections', async () => {
    seedMpr('m3', { policy: 'HEAD_GROUPS', minApprovers: 3 });
    const result = await reject('m3-s1', 'ph', 'Not needed');
    expect(result.isFullyRejected).toBe(true);
    expect(db.mprs.get('m3').status).toBe(MPRStatus.REJECTED);
  });

  it('migration approves MPRs a head already signed and drops the admin steps', async () => {
    const wfId = seedMpr('m4', { headApprovedBy: 'ph' });
    const settled = await migrateLegacyMprWorkflows();
    expect(settled).toBe(1);
    expect(db.mprs.get('m4').status).toBe(MPRStatus.APPROVED);
    const wf = db.workflows.get(wfId);
    expect(wf.status).toBe(ApprovalStatus.APPROVED);
    expect(wf.approvalPolicy).toBe('ANY_APPROVERS');
    const roles = [...db.steps.values()].filter((s) => s.workflowId === wfId).map((s) => s.approverRole);
    expect(roles).toEqual([UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION]);
    // The first quotation is raised as if the head had just approved.
    expect(createQuotationFromMpr).toHaveBeenCalledWith('m4', 'p1', 'ph');
  });

  it('migration leaves unsigned MPRs waiting on the heads only', async () => {
    const wfId = seedMpr('m5');
    expect(await migrateLegacyMprWorkflows()).toBe(0);
    expect(db.mprs.get('m5').status).toBe(MPRStatus.SUBMITTED);
    expect(db.workflows.get(wfId).status).toBe(ApprovalStatus.VERIFICATION);
    const roles = [...db.steps.values()].filter((s) => s.workflowId === wfId).map((s) => s.approverRole);
    expect(roles).toEqual([UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION]);
  });

  it('migration skips MPRs that are no longer waiting, and is safe to run twice', async () => {
    seedMpr('m6', { headApprovedBy: 'ph', mprStatus: MPRStatus.CANCELLED });
    seedMpr('m7', { headApprovedBy: 'hoc' });
    expect(await migrateLegacyMprWorkflows()).toBe(1);
    expect(db.mprs.get('m6').status).toBe(MPRStatus.CANCELLED);
    expect(await migrateLegacyMprWorkflows()).toBe(0);
    expect(createQuotationFromMpr).toHaveBeenCalledTimes(1);
  });
});
