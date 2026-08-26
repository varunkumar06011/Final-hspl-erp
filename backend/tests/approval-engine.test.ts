import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalStatus, ApprovalStepStatus, UserRole } from '@hospital-erp/shared';

vi.mock('../src/config/prisma', () => {
  const steps: Map<string, any> = new Map();
  const workflows: Map<string, any> = new Map();
  let idCounter = 0;
  const genId = () => `id-${++idCounter}`;

  return {
    prisma: {
      approvalWorkflow: {
        create: vi.fn(async ({ data }: any) => {
          const wfId = genId();
          const stepsData = data.steps?.create ?? [];
          const createdSteps = stepsData.map((s: any, i: number) => ({
            id: genId(),
            workflowId: wfId,
            stepNumber: s.stepNumber,
            approverRole: s.approverRole,
            status: s.status ?? ApprovalStepStatus.PENDING,
            approverUserId: null,
            decidedAt: null,
            comments: null,
            createdAt: new Date(),
          }));
          const wf = {
            id: wfId,
            entityType: data.entityType,
            entityId: data.entityId,
            projectId: data.projectId,
            status: data.status ?? ApprovalStatus.VERIFICATION,
            currentStep: data.currentStep ?? 0,
            minApprovers: data.minApprovers ?? 2,
            createdAt: new Date(),
            updatedAt: new Date(),
            steps: createdSteps,
          };
          workflows.set(wfId, wf);
          createdSteps.forEach((s: any) => steps.set(s.id, { ...s, workflow: wf }));
          return wf;
        }),
        findUnique: vi.fn(({ where }: any) => {
          const wf = workflows.get(where.id);
          if (!wf) return null;
          const wfSteps = Array.from(steps.values()).filter((s) => s.workflowId === wf.id);
          return { ...wf, steps: wfSteps.sort((a, b) => a.stepNumber - b.stepNumber) };
        }),
        update: vi.fn(({ where, data }: any) => {
          const wf = workflows.get(where.id);
          if (!wf) return null;
          Object.assign(wf, data);
          const wfSteps = Array.from(steps.values()).filter((s) => s.workflowId === wf.id);
          return { ...wf, steps: wfSteps.sort((a, b) => a.stepNumber - b.stepNumber) };
        }),
      },
      approvalStep: {
        findUnique: vi.fn(({ where }: any) => {
          const step = steps.get(where.id);
          if (!step) return null;
          return { ...step, workflow: workflows.get(step.workflowId) };
        }),
        findFirst: vi.fn(({ where }: any) => {
          return Array.from(steps.values()).find((s) => {
            if (where.workflowId && s.workflowId !== where.workflowId) return false;
            if (where.approverUserId && s.approverUserId !== where.approverUserId) return false;
            if (where.status?.in && !where.status.in.includes(s.status)) return false;
            if (typeof where.status === 'string' && s.status !== where.status) return false;
            return true;
          }) ?? null;
        }),
        update: vi.fn(({ where, data }: any) => {
          const step = steps.get(where.id);
          if (!step) return null;
          Object.assign(step, data);
          return { ...step, workflow: workflows.get(step.workflowId) };
        }),
      },
      user: {
        findUnique: vi.fn(({ where }: any) => {
          const users: Record<string, any> = {
            'user-1': { id: 'user-1', role: UserRole.PROJECT_HEAD, name: 'Admin One' },
            'user-2': { id: 'user-2', role: UserRole.HEAD_OF_CONSTRUCTION, name: 'Admin Two' },
            'user-3': { id: 'user-3', role: UserRole.ADMIN, name: 'Admin Three' },
            'user-4': { id: 'user-4', role: UserRole.ADMIN_2, name: 'Admin Four' },
            'creator-1': { id: 'creator-1', role: UserRole.ACCOUNTANT, name: 'Creator One' },
          };
          return users[where.id] ?? null;
        }),
      },
      // Entity models used by findEntityCreator for segregation-of-duties checks
      quotation: {
        findUnique: vi.fn(({ where }: any) => {
          const entities: Record<string, any> = {
            'entity-1': { id: 'entity-1', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-2': { id: 'entity-2', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-3': { id: 'entity-3', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-4': { id: 'entity-4', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-5': { id: 'entity-5', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-6': { id: 'entity-6', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-self': { id: 'entity-self', createdBy: 'user-1', projectId: 'project-1' },
          };
          return entities[where.id] ?? null;
        }),
      },
      purchaseOrder: {
        findUnique: vi.fn(({ where }: any) => {
          const entities: Record<string, any> = {
            'entity-1': { id: 'entity-1', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-2': { id: 'entity-2', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-3': { id: 'entity-3', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-4': { id: 'entity-4', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-5': { id: 'entity-5', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-6': { id: 'entity-6', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-self': { id: 'entity-self', createdBy: 'user-1', projectId: 'project-1' },
          };
          return entities[where.id] ?? null;
        }),
      },
      vendorInvoice: {
        findUnique: vi.fn(({ where }: any) => {
          const entities: Record<string, any> = {
            'entity-1': { id: 'entity-1', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-2': { id: 'entity-2', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-3': { id: 'entity-3', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-4': { id: 'entity-4', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-5': { id: 'entity-5', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-6': { id: 'entity-6', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-self': { id: 'entity-self', createdBy: 'user-1', projectId: 'project-1' },
          };
          return entities[where.id] ?? null;
        }),
      },
      paymentRequest: {
        findUnique: vi.fn(({ where }: any) => {
          const entities: Record<string, any> = {
            'entity-1': { id: 'entity-1', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-2': { id: 'entity-2', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-3': { id: 'entity-3', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-4': { id: 'entity-4', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-5': { id: 'entity-5', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-6': { id: 'entity-6', createdBy: 'creator-1', projectId: 'project-1' },
            'entity-self': { id: 'entity-self', createdBy: 'user-1', projectId: 'project-1' },
          };
          return entities[where.id] ?? null;
        }),
      },
    },
  };
});

import { initiate, approve, reject, getState } from '../src/services/approval.service';

describe('Approval Engine Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('workflow initiates with correct state (CREATED → VERIFICATION)', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-1',
      projectId: 'project-1',
    });

    expect(wf.status).toBe(ApprovalStatus.VERIFICATION);
    expect(wf.minApprovers).toBe(2);
    expect(wf.steps).toHaveLength(4);
    expect(wf.steps.map((step: any) => step.approverRole)).toEqual([
      UserRole.PROJECT_HEAD,
      UserRole.HEAD_OF_CONSTRUCTION,
      UserRole.ADMIN,
      UserRole.ADMIN_2,
    ]);
    expect(wf.steps.every((s: any) => s.status === ApprovalStepStatus.PENDING)).toBe(true);
  });

  it('first approval advances state, second approval from different role → APPROVED', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-2',
      projectId: 'project-1',
    });

    const step1 = wf.steps[0];
    const result1 = await approve(step1.id, 'user-1', 'Looks good');
    expect(result1.isFullyApproved).toBe(false);

    const step2 = result1.workflow.steps[1];
    const result2 = await approve(step2.id, 'user-2', 'Approved');
    expect(result2.isFullyApproved).toBe(true);
    expect(result2.workflow.status).toBe(ApprovalStatus.APPROVED);
  });

  it('same person approving twice → rejected', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-3',
      projectId: 'project-1',
    });

    const step1 = wf.steps[0];
    await approve(step1.id, 'user-1', 'First approval');

    const freshWf = await getState(wf.id);
    const step2 = freshWf.steps[1];

    await expect(approve(step2.id, 'user-1', 'Trying again')).rejects.toThrow(
      'Only HEAD_OF_CONSTRUCTION can approve this step'
    );
  });

  it('wrong role cannot approve step → error', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-4',
      projectId: 'project-1',
    });

    const step1 = wf.steps[0]; // PROJECT_HEAD step
    await expect(approve(step1.id, 'user-2', 'Wrong role')).rejects.toThrow(
      'Only PROJECT_HEAD can approve this step'
    );
  });

  it('requires two distinct rejections before the workflow is rejected', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-5',
      projectId: 'project-1',
    });

    const firstResult = await reject(wf.steps[0].id, 'user-1', 'Not valid');
    expect(firstResult.isFullyRejected).toBe(false);
    expect(firstResult.workflow.status).toBe(ApprovalStatus.VERIFICATION);

    const secondResult = await reject(wf.steps[1].id, 'user-2', 'Also rejected');
    expect(secondResult.isFullyRejected).toBe(true);
    expect(secondResult.workflow.status).toBe(ApprovalStatus.REJECTED);

    await expect(approve(wf.steps[2].id, 'user-3', 'Trying after rejection')).rejects.toThrow(
      'Workflow is already rejected'
    );
  });

  it('getState returns full step history with timestamps and approver IDs', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-6',
      projectId: 'project-1',
    });

    const step1 = wf.steps[0];
    await approve(step1.id, 'user-1', 'Step 1 approved');

    const state = await getState(wf.id);
    const approvedStep = state.steps.find((s: any) => s.status === ApprovalStepStatus.APPROVED);
    expect(approvedStep).toBeDefined();
    expect(approvedStep!.approverUserId).toBe('user-1');
    expect(approvedStep!.decidedAt).toBeDefined();
  });

  // ─── Segregation of Duties: Self-Approval Prevention ──────────────────
  it('creator cannot approve their own record → error', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-self', // createdBy = 'user-1'
      projectId: 'project-1',
    });

    // user-1 is PROJECT_HEAD and is the creator
    const step1 = wf.steps[0]; // PROJECT_HEAD step
    await expect(approve(step1.id, 'user-1', 'Self approving')).rejects.toThrow(
      'You cannot approve a record you created'
    );
  });

  it('creator cannot reject their own record → error', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-self', // createdBy = 'user-1'
      projectId: 'project-1',
    });

    const step1 = wf.steps[0]; // PROJECT_HEAD step
    await expect(reject(step1.id, 'user-1', 'Self rejecting')).rejects.toThrow(
      'You cannot reject a record you created'
    );
  });

  it('non-creator approver can approve normally', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-1', // createdBy = 'creator-1' (not user-1 or user-2)
      projectId: 'project-1',
    });

    const step1 = wf.steps[0]; // PROJECT_HEAD step
    const result = await approve(step1.id, 'user-1', 'Approved by non-creator');
    expect(result.isFullyApproved).toBe(false); // needs 2 approvals
  });
});
