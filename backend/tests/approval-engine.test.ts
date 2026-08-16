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
            if (where.status && s.status !== where.status) return false;
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
          };
          return users[where.id] ?? null;
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
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0].approverRole).toBe(UserRole.PROJECT_HEAD);
    expect(wf.steps[1].approverRole).toBe(UserRole.HEAD_OF_CONSTRUCTION);
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

  it('rejection at any step → REJECTED, no further approvals accepted', async () => {
    const wf = await initiate({
      entityType: 'PAYMENT_REQUEST',
      entityId: 'entity-5',
      projectId: 'project-1',
    });

    const step1 = wf.steps[0];
    const result = await reject(step1.id, 'user-1', 'Not valid');

    expect(result.workflow.status).toBe(ApprovalStatus.REJECTED);

    const freshWf = await getState(wf.id);
    const step2 = freshWf.steps[1];
    await expect(approve(step2.id, 'user-2', 'Trying to approve after rejection')).rejects.toThrow(
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
});
