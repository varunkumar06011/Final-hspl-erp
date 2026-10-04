import { POStatus, POPaymentType, AuditAction, UserRole, VendorType, isAdminRole, FIRST_LEVEL_APPROVER_ROLES } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { generateProjectSequenceNumber } from './sequence.service';
import { logAudit } from './audit.service';
import { notifyApprovers } from './push.service';
import { HEAD_THEN_ADMIN_POLICY, headThenAdminSteps } from './approval.service';

/** Active admin roles (ADMIN, ADMIN_2, ...) for a project — the PO approvers. */
export async function getActiveAdminRoles(_projectId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { role: true },
  });
  const adminRoles = users.map((u) => u.role).filter((r) => isAdminRole(r));
  return Array.from(new Set(adminRoles)).sort((a, b) => {
    const na = a === 'ADMIN' ? 1 : parseInt(a.split('_')[1] ?? '0', 10);
    const nb = b === 'ADMIN' ? 1 : parseInt(b.split('_')[1] ?? '0', 10);
    return na - nb;
  });
}

export async function generatePONumber(projectId: string): Promise<string> {
  return generateProjectSequenceNumber('purchaseOrder', 'poNumber', 'PO', 3, projectId);
}

/** A live (not deleted/cancelled/rejected) PO already raised from this MPR, if any. */
export function findLivePoForMpr(mprId: string) {
  return prisma.purchaseOrder.findFirst({
    where: {
      mprId,
      deletedAt: null,
      status: { notIn: [POStatus.DELETED, POStatus.CANCELLED, POStatus.REJECTED] },
    },
    select: { id: true, poNumber: true },
  });
}

/**
 * NON_VENDOR requests have no quotation, so once the MPR is approved it goes
 * straight to a Purchase Order. The PO inherits the MPR's rates (estimatedRate)
 * and quantities, so its amounts are already filled in. The MPR carries no GST,
 * so lines start at 0% GST; the creator can still adjust via the PO edit dialog
 * (edit-unapproved), which sends it to an admin for approval.
 *
 * Returns the created PO, or null if the MPR isn't an approved non-vendor
 * request or already has a live PO.
 */
export async function createNonVendorPoFromMpr(mprId: string, projectId: string, userId: string) {
  const mpr = await prisma.materialPurchaseRequest.findFirst({
    where: { id: mprId, projectId, deletedAt: null },
    include: { vendor: true, items: true },
  });
  if (!mpr || !mpr.vendorId || mpr.vendor?.vendorType !== VendorType.NON_VENDOR) return null;
  if (await findLivePoForMpr(mpr.id)) return null;

  const lines = mpr.items.map((item) => {
    const unitPrice = Number(item.estimatedRate ?? 0);
    return { item, unitPrice, amount: Math.round(Number(item.quantity) * unitPrice * 100) / 100 };
  });
  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  const poNumber = await generatePONumber(projectId);
  const adminRoles = await getActiveAdminRoles(projectId);

  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        projectId,
        vendorId: mpr.vendorId!,
        mprId: mpr.id,
        poNumber,
        status: POStatus.PENDING_APPROVAL,
        paymentType: POPaymentType.AFTER_DELIVERY,
        notes: mpr.description ?? null,
        totalAmount,
        gstAmount: 0,
        grandTotal: totalAmount,
        totalDeductions: 0,
        netPayable: totalAmount,
        createdBy: userId,
        items: {
          create: lines.map(({ item, unitPrice, amount }) => ({
            materialName: item.materialName,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice,
            amount,
            gstRate: 0,
          })),
        },
      },
    });
    const workflow = await tx.approvalWorkflow.create({
      data: {
        entityType: 'PURCHASE_ORDER',
        entityId: created.id,
        projectId,
        status: 'VERIFICATION',
        currentStep: 0,
        minApprovers: 1,
        approvalPolicy: HEAD_THEN_ADMIN_POLICY,
        steps: {
          create: headThenAdminSteps(adminRoles),
        },
      },
    });
    return tx.purchaseOrder.update({ where: { id: created.id }, data: { approvalWorkflowId: workflow.id } });
  });

  await logAudit({
    userId,
    action: AuditAction.CREATE,
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    projectId,
    newValue: { poNumber, mprId: mpr.id, mprNumber: mpr.mprNumber, source: 'NON_VENDOR_MPR', grandTotal: totalAmount },
  });

  notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
    approvalId: po.approvalWorkflowId ?? '',
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    title: 'New Non-Vendor PO',
    body: `Purchase Order ${poNumber} raised from ${mpr.mprNumber} — please review and approve`,
    url: `/pos?id=${po.id}`,
  }).catch((err) => console.error('[Push] Non-vendor PO notification error:', err));

  return po;
}
