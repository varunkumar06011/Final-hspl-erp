import { prisma } from '../config/prisma';
import { APPROVER_ROLES, ApprovalStatus, ApprovalStepStatus, UserRole, APPROVAL_CONFIG } from '@hospital-erp/shared';
import { notifyAllHeads, notifyUser, NotificationPayload } from './push.service';

interface InitiateParams {
  entityType: string;
  entityId: string;
  projectId: string;
  minApprovers?: number;
  approvalPolicy?: 'HEAD_GROUPS' | 'PO_SINGLE_APPROVER';
}

const STEP_ROLES: { stepNumber: number; approverRole: UserRole }[] = APPROVER_ROLES.map(
  (approverRole, index) => ({ stepNumber: index + 1, approverRole })
);

function satisfiesApprovalPolicy(policy: string | null | undefined, steps: { status: string; approverRole: string }[], required: number): boolean {
  const approvedRoles = new Set(
    steps.filter((step) => step.status === ApprovalStepStatus.APPROVED).map((step) => step.approverRole),
  );

  if (policy === 'PO_SINGLE_APPROVER') {
    return approvedRoles.has(UserRole.ADMIN) || approvedRoles.has(UserRole.ADMIN_2);
  }
  if (policy !== 'HEAD_GROUPS') return approvedRoles.size >= required;

  const firstGroupApproved = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION]
    .some((role) => approvedRoles.has(role));
  const secondGroupApproved = [UserRole.ADMIN, UserRole.ADMIN_2]
    .filter((role) => approvedRoles.has(role)).length;

  return firstGroupApproved && secondGroupApproved >= (required >= 3 ? 2 : 1);
}

// ─── Entity type → Prisma model mapping for creator lookup ──
const ENTITY_MODEL_MAP: Record<string, string> = {
  QUOTATION: 'quotation',
  PURCHASE_ORDER: 'purchaseOrder',
  VENDOR_INVOICE: 'vendorInvoice',
  PAYMENT_REQUEST: 'paymentRequest',
};

const ENTITY_URL_MAP: Record<string, string> = {
  QUOTATION: '/quotations',
  PURCHASE_ORDER: '/pos',
  VENDOR_INVOICE: '/invoices',
  PAYMENT_REQUEST: '/payments',
};

const ENTITY_LABEL_MAP: Record<string, string> = {
  QUOTATION: 'Quotation',
  PURCHASE_ORDER: 'Purchase Order',
  VENDOR_INVOICE: 'Invoice',
  PAYMENT_REQUEST: 'Payment Request',
};

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

  if (approvedSteps.length >= workflow.minApprovers && satisfiesApprovalPolicy(workflow.approvalPolicy, workflow.steps, workflow.minApprovers)) {
    await prisma.approvalWorkflow.update({
      where: { id: workflow.id },
      data: { status: ApprovalStatus.APPROVED, currentStep: workflow.steps.length },
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

  const nextStep = workflow.steps.find(
    (s: { status: string; stepNumber: number }) => s.status === ApprovalStepStatus.PENDING
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
  const updatedWorkflow = await prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: { status: isFullyRejected ? ApprovalStatus.REJECTED : workflow.status },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
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
