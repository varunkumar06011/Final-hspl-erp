import { prisma } from '../config/prisma';
import { findApprovableStep as sharedFindApprovableStep, canOverrideApprovals, APPROVER_ROLES, ApprovalStatus, ApprovalStepStatus, UserRole, APPROVAL_CONFIG, AuditAction, isAdminRole, isApproverRole, isFirstLevelApproverRole } from '@hospital-erp/shared';
import { notifyAllHeads, notifyApprovers, notifyUser, NotificationPayload } from './push.service';
import { logAudit } from './audit.service';

interface InitiateParams {
  entityType: string;
  entityId: string;
  projectId: string;
  minApprovers?: number;
  approvalPolicy?: 'HEAD_GROUPS' | 'PO_SINGLE_APPROVER' | 'PO_HEAD_APPROVERS' | 'ANY_APPROVERS' | 'ADMIN_SINGLE_APPROVER' | 'HEAD_THEN_ADMIN';
}

const STEP_ROLES: { stepNumber: number; approverRole: UserRole }[] = APPROVER_ROLES.map(
  (approverRole, index) => ({ stepNumber: index + 1, approverRole })
);

/**
 * HEAD_THEN_ADMIN (POs, quotations, MPRs): a Project Head or Head of Construction
 * must approve first; only then does the request reach the admins, and one admin
 * approval completes it. Steps are: heads first, then every admin role.
 */
export const HEAD_THEN_ADMIN_POLICY = 'HEAD_THEN_ADMIN';

export function headThenAdminSteps(adminRoles: string[]) {
  const roles = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, ...adminRoles.filter((r) => isAdminRole(r))];
  return roles.map((approverRole, idx) => ({ stepNumber: idx + 1, approverRole, status: 'PENDING' as const }));
}

function hasHeadApproval(steps: { status: string; approverRole: string }[]): boolean {
  return steps.some((s) => s.status === ApprovalStepStatus.APPROVED && isFirstLevelApproverRole(s.approverRole));
}

function satisfiesApprovalPolicy(policy: string | null | undefined, steps: { status: string; approverRole: string }[], required: number): boolean {
  const approvedRoles = new Set(
    steps.filter((step) => step.status === ApprovalStepStatus.APPROVED).map((step) => step.approverRole),
  );

  if (policy === HEAD_THEN_ADMIN_POLICY) {
    return hasHeadApproval(steps) && [...approvedRoles].some((role) => isAdminRole(role));
  }
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
  MATERIAL_PURCHASE_REQUEST: 'materialPurchaseRequest',
};

const ENTITY_URL_MAP: Record<string, string> = {
  QUOTATION: '/quotations',
  PURCHASE_ORDER: '/pos',
  VENDOR_INVOICE: '/invoices',
  PAYMENT_REQUEST: '/payments',
  JOURNAL_VOUCHER: '/vouchers',
  MATERIAL_PURCHASE_REQUEST: '/material-purchase-requests',
};

const ENTITY_LABEL_MAP: Record<string, string> = {
  QUOTATION: 'Quotation',
  PURCHASE_ORDER: 'Purchase Order',
  VENDOR_INVOICE: 'Invoice',
  PAYMENT_REQUEST: 'Payment Request',
  JOURNAL_VOUCHER: 'Journal Voucher',
  MATERIAL_PURCHASE_REQUEST: 'Material Purchase Request',
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
  MATERIAL_PURCHASE_REQUEST: { approved: 'APPROVED', rejected: 'REJECTED' },
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

// Field holding the human-readable number of each approvable record.
const ENTITY_NUMBER_FIELD: Record<string, string> = {
  QUOTATION: 'quotationNumber',
  PURCHASE_ORDER: 'poNumber',
  VENDOR_INVOICE: 'invoiceCode',
  PAYMENT_REQUEST: 'requestNumber',
  JOURNAL_VOUCHER: 'jvNumber',
  MATERIAL_PURCHASE_REQUEST: 'mprNumber',
};

// The Comments module (and each page's comment button) uses INVOICE for vendor invoices.
const COMMENT_ENTITY_TYPE: Record<string, string> = { VENDOR_INVOICE: 'INVOICE' };

/**
 * An approve/reject comment is the same thing as a comment in the Comments module:
 * store it there too so others can reply, and the approver can edit or delete it.
 */
async function recordDecisionComment(
  step: { id: string; workflow: { entityType: string; entityId: string; projectId: string } },
  userId: string,
  decision: 'APPROVED' | 'REJECTED',
  text: string | undefined,
): Promise<void> {
  const body = text?.trim();
  if (!body) return;
  try {
    const { entityType, entityId, projectId } = step.workflow;
    let entityLabel: string | null = null;
    const modelName = ENTITY_MODEL_MAP[entityType];
    const numberField = ENTITY_NUMBER_FIELD[entityType];
    if (modelName && numberField) {
      const row = await (prisma as any)[modelName].findUnique({
        where: { id: entityId },
        select: { [numberField]: true },
      });
      entityLabel = row?.[numberField] ?? null;
    }
    await prisma.comment.create({
      data: {
        projectId,
        entityType: COMMENT_ENTITY_TYPE[entityType] ?? entityType,
        entityId,
        entityLabel,
        url: ENTITY_URL_MAP[entityType] ?? null,
        authorId: userId,
        body,
        decision,
        approvalStepId: step.id,
      },
    });
  } catch (err) {
    console.error('[Comments] Failed to record approval comment:', err);
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
  actorId: string,
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
  notifyAllHeads(projectId, payload, actorId).catch((err) =>
    console.error('[Push] Approval result heads notification error:', err)
  );

  // Notify the creator (if different from the actor and has a subscription)
  if (createdBy && createdBy !== actorId) {
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
  let stepRows: { stepNumber: number; approverRole: string; status: string }[] = STEP_ROLES.map((sr) => ({ ...sr, status: ApprovalStepStatus.PENDING }));
  if (approvalPolicy === HEAD_THEN_ADMIN_POLICY) {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { role: true } });
    stepRows = headThenAdminSteps(Array.from(new Set(users.map((u) => u.role))));
  }

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
        create: stepRows,
      },
    },
    include: { steps: true },
  });

  return workflow;
}

/** Route-level check: may this user decide any approval step (super admin / granted override)? */
export function canOverride(user: { role: string; extraPermissions?: string[] | null }): boolean {
  return canOverrideApprovals(user.role, user.extraPermissions);
}

/**
 * The pending step this user may decide: the one for their own role, or — for a
 * user holding APPROVAL_OVERRIDE (super admin) — the earliest pending step.
 */
export const findApprovableStep = sharedFindApprovableStep;

/** Marks an override decision so the audit trail shows it was not a normal role approval. */
function overrideNote(step: { approverRole: string }, userName: string, verb: 'Approved' | 'Rejected') {
  return `${verb} by ${userName} (super admin override of ${step.approverRole} step)`;
}

/** Admins cannot act on a HEAD_THEN_ADMIN request until a head has approved it. */
async function assertHeadApprovedFirst(
  step: { workflowId: string; workflow: { approvalPolicy: string | null } },
  role: string,
): Promise<void> {
  if (step.workflow.approvalPolicy !== HEAD_THEN_ADMIN_POLICY || !isAdminRole(role)) return;
  const steps = await prisma.approvalStep.findMany({
    where: { workflowId: step.workflowId },
    select: { status: true, approverRole: true },
  });
  if (!hasHeadApproval(steps)) {
    throw new Error('Project Head or Head of Construction must approve this first');
  }
}

export async function approve(
  stepId: string,
  userId: string,
  comments?: string,
  opts: { allowAfterFinal?: boolean } = {},
) {
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

  const alreadyFinal = step.workflow.status === ApprovalStatus.APPROVED;
  if (step.workflow.status === ApprovalStatus.REJECTED || (alreadyFinal && !opts.allowAfterFinal)) {
    throw new Error(`Workflow is already ${step.workflow.status.toLowerCase()}`);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  // A super admin (APPROVAL_OVERRIDE) may decide any step, in any order, whatever their own role.
  const isOverride = canOverrideApprovals(user.role, user.extraPermissions);
  if (user.role !== step.approverRole && !isOverride) {
    throw new Error(`Only ${step.approverRole} can approve this step`);
  }
  const plainComments = comments;

  if (!isOverride) await assertHeadApprovedFirst(step, user.role);

  // An override user may decide several steps of the same workflow (head + admin).
  const existingDecision = isOverride
    ? null
    : await prisma.approvalStep.findFirst({
        where: {
          workflowId: step.workflowId,
          approverUserId: userId,
          status: { in: [ApprovalStepStatus.APPROVED, ApprovalStepStatus.REJECTED] },
        },
      });

  if (existingDecision) {
    throw new Error('You have already decided on this workflow');
  }

  if (isOverride) {
    comments = [overrideNote(step, user.name, 'Approved'), comments?.trim()].filter(Boolean).join(' — ');
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
  await recordDecisionComment(step, userId, 'APPROVED', comments);

  // ── D20: Write approval decisions to the audit log ──
  await logAudit({
    userId,
    action: AuditAction.APPROVE,
    entityType: step.workflow.entityType,
    entityId: step.workflow.entityId,
    projectId: step.workflow.projectId,
    oldValue: { stepStatus: ApprovalStepStatus.PENDING, stepNumber: step.stepNumber },
    newValue: {
      stepStatus: ApprovalStepStatus.APPROVED,
      stepNumber: step.stepNumber,
      comments,
      ...(isOverride ? { override: true, overriddenRole: step.approverRole } : {}),
    },
  }).catch((err) => console.error('[Audit] Approval log error:', err));

  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id: step.workflowId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!workflow) {
    throw new Error('Workflow not found');
  }

  // Late approval on an already-approved workflow: just record the step.
  if (alreadyFinal) {
    return { workflow, step: updatedStep, isFullyApproved: false };
  }

  const approvedSteps = workflow.steps.filter(
    (s: { status: string }) => s.status === ApprovalStepStatus.APPROVED
  );

  // For single-approver policies (e.g. ADMIN_SINGLE_APPROVER), the policy
  // itself is the gate — no minimum count needed. For multi-approver
  // policies, require both the count AND the policy to be satisfied.
  const isSingleApproverPolicy = workflow.approvalPolicy === 'ADMIN_SINGLE_APPROVER'
    || workflow.approvalPolicy === 'PO_SINGLE_APPROVER';
  const countSatisfied = isSingleApproverPolicy || workflow.approvalPolicy === HEAD_THEN_ADMIN_POLICY
    ? approvedSteps.length >= 1
    : approvedSteps.length >= workflow.minApprovers;

  const policySatisfied = countSatisfied && satisfiesApprovalPolicy(workflow.approvalPolicy, workflow.steps, workflow.minApprovers);

  // A super admin's single approval settles the whole request: carry on through the
  // remaining pending steps (each audited as an override) instead of making them click again.
  if (isOverride && !policySatisfied) {
    const nextPending = workflow.steps.find((s: { status: string }) => s.status === ApprovalStepStatus.PENDING);
    if (nextPending) return approve(nextPending.id, userId, plainComments, opts);
  }

  if (policySatisfied) {
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
      `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?id=${workflow.entityId}`,
      entityInfo.projectId || workflow.projectId,
      entityInfo.createdBy,
      userId,
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

  // A head just signed off — only now does the request go to the admins.
  if (workflow.approvalPolicy === HEAD_THEN_ADMIN_POLICY && isFirstLevelApproverRole(step.approverRole)) {
    const adminRoles = workflow.steps
      .filter((s) => isAdminRole(s.approverRole) && s.status === ApprovalStepStatus.PENDING)
      .map((s) => s.approverRole as UserRole);
    const entityUrl = `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?id=${workflow.entityId}`;
    notifyApprovers(entityInfo.projectId || workflow.projectId, adminRoles, {
      approvalId: workflow.id,
      entityType: workflow.entityType,
      entityId: workflow.entityId,
      title: 'Approval Required',
      body: `${entityInfo.label} approved by ${user.name} — awaiting your approval`,
      url: entityUrl,
    }, userId).catch((err) => console.error('[Push] Admin approval notification error:', err));
  }
  notifyApprovalResult(
    workflow.entityType,
    workflow.entityId,
    'approved',
    user.name,
    false,
    entityInfo.label,
    `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?id=${workflow.entityId}`,
    entityInfo.projectId || workflow.projectId,
    entityInfo.createdBy,
    userId,
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

  const isOverride = canOverrideApprovals(user.role, user.extraPermissions);
  if (user.role !== step.approverRole && !isOverride) {
    throw new Error(`Only ${step.approverRole} can reject this step`);
  }

  if (!isOverride) await assertHeadApprovedFirst(step, user.role);

  const existingDecision = isOverride
    ? null
    : await prisma.approvalStep.findFirst({
        where: {
          workflowId: step.workflowId,
          approverUserId: userId,
          status: { in: [ApprovalStepStatus.APPROVED, ApprovalStepStatus.REJECTED] },
        },
      });
  if (existingDecision) {
    throw new Error('You have already decided on this workflow');
  }

  if (isOverride) {
    reason = [overrideNote(step, user.name, 'Rejected'), reason?.trim()].filter(Boolean).join(' — ');
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
  await recordDecisionComment(step, userId, 'REJECTED', reason);

  // ── D20: Write rejection decisions to the audit log ──
  await logAudit({
    userId,
    action: AuditAction.REJECT,
    entityType: step.workflow.entityType,
    entityId: step.workflow.entityId,
    projectId: step.workflow.projectId,
    oldValue: { stepStatus: ApprovalStepStatus.PENDING, stepNumber: step.stepNumber },
    newValue: {
      stepStatus: ApprovalStepStatus.REJECTED,
      stepNumber: step.stepNumber,
      reason,
      ...(isOverride ? { override: true, overriddenRole: step.approverRole } : {}),
    },
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
  const isFullyRejected = workflow.approvalPolicy === HEAD_THEN_ADMIN_POLICY
    ? rejectedCount >= 1
    : rejectedCount >= workflow.minApprovers;
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
    `${ENTITY_URL_MAP[workflow.entityType] ?? '/'}?id=${workflow.entityId}`,
    entityInfo.projectId || workflow.projectId,
    entityInfo.createdBy,
    userId,
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
