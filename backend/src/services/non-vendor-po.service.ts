import { POStatus, POPaymentType, AuditAction, UserRole, VendorType, isAdminRole } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { generateSequenceNumber } from './sequence.service';
import { logAudit } from './audit.service';
import { notifyApprovers } from './push.service';

/** Active admin roles (ADMIN, ADMIN_2, ...) for a project — the PO approvers. */
export async function getActiveAdminRoles(projectId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { projectId, isActive: true },
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
  return generateSequenceNumber('purchaseOrder', 'poNumber', 'VGH-PO', 3, { projectId });
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
 * straight to a Purchase Order. The PO starts at amount 0 with the MPR's items
 * at unit price 0; the creator fills in prices/GST via the PO edit dialog
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
        totalAmount: 0,
        gstAmount: 0,
        grandTotal: 0,
        totalDeductions: 0,
        netPayable: 0,
        createdBy: userId,
        items: {
          create: mpr.items.map((item) => ({
            materialName: item.materialName,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: 0,
            amount: 0,
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
        approvalPolicy: 'PO_SINGLE_APPROVER',
        steps: {
          create: adminRoles.map((role, idx) => ({ stepNumber: idx + 1, approverRole: role, status: 'PENDING' })),
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
    newValue: { poNumber, mprId: mpr.id, mprNumber: mpr.mprNumber, source: 'NON_VENDOR_MPR', grandTotal: 0 },
  });

  notifyApprovers(projectId, adminRoles as UserRole[], {
    approvalId: po.approvalWorkflowId ?? '',
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    title: 'New Non-Vendor PO',
    body: `Purchase Order ${poNumber} raised from ${mpr.mprNumber} — amount to be filled in`,
    url: `/pos?id=${po.id}`,
  }).catch((err) => console.error('[Push] Non-vendor PO notification error:', err));

  return po;
}
