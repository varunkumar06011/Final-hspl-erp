import { Prisma } from '@prisma/client';
import { POStatus, QuotationStatus, AuditAction, UserRole, FIRST_LEVEL_APPROVER_ROLES } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { logAudit } from './audit.service';
import { notifyApprovers } from './push.service';
import { getActiveAdminRoles } from './non-vendor-po.service';
import { HEAD_THEN_ADMIN_POLICY, headThenAdminSteps } from './approval.service';

/**
 * MPR revision flow: an approved MPR that already has quotation(s)/PO(s) can
 * still gain items or change quantities. The change is pushed into the linked
 * quotation(s) (new lines at price 0, so the amounts can be entered), and once
 * every line is priced the live PO is re-synced and sent back for approval.
 */

const norm = (s: string) => s.trim().toLowerCase();
const isUnpriced = (i: { unitPrice: Prisma.Decimal | number }) => Number(i.unitPrice) <= 0;

/** PO states in which items can still be revised (nothing delivered yet). */
export const REVISABLE_PO_STATUSES: string[] = [POStatus.APPROVED, POStatus.PENDING_APPROVAL];

export const hasUnpricedItems = (items: Array<{ unitPrice: Prisma.Decimal | number }>) => items.some(isUnpriced);

interface MprLine {
  materialName: string;
  quantity: number;
  unit?: string | null;
}

/** Pairs each wanted line with a distinct existing line of the same name. */
function pairByName<W extends { materialName: string }, T extends { materialName: string }>(wanted: W[], existing: T[]) {
  const used = new Set<T>();
  return wanted.map((w) => {
    const match = existing.find((e) => !used.has(e) && norm(e.materialName) === norm(w.materialName)) ?? null;
    if (match) used.add(match);
    return { wanted: w, match };
  });
}

/**
 * Push the MPR's current lines into every live quotation raised against it:
 * quantities are updated, new lines are added at price 0. A finalized quotation
 * that covers only part of the request (materials split between vendors) gets
 * quantity updates only; new materials then go to the quotations still waiting,
 * or to the finalized one when it is the only finalized quotation. Returns the
 * ids of the quotations that were touched.
 */
export async function syncQuotationsFromMpr(mprId: string, lines: MprLine[], gstRate: number): Promise<string[]> {
  const quotations = await prisma.quotation.findMany({
    where: { mprId, deletedAt: null, status: { notIn: [QuotationStatus.DELETED, QuotationStatus.REJECTED] } },
    include: { items: true },
  });
  const isFinalized = (status: string) => status === QuotationStatus.APPROVED || status === QuotationStatus.CONVERTED_TO_PO;
  const finalizedCount = quotations.filter((q) => isFinalized(q.status)).length;
  await prisma.$transaction(async (tx) => {
    for (const q of quotations) {
      const mayAddLines = !isFinalized(q.status) || finalizedCount === 1;
      for (const { wanted, match } of pairByName(lines, q.items)) {
        if (!match && !mayAddLines) continue;
        if (match) {
          await tx.quotationItem.update({
            where: { id: match.id },
            data: {
              quantity: wanted.quantity,
              unit: wanted.unit ?? match.unit,
              amount: wanted.quantity * Number(match.unitPrice),
            },
          });
        } else {
          await tx.quotationItem.create({
            data: {
              quotationId: q.id,
              materialName: wanted.materialName,
              quantity: wanted.quantity,
              unit: wanted.unit ?? null,
              unitPrice: 0,
              amount: 0,
              gstRate,
            },
          });
        }
      }
      const fresh = await tx.quotationItem.findMany({ where: { quotationId: q.id } });
      const totalAmount = fresh.reduce((s, i) => s + Number(i.amount), 0);
      const gstAmount = fresh.reduce((s, i) => s + (Number(i.amount) * Number(i.gstRate)) / 100, 0);
      await tx.quotation.update({
        where: { id: q.id },
        data: { totalAmount, gstAmount, grandTotal: totalAmount + gstAmount },
      });
    }
  });
  return quotations.map((q) => q.id);
}

/**
 * Re-sync the live PO of a quotation from the quotation's lines and send it
 * back for approval. Does nothing while any quotation line is still unpriced
 * (approvers must not see a PO with ₹0 lines). Returns the PO number when the
 * PO was re-submitted.
 */
export async function syncPoFromQuotation(
  quotationId: string,
  projectId: string,
  userId: string,
  reason: string,
): Promise<string | null> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, projectId, deletedAt: null },
    include: { items: true },
  });
  if (!quotation || quotation.items.length === 0 || hasUnpricedItems(quotation.items)) return null;

  const po = await prisma.purchaseOrder.findFirst({
    where: { quotationId, projectId, deletedAt: null, status: { in: REVISABLE_PO_STATUSES } },
    include: { items: true },
  });
  if (!po) return null;

  const totalAmount = quotation.items.reduce((s, i) => s + Number(i.amount), 0);
  const gstAmount = quotation.items.reduce((s, i) => s + (Number(i.amount) * Number(i.gstRate)) / 100, 0);
  const grandTotal = totalAmount + gstAmount;
  const delta = grandTotal - Number(po.grandTotal);
  const totalDeductions = Math.min(Number(po.totalDeductions), grandTotal);
  const advanceAmount = po.advanceAmount == null ? null : Math.min(Number(po.advanceAmount), grandTotal);

  // A pending PO that was never approved has committed nothing yet — its
  // approval will commit the full new total. Otherwise the commitment is
  // adjusted by the delta now and editedAt makes re-approval skip the add.
  const committed = po.status !== POStatus.PENDING_APPROVAL || po.editedAt != null;

  const adminRoles = await getActiveAdminRoles(projectId);
  const pairs = pairByName(quotation.items, po.items);
  const keptIds = new Set(pairs.filter((p) => p.match).map((p) => p.match!.id));

  await prisma.$transaction(async (tx) => {
    for (const { wanted: q, match } of pairs) {
      const data = {
        materialName: q.materialName,
        quantity: q.quantity,
        unit: q.unit,
        unitPrice: q.unitPrice,
        amount: q.amount,
        gstRate: q.gstRate,
      };
      if (match) await tx.pOItem.update({ where: { id: match.id }, data });
      else await tx.pOItem.create({ data: { ...data, poId: po.id } });
    }
    const dropIds = po.items.filter((i) => !keptIds.has(i.id)).map((i) => i.id);
    if (dropIds.length > 0) await tx.pOItem.deleteMany({ where: { id: { in: dropIds } } });

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        totalAmount,
        gstAmount,
        grandTotal,
        totalDeductions,
        netPayable: grandTotal - totalDeductions,
        advanceAmount,
        status: POStatus.PENDING_APPROVAL,
        editReason: reason,
        editedAt: committed ? new Date() : po.editedAt,
        editedBy: userId,
      },
    });

    if (committed && po.budgetHeadId && delta !== 0) {
      await tx.budgetHead.update({
        where: { id: po.budgetHeadId },
        data: { committedAmount: { increment: delta } },
      });
    }

    const stepRows = headThenAdminSteps(adminRoles);
    if (po.approvalWorkflowId) {
      await tx.approvalStep.deleteMany({ where: { workflowId: po.approvalWorkflowId } });
      await tx.approvalWorkflow.update({
        where: { id: po.approvalWorkflowId },
        data: { status: 'VERIFICATION', currentStep: 0, approvalPolicy: HEAD_THEN_ADMIN_POLICY, steps: { create: stepRows } },
      });
    } else {
      const workflow = await tx.approvalWorkflow.create({
        data: {
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          projectId,
          status: 'VERIFICATION',
          currentStep: 0,
          minApprovers: 1,
          approvalPolicy: HEAD_THEN_ADMIN_POLICY,
          steps: { create: stepRows },
        },
      });
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { approvalWorkflowId: workflow.id } });
    }
  });

  await logAudit({
    userId,
    action: AuditAction.UPDATE,
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    projectId,
    oldValue: { grandTotal: Number(po.grandTotal), itemCount: po.items.length },
    newValue: { grandTotal, itemCount: quotation.items.length, reason },
  });

  const workflowId =
    po.approvalWorkflowId ?? (await prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { approvalWorkflowId: true } }))?.approvalWorkflowId ?? '';
  notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
    approvalId: workflowId,
    entityType: 'PURCHASE_ORDER',
    entityId: po.id,
    title: 'PO Items Changed — Re-approval Required',
    body: `${po.poNumber} was updated from its material request and needs re-approval — ₹${grandTotal.toLocaleString('en-IN')}`,
    url: `/pos?id=${po.id}`,
  }).catch((err) => console.error('[Push] PO revision notification error:', err));

  return po.poNumber;
}
