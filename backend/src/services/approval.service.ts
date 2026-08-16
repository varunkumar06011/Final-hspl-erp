import { prisma } from '../config/prisma';
import { ApprovalStatus, ApprovalStepStatus, UserRole, APPROVAL_CONFIG } from '@hospital-erp/shared';

interface InitiateParams {
  entityType: string;
  entityId: string;
  projectId: string;
  minApprovers?: number;
}

const STEP_ROLES: { stepNumber: number; approverRole: UserRole }[] = [
  { stepNumber: 1, approverRole: UserRole.PROJECT_HEAD },
  { stepNumber: 2, approverRole: UserRole.HEAD_OF_CONSTRUCTION },
];

export async function initiate({
  entityType,
  entityId,
  projectId,
  minApprovers,
}: InitiateParams) {
  const workflow = await prisma.approvalWorkflow.create({
    data: {
      entityType,
      entityId,
      projectId,
      status: ApprovalStatus.VERIFICATION,
      currentStep: 0,
      minApprovers: minApprovers ?? APPROVAL_CONFIG.MIN_APPROVERS,
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

  if (step.workflow.status === ApprovalStatus.REJECTED) {
    throw new Error('Workflow is already rejected — no further approvals accepted');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== step.approverRole) {
    throw new Error(`Only ${step.approverRole} can approve this step`);
  }

  const existingApproval = await prisma.approvalStep.findFirst({
    where: {
      workflowId: step.workflowId,
      approverUserId: userId,
      status: ApprovalStepStatus.APPROVED,
    },
  });

  if (existingApproval) {
    throw new Error('Same person cannot approve twice');
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

  if (approvedSteps.length >= workflow.minApprovers) {
    await prisma.approvalWorkflow.update({
      where: { id: workflow.id },
      data: { status: ApprovalStatus.APPROVED, currentStep: workflow.steps.length },
    });

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

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== step.approverRole) {
    throw new Error(`Only ${step.approverRole} can reject this step`);
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

  const updatedWorkflow = await prisma.approvalWorkflow.update({
    where: { id: step.workflowId },
    data: { status: ApprovalStatus.REJECTED },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  return {
    workflow: updatedWorkflow,
    step: updatedStep,
    isFullyApproved: false,
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
