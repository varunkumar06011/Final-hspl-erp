import { POStatus, POPaymentType, AuditAction, UserRole, FIRST_LEVEL_APPROVER_ROLES } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { logAudit } from './audit.service';
import { notifyApprovers } from './push.service';
import { HEAD_THEN_ADMIN_POLICY, headThenAdminSteps } from './approval.service';
import { generatePONumber, getActiveAdminRoles } from './non-vendor-po.service';

const DEAD_STATUSES = [POStatus.DELETED, POStatus.CANCELLED, POStatus.REJECTED];

/**
 * Raises the Purchase Order for an approved quotation automatically, so nobody
 * has to press "Generate PO". The PO is created PENDING_APPROVAL (waiting for the
 * heads and an admin) with the quotation's items and totals. Budget head and
 * payment type are NOT asked for here: the payment type starts as AFTER_DELIVERY
 * and the budget head is empty; both are set afterwards by editing the PO, which
 * works before and after approval without sending it back for approval.
 *
 * Returns null when the quotation is not approved or already has a live PO.
 */
export async function createPoFromApprovedQuotation(quotationId: string, userId: string) {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    include: { items: true, vendor: { select: { name: true } } },
  });
  if (!quotation || quotation.status !== 'APPROVED') return null;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { quotationId: quotation.id, deletedAt: null, status: { notIn: DEAD_STATUSES } },
    select: { id: true },
  });
  if (existing) return null;

  const projectId = quotation.projectId;
  const totalAmount = Number(quotation.totalAmount);
  const gstAmount = quotation.items.reduce(
    (sum, item) => sum + (Number(item.amount) * Number(item.gstRate)) / 100,
    0,
  );
  const grandTotal = totalAmount + gstAmount;

  const poNumber = await generatePONumber(projectId);
  const adminRoles = await getActiveAdminRoles(projectId);

  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        projectId,
        vendorId: quotation.vendorId,
        quotationId: quotation.id,
        poNumber,
        status: POStatus.PENDING_APPROVAL,
        paymentType: POPaymentType.AFTER_DELIVERY,
        notes: quotation.notes ?? null,
        totalAmount,
        gstAmount,
        grandTotal,
        totalDeductions: 0,
        netPayable: grandTotal,
        createdBy: userId,
        items: {
          create: quotation.items.map((item) => ({
            materialName: item.materialName,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            amount: item.amount,
            gstRate: item.gstRate,
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
        steps: { create: headThenAdminSteps(adminRoles) },
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
    newValue: {
      poNumber,
      quotationId: quotation.id,
      quotationNumber: quotation.quotationNumber,
      source: 'AUTO_FROM_QUOTATION',
      grandTotal,
      acknowledged: true,
    },
  });

  notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
    approvalId: po.approvalWorkflowId ?? '',
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    title: 'New Approval Required',
    body: `Purchase Order ${poNumber} — ${quotation.vendor?.name ?? 'vendor'} — ₹${grandTotal}`,
    url: `/pos?id=${po.id}`,
  }).catch((err) => console.error('[Push] Auto PO notification error:', err));

  return po;
}
