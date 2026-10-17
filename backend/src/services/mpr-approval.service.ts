import { prisma } from '../config/prisma';
import { ApprovalStatus, ApprovalStepStatus, MPRStatus, UserRole } from '@hospital-erp/shared';
import { MPR_APPROVAL_POLICY } from './approval.service';
import { createNonVendorPoFromMpr } from './non-vendor-po.service';
import { createQuotationFromMpr } from './quotation.service';

const HEAD_ROLES: string[] = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION];
const OPEN_WORKFLOW_STATUSES = [ApprovalStatus.CREATED, ApprovalStatus.VERIFICATION, ApprovalStatus.APPROVAL_1, ApprovalStatus.APPROVAL_2];

/**
 * What follows a fully approved MPR: a non-vendor request goes straight to a PO
 * (amount 0, to be filled in); a vendor request gets its first quotation (request's
 * vendor + rates), ready to be finalized. Both skip work that already exists.
 */
export async function afterMprApproved(mprId: string, projectId: string, userId: string): Promise<void> {
  await createNonVendorPoFromMpr(mprId, projectId, userId)
    .catch((err) => console.error('[MPR] Non-vendor PO auto-create failed (non-fatal):', err));
  await createQuotationFromMpr(mprId, projectId, userId)
    .catch((err) => console.error('[MPR] Auto quotation failed (non-fatal):', err));
}

/**
 * MPRs submitted before the heads-only rule still carry the old head-then-admin
 * (or head-groups) workflow with admin steps, so a head's approval left them
 * waiting on an admin who can no longer act. Moves every open one to the
 * heads-only policy (pending non-head steps dropped), and approves those a
 * head has already signed. Idempotent.
 */
export async function migrateLegacyMprWorkflows(): Promise<number> {
  const workflows = await prisma.approvalWorkflow.findMany({
    where: {
      entityType: 'MATERIAL_PURCHASE_REQUEST',
      status: { in: OPEN_WORKFLOW_STATUSES },
      OR: [{ approvalPolicy: null }, { approvalPolicy: { not: MPR_APPROVAL_POLICY } }],
    },
    include: { steps: true, materialPurchaseRequest: { select: { id: true, status: true, createdBy: true } } },
  });

  let settled = 0;
  for (const workflow of workflows) {
    const mpr = workflow.materialPurchaseRequest;
    if (!mpr || mpr.status !== MPRStatus.SUBMITTED) continue;

    const headApproval = workflow.steps.find(
      (s) => s.status === ApprovalStepStatus.APPROVED && HEAD_ROLES.includes(s.approverRole),
    );
    const staleSteps = workflow.steps.filter(
      (s) => s.status === ApprovalStepStatus.PENDING && !HEAD_ROLES.includes(s.approverRole),
    );
    const missingHeads = HEAD_ROLES.filter((role) => !workflow.steps.some((s) => s.approverRole === role));
    let nextStepNumber = Math.max(0, ...workflow.steps.map((s) => s.stepNumber)) + 1;

    const approved = await prisma.$transaction(async (tx) => {
      if (staleSteps.length > 0) {
        await tx.approvalStep.deleteMany({ where: { id: { in: staleSteps.map((s) => s.id) } } });
      }
      for (const role of missingHeads) {
        await tx.approvalStep.create({
          data: { workflowId: workflow.id, stepNumber: nextStepNumber++, approverRole: role, status: ApprovalStepStatus.PENDING },
        });
      }
      await tx.approvalWorkflow.update({
        where: { id: workflow.id },
        data: {
          approvalPolicy: MPR_APPROVAL_POLICY,
          minApprovers: 1,
          ...(headApproval ? { status: ApprovalStatus.APPROVED, currentStep: nextStepNumber - 1 } : {}),
        },
      });
      if (!headApproval) return false;
      const claimed = await tx.materialPurchaseRequest.updateMany({
        where: { id: mpr.id, status: MPRStatus.SUBMITTED },
        data: { status: MPRStatus.APPROVED },
      });
      return claimed.count > 0;
    });

    if (approved) {
      settled++;
      await afterMprApproved(mpr.id, workflow.projectId, headApproval!.approverUserId ?? mpr.createdBy);
    }
  }

  if (workflows.length > 0) {
    console.log(`[MPR] Moved ${workflows.length} open MPR workflow(s) to heads-only approval; ${settled} already head-approved and now APPROVED`);
  }
  return settled;
}
