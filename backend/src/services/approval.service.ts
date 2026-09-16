import { prisma } from '../config/prisma';
import { APPROVER_ROLES, ApprovalStatus, ApprovalStepStatus, UserRole, APPROVAL_CONFIG, AuditAction, isAdminRole, isApproverRole } from '@hospital-erp/shared';
import { notifyAllHeads, notifyUser, NotificationPayload } from './push.service';
import { logAudit } from './audit.service';

interface InitiateParams {
  entityType: string;
  entityId: string;
  projectId: string;
  minApprovers?: number;
  approvalPolicy?: 'HEAD_GROUPS' | 'PO_SINGLE_APPROVER' | 'PO_HEAD_APPROVERS' | 'ANY_APPROVERS' | 'ADMIN_SINGLE_APPROVER';
}

const STEP_ROLES: { stepNumber: number; approverRole: UserRole }[] = APPROVER_ROLES.map(
  (approverRole, index) => ({ stepNumber: index + 1, approverRole })
);

function satisfiesApprovalPolicy(policy: string | null | undefined, steps: { status: string; approverRole: string }[], required: number): boolean {
  const approvedRoles = new Set(
    steps.filter((step) => step.status === ApprovalStepStatus.APPROVED).map((step) => step.approverRole),
  );

  if (policy === 'PO_SINGLE_APPROVER' || policy === 'ADMIN_SINGLE_APPROVER') {
    // A single approval from any admin role (ADMIN, ADMIN_2, ADMIN_3, ...) is enough.
    return [...approvedRoles].some((role) => isAdminRole(role));
  }
  if (policy === 'PO_HEAD_APPROVERS' || policy === 'ANY_APPROVERS') {
    return [...approvedRoles].filter((role) => isApproverRole(role)).length >= required;
  }
  if (policy !== 'HEAD_GROUPS') return approvedRoles.size >= required;

  const firstGroupApproved = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION]
    .some((role) => approvedRoles.has(role));
  const secondGroupApproved = [...approvedRoles].filter((role) => isAdminRole(role)).length;

  return firstGroupApproved && secondGroupApproved >= (required >= 3 ? 2 : 1);
}

// ─── Entity type → Prisma model mapping for creator lookup ──
const ENTITY_MODEL_MAP: Record<string, string> = {
  QUOTATION: 'quotation',
  PURCHASE_ORDER: 'purchaseOrder',
  VENDOR_INVOICE: 'vendorInvoice',
  PAYMENT_REQUEST: 'paymentRequest',
  JOURNAL_VOUCHER: 'journalVoucher',
};

const ENTITY_URL_MAP: Record<string, string> = {
  QUOTATION: '/quotations',
  PURCHASE_ORDER: '/pos',
  VENDOR_INVOICE: '/invoices',
  PAYMENT_REQUEST: '/payments',
  JOURNAL_VOUCHER: '/journal-vouchers',
};

const ENTITY_LABEL_MAP: Record<string, string> = {
  QUOTATION: 'Quotation',
  PURCHASE_ORDER: 'Purchase Order',
  VENDOR_INVOICE: 'Invoice',
  PAYMENT_REQUEST: 'Payment Request',
  JOURNAL_VOUCHER: 'Journal Voucher',
};

// ─── Entity type → status to set when workflow is APPROVED/REJECTED ──
// Used to atomically sync the entity's status with the workflow status,
// so the entity never gets stuck in a stale "SUBMITTED/PENDING" state
// when its workflow has already been decided.
const ENTITY_STATUS_MAP: Record<string, { approved: string; rejected: string }> = {
  QUOTATION: { approved: 'APPROVED', rejected: 'REJECTED' },
  PURCHASE_ORDER: { approved: 'APPROVED', rejected: 'REJECTED' },
  VENDOR_INVOICE: { approved: 'APPROVED', rejected: 'REJECTED' },
  PAYMENT_REQUEST: { approved: 'APPROVED', rejected: 'REJECTED' },
  JOURNAL_VOUCHER: { approved: 'APPROVED', rejected: 'REJECTED' },
};

/**
 * Sync the entity's status with the workflow status, atomically within
 * the same Prisma transaction. This prevents the entity from getting stuck
 * in a stale status (e.g. SUBMITTED) when its approval workflow has
 * already been marked APPROVED or REJECTED.
 *
 * Must be called inside a `$transaction` callback.
 */
async function syncEntityStatusTx(
  tx: any,
  entityType: string,
  entityId: string,
  workflowStatus: ApprovalStatus,
): Promise<void> {
  const modelName = ENTITY_MODEL_MAP[entityType];
  if (!modelName) return;
  const statusMap = ENTITY_STATUS_MAP[entityType];
  if (!statusMap) return;

  let newStatus: string | null = null;
  if (workflowStatus === ApprovalStatus.APPROVED) {
    newStatus = statusMap.approved;
  } else if (workflowStatus === ApprovalStatus.REJECTED) {
    newStatus = statusMap.rejected;
  }
  if (!newStatus) return;

  try {
    await (tx as any)[modelName].update({
      where: { id: entityId },
      data: { status: newStatus },
    });
  } catch (err) {
    // Non-fatal: the reconciliation in the list/get endpoints will fix it
    // on the next read. Don't fail the entire approval.
    console.error(`[Approval] Failed to sync ${entityType} ${entityId} status to ${newStatus}:`, err);
  }
}

async function findEntityCreator(entityType: string, entityId: string): Promise<{ createdBy: string | null; projectId: string; label: string }> {
  const modelName = ENTITY_MODEL_MAP[entityType];
  if (!modelName) {
    // Fallback: get projectId from the workflow
    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
      select: { projectId: true },
    });
    return { createdBy: null, projectId: workflow?.projectId ?? '', label: entityType };
  }

  const model = (prisma as any)[modelName];
  const entity = await model.findUnique({
    where: { id: entityId },
    select: { createdBy: true, projectId: true },
  });

  return {
    createdBy: entity?.createdBy ?? null,
    projectId: entity?.projectId ?? '',
    label: ENTITY_LABEL_MAP[entityType] ?? entityType,
  };
}

async function notifyApprovalResult(
  entityType: string,
  entityId: string,
  action: 'approved' | 'rejected',
  actorName: string,
  isFinal: boolean,
  entityLabel: string,
  entityUrl: string,
  projectId: string,
  createdBy: string | null,
): Promise<void> {
  const status = action === 'approved' ? 'Approved' : 'Rejected';
  const title = isFinal ? `${entityLabel} ${status}` : `${entityLabel} — Step ${status}`;
  const body = `${action === 'approved' ? 'Approved' : 'Rejected'} by ${actorName}${isFinal ? ' (Final)' : ''}`;

  const payload: NotificationPayload = {
    entityType,
    entityId,
    title,
    body,
    url: entityUrl,
  };

  // Notify all 4 heads
  notifyAllHeads(projectId, payload).catch((err) =>
    console.error('[Push] Approval result heads notification error:', err)
  );

  // Notify the creator (if different from the actor and has a subscription)
  if (createdBy) {
    notifyUser(createdBy, payload).catch((err) =>
      console.error('[Push] Approval result creator notification error:', err)
    );
  }
}

export async function initiate({
  entityType,
  entityId,
  projectId,
  minApprovers,
  approvalPolicy,
}: InitiateParams) {
  const workflow = await prisma.approvalWorkflow.create({
    data: {
      entityType,
      entityId,
      projectId,
      status: ApprovalStatus.VERIFICATION,
      currentStep: 0,
      minApprovers: minApprovers ?? APPROVAL_CONFIG.MIN_APPROVERS,
      approvalPolicy: approvalPolicy ?? null,
      steps: {
        create: STEP_ROLES.map((sr) => ({
          stepNumber: sr.stepNumber,
          approverRole: sr.approverRole,
          status: ApprovalStepStatus.PENDING,
        })),
      },
    },
    include: { steps: true },
  });

  return workflow;
}

export async function approve(stepId: string, userId: string, comments?: string) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: { workflow: true },
  });

  if (!step) {
    throw new Error('Approval step not found');
  }

  if (step.status !== ApprovalStepStatus.PENDING) {
    throw new Error(`Step already ${step.status.toLowerCase()}`);
  }

  if ([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED].includes(step.workflow.status as ApprovalStatus)) {
    throw new Error(`Workflow is already ${step.workflow.status.toLowerCase()}`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== step.approverRole) {
    throw new Error(`Only ${step.approverRole} can approve this step`);
  }

  const existingDecision = await prisma.approvalStep.findFirst({
    where: {
      workflowId: step.workflowId,
      approverUserId: userId,
      status: { in: [ApprovalStepStatus.APPROVED, ApprovalStepStatus.REJECTED] },
    },
  });

  if (existingDecision) {
    throw new Error('You have already decided on this workflow');
  }

  const updatedStep = await prisma.approvalStep.update({
    where: { id: stepId },
    data: {
      status: ApprovalStepStatus.APPROVED,
      approverUserId: userId,
      decidedAt: new Date(),
      comments,
    },
  });

  // ── D20: Write approval decisions to the audit log ──
  await logAudit({
    userId,
    action: AuditAction.APPROVE,
    entityType: step.workflow.entityType,
    entityId: step.workflow.entityId,
    projectId: step.workflow.projectId,
    oldValue: { stepStatus: ApprovalStepStatus.PENDING, stepNumber: step.stepNumber },
    newValue: { stepStatus: ApprovalStepStatus.APPROVED, stepNumber: step.stepNumber, comments },
  }).catch((err) => console.error('[Audit] Approval log error:', err));

  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id: step.workflowId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const approvedSteps = workflow.steps.filter(
    (s: { status: string }) => s.status === ApprovalStepStatus.APPROVED
  );

  // For single-approver policies (e.g. ADMIN_SINGLE_APPROVER), the policy
  // itself is the gate — no minimum count needed. For multi-approver
  // policies, require both the count AND the policy to be satisfied.
  const isSingleApproverPolicy = workflow.approvalPolicy === 'ADMIN_SINGLE_APPROVER'
    || workflow.approvalPolicy === 'PO_SINGLE_APPROVER';
  const countSatisfied = isSingleApproverPolicy
    ? approvedSteps.length >= 1
    : approvedSteps.length >= workflow.minApprovers;

  if (countSatisfied && satisfiesApprovalPolicy(workflow.approvalPolicy, workflow.steps, workflow.minApprovers)) {
    // Atomically update the workflow status AND the entity status in a
    // single transaction, so the entity never gets stuck in a stale
    // "SUBMITTED/PENDING" state when its workflow is already APPROVED.
    await prisma.$transaction(async (tx) => {
      await tx.approvalWorkflow.update({
        where: { id: workflow.id },
        data: { status: ApprovalStatus.APPROVED, currentStep: workflow.steps.length },
      });
      await syncEntityStatusTx(tx, workflow.entityType, workflow.entityId, ApprovalStatus.APPROVED);
    });

    // Notify creator + all heads that the entity is fully approved
    const entityInfo = await findEntityCreator(workflow.entityType, workflow.entityId);
    notifyApprovalResult(
      workflow.entityType,
      workflow.entityId,
      'approved',
      user.name,
      true,
      entityInfo.label,
      `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?approval=${workflow.id}`,
      entityInfo.projectId || workflow.projectId,
      entityInfo.createdBy,
    ).catch((err) => console.error('[Push] Approval notification error:', err));

    return {
      workflow: { ...workflow, status: ApprovalStatus.APPROVED },
      step: updatedStep,
      isFullyApproved: true,
    };
  }

  // Find the next pending step, but never regress currentStep — if a higher-
  // numbered step was approved out of order (e.g. step 3 approved while step 2
  // is still pending), currentStep must stay at 3, not drop back to 2.
  const nextStep = workflow.steps.find(
    (s: { status: string; stepNumber: number }) =>
      s.status === ApprovalStepStatus.PENDING && s.stepNumber > workflow.currentStep,
  );

  let newStatus = workflow.status;
  let newCurrentStep = workflow.currentStep;

  if (nextStep) {
    newCurrentStep = nextStep.stepNumber;
    if (nextStep.stepNumber === 1) {
      newStatus = ApprovalStatus.APPROVAL_1;
    } else if (nextStep.stepNumber === 2) {
      newStatus = ApprovalStatus.APPROVAL_2;
    }
  }

  const updatedWorkflow = await prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: { status: newStatus, currentStep: newCurrentStep },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  // Notify creator + all heads that a step was approved (not final yet)
  const entityInfo = await findEntityCreator(workflow.entityType, workflow.entityId);
  notifyApprovalResult(
    workflow.entityType,
    workflow.entityId,
    'approved',
    user.name,
    false,
    entityInfo.label,
    `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?approval=${workflow.id}`,
    entityInfo.projectId || workflow.projectId,
    entityInfo.createdBy,
  ).catch((err) => console.error('[Push] Step approval notification error:', err));

  return {
    workflow: updatedWorkflow,
    step: updatedStep,
    isFullyApproved: false,
  };
}

export async function reject(stepId: string, userId: string, reason: string) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: { workflow: true },
  });

  if (!step) {
    throw new Error('Approval step not found');
  }

  if (step.status !== ApprovalStepStatus.PENDING) {
    throw new Error(`Step already ${step.status.toLowerCase()}`);
  }

  if ([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED].includes(step.workflow.status as ApprovalStatus)) {
    throw new Error(`Workflow is already ${step.workflow.status.toLowerCase()}`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== step.approverRole) {
    throw new Error(`Only ${step.approverRole} can reject this step`);
  }

  const existingDecision = await prisma.approvalStep.findFirst({
    where: {
      workflowId: step.workflowId,
      approverUserId: userId,
      status: { in: [ApprovalStepStatus.APPROVED, ApprovalStepStatus.REJECTED] },
    },
  });
  if (existingDecision) {
    throw new Error('You have already decided on this workflow');
  }

  const updatedStep = await prisma.approvalStep.update({
    where: { id: stepId },
    data: {
      status: ApprovalStepStatus.REJECTED,
      approverUserId: userId,
      decidedAt: new Date(),
      comments: reason,
    },
  });

  // ── D20: Write rejection decisions to the audit log ──
  await logAudit({
    userId,
    action: AuditAction.REJECT,
    entityType: step.workflow.entityType,
    entityId: step.workflow.entityId,
    projectId: step.workflow.projectId,
    oldValue: { stepStatus: ApprovalStepStatus.PENDING, stepNumber: step.stepNumber },
    newValue: { stepStatus: ApprovalStepStatus.REJECTED, stepNumber: step.stepNumber, reason },
  }).catch((err) => console.error('[Audit] Rejection log error:', err));

  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id: step.workflowId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const rejectedCount = workflow.steps.filter(
    (workflowStep) => workflowStep.status === ApprovalStepStatus.REJECTED
  ).length;
  const isFullyRejected = rejectedCount >= workflow.minApprovers;
  const newWorkflowStatus = isFullyRejected ? ApprovalStatus.REJECTED : workflow.status;

  // Atomically update the workflow status AND the entity status in a
  // single transaction, so the entity never gets stuck in a stale state
  // when its workflow has already been REJECTED.
  const updatedWorkflow = await prisma.$transaction(async (tx) => {
    const wf = await tx.approvalWorkflow.update({
      where: { id: workflow.id },
      data: { status: newWorkflowStatus },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    if (isFullyRejected) {
      await syncEntityStatusTx(tx, workflow.entityType, workflow.entityId, ApprovalStatus.REJECTED);
    }
    return wf;
  });

  // Notify creator + all heads about the rejection
  const entityInfo = await findEntityCreator(workflow.entityType, workflow.entityId);
  notifyApprovalResult(
    workflow.entityType,
    workflow.entityId,
    'rejected',
    user.name,
    isFullyRejected,
    entityInfo.label,
    `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?approval=${workflow.id}`,
    entityInfo.projectId || workflow.projectId,
    entityInfo.createdBy,
  ).catch((err) => console.error('[Push] Rejection notification error:', err));

  return {
    workflow: updatedWorkflow,
    step: updatedStep,
    isFullyApproved: false,
    isFullyRejected,
  };
}

export async function getState(workflowId: string) {
  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' },
        include: {
          approverUser: {
            select: { id: true, name: true, role: true },
          },
        },
      },
    },
  });

  if (!workflow) {
    throw new Error('Workflow not found');
  }

  return workflow;
}

export async function getWorkflowByEntity(entityType: string, entityId: string) {
  return prisma.approvalWorkflow.findUnique({
    where: {
      entityType_entityId: { entityType, entityId },
    },
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' },
        include: {
          approverUser: {
            select: { id: true, name: true, role: true },
          },
        },
      },
    },
  });
}
