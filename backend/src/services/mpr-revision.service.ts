import { Prisma } from '@prisma/client';
import { POStatus, QuotationStatus, AuditAction, UserRole, FIRST_LEVEL_APPROVER_ROLES, catalogNameKey, lineKey, billableQuantity, canFinalizeQuotation, isAdminRole } from '@hospital-erp/shared';
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

const isUnpriced = (i: { unitPrice: Prisma.Decimal | number }) => Number(i.unitPrice) <= 0;

/** PO states in which items can still be revised (nothing delivered yet). */
export const REVISABLE_PO_STATUSES: string[] = [POStatus.APPROVED, POStatus.PENDING_APPROVAL];

export const hasUnpricedItems = (items: Array<{ unitPrice: Prisma.Decimal | number }>) => items.some(isUnpriced);

interface MprLine {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  quantity: number;
  unit?: string | null;
}

type Line = { materialName: string; specification?: string | null };

/**
 * Pairs each wanted line with a distinct existing line of the same item + spec (Steel 8mm
 * and Steel 12mm are different lines). Lines saved before specs travelled have none; those
 * still pair by name.
 */
function pairByName<W extends Line, T extends Line>(wanted: W[], existing: T[]) {
  const used = new Set<T>();
  const pairs = wanted.map((w) => {
    const match = existing.find((e) => !used.has(e) && lineKey(e) === lineKey(w)) ?? null;
    if (match) used.add(match);
    return { wanted: w, match };
  });
  for (const p of pairs) {
    if (p.match) continue;
    p.match = existing.find((e) => !used.has(e) && !e.specification && catalogNameKey(e.materialName) === catalogNameKey(p.wanted.materialName)) ?? null;
    if (p.match) used.add(p.match);
  }
  return pairs;
}

/**
 * Push the MPR's current lines into every live quotation raised against it:
 * quantities are updated, new lines are added at price 0. A finalized quotation
 * that covers only part of the request (materials split between vendors) gets
 * quantity updates only; new materials then go to the quotations still waiting,
 * or to the finalized one when it is the only finalized quotation. Returns the
 * ids of the quotations that were touched.
 */
export async function syncQuotationsFromMpr(
  mprId: string,
  lines: MprLine[],
  gstRate: number,
  /** Lines (by item + spec) whose rate was changed on the request: their new rate goes into the quotations too. */
  rateChanges?: Map<string, number>,
  /** A quotation that is itself the source of the edit. */
  skipQuotationId?: string,
): Promise<string[]> {
  const quotations = await prisma.quotation.findMany({
    where: {
      mprId,
      deletedAt: null,
      status: { notIn: [QuotationStatus.DELETED, QuotationStatus.REJECTED] },
      ...(skipQuotationId ? { id: { not: skipQuotationId } } : {}),
    },
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
          const newRate = rateChanges?.get(lineKey(wanted));
          const rate = newRate !== undefined && newRate > 0 ? newRate : Number(match.unitPrice);
          await tx.quotationItem.update({
            where: { id: match.id },
            data: {
              quantity: wanted.quantity,
              unit: wanted.unit ?? match.unit,
              unitPrice: rate,
              amount: wanted.quantity * rate,
              ...(wanted.itemId ? { itemId: wanted.itemId, specification: wanted.specification ?? null } : {}),
            },
          });
        } else {
          await tx.quotationItem.create({
            data: {
              quotationId: q.id,
              materialName: wanted.materialName,
              itemId: wanted.itemId ?? null,
              specification: wanted.specification ?? null,
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
  /**
   * true (default): the PO goes back for approval at whatever stage it is in.
   * false: an admin / head edited it, so it keeps its status and approvals.
   */
  reapprove = true,
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
        itemId: q.itemId,
        specification: q.specification,
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
        ...(reapprove ? { status: POStatus.PENDING_APPROVAL } : {}),
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

    if (!reapprove) return;
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

  if (!reapprove) return po.poNumber;

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

/** Roles whose edits stand without a new approval round: Admin 1/2/…, Project Head, Head of Construction, super admins. */
export function editsStandWithoutReapproval(user: { role: string; extraPermissions?: readonly string[] | null }): boolean {
  return canFinalizeQuotation(user.role, user.extraPermissions) || isAdminRole(user.role);
}

interface ChainLine {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  quantity: number | Prisma.Decimal;
  unit?: string | null;
  unitPrice: number | Prisma.Decimal;
}

/**
 * Push edited quotation / PO lines into the request: quantity, unit and rate of
 * the matching lines are updated, lines the request does not have yet are added.
 * Request lines are never removed from here (a vendor may cover only some of them).
 */
async function pushLinesToMpr(mprId: string, lines: ChainLine[]): Promise<void> {
  const mpr = await prisma.materialPurchaseRequest.findUnique({ where: { id: mprId }, include: { items: true } });
  if (!mpr) return;
  await prisma.$transaction(async (tx) => {
    for (const { wanted, match } of pairByName(lines, mpr.items)) {
      const qty = Number(wanted.quantity);
      const rate = Number(wanted.unitPrice) > 0 ? Number(wanted.unitPrice) : null;
      if (match) {
        const useRate = rate ?? Number(match.estimatedRate);
        await tx.materialPurchaseRequestItem.update({
          where: { id: match.id },
          data: { quantity: qty, unit: wanted.unit ?? match.unit, estimatedRate: useRate, estimatedAmount: billableQuantity(qty, wanted.unit ?? match.unit) * useRate },
        });
      } else {
        await tx.materialPurchaseRequestItem.create({
          data: {
            mprId,
            materialName: wanted.materialName,
            itemId: wanted.itemId ?? null,
            specification: wanted.specification ?? null,
            quantity: qty,
            unit: wanted.unit ?? null,
            estimatedRate: rate ?? 0,
            estimatedAmount: billableQuantity(qty, wanted.unit) * (rate ?? 0),
          },
        });
      }
    }
    const fresh = await tx.materialPurchaseRequestItem.findMany({ where: { mprId } });
    const subtotal = fresh.reduce((sum, i) => sum + Number(i.estimatedAmount), 0);
    const gst = (subtotal * Number(mpr.estimatedGstRate)) / 100;
    await tx.materialPurchaseRequest.update({
      where: { id: mprId },
      data: { estimatedSubtotal: subtotal, estimatedGstAmount: gst, estimatedTotal: subtotal + gst },
    });
  });
}

/** After a quotation's lines changed: request, the other quotations and every PO follow. Returns the PO numbers sent for approval. */
export async function propagateFromQuotation(
  quotationId: string,
  projectId: string,
  userId: string,
  reapprove: boolean,
  reason: string,
  /** The PO already holds the new lines (the edit came from it): do not sync it again. */
  skipSourcePo = false,
): Promise<string[]> {
  const q = await prisma.quotation.findFirst({ where: { id: quotationId, projectId, deletedAt: null }, include: { items: true } });
  if (!q) return [];
  const touchedQuotations = new Set<string>(skipSourcePo ? [] : [q.id]);
  if (q.mprId) {
    await pushLinesToMpr(q.mprId, q.items);
    const mpr = await prisma.materialPurchaseRequest.findUnique({ where: { id: q.mprId }, include: { items: true } });
    if (mpr) {
      const others = await syncQuotationsFromMpr(
        mpr.id,
        mpr.items.map((i) => ({ materialName: i.materialName, itemId: i.itemId, specification: i.specification, quantity: Number(i.quantity), unit: i.unit })),
        Number(mpr.estimatedGstRate),
        undefined,
        q.id,
      );
      others.forEach((id) => touchedQuotations.add(id));
    }
  }
  const poNumbers: string[] = [];
  for (const id of touchedQuotations) {
    const n = await syncPoFromQuotation(id, projectId, userId, reason, reapprove);
    if (n) poNumbers.push(n);
  }
  return poNumbers;
}

/** After a PO's lines changed: its quotation mirrors it, then the request and the others follow. */
export async function propagateFromPo(
  poId: string,
  projectId: string,
  userId: string,
  reapprove: boolean,
  reason: string,
): Promise<string[]> {
  const po = await prisma.purchaseOrder.findFirst({ where: { id: poId, projectId, deletedAt: null }, include: { items: true, quotation: { include: { items: true } } } });
  if (!po) return [];
  const quotation = po.quotation;
  if (quotation) {
    await prisma.$transaction(async (tx) => {
      const pairs = pairByName(po.items, quotation.items);
      const keep = new Set(pairs.filter((p) => p.match).map((p) => p.match!.id));
      for (const { wanted: i, match } of pairs) {
        const data = {
          materialName: i.materialName, itemId: i.itemId, specification: i.specification, quantity: i.quantity,
          unit: i.unit, unitPrice: i.unitPrice, amount: i.amount, gstRate: i.gstRate,
        };
        if (match) await tx.quotationItem.update({ where: { id: match.id }, data });
        else await tx.quotationItem.create({ data: { ...data, quotationId: quotation.id } });
      }
      const drop = quotation.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
      if (drop.length) await tx.quotationItem.deleteMany({ where: { id: { in: drop } } });
      const total = po.items.reduce((sum, i) => sum + Number(i.amount), 0);
      const gst = po.items.reduce((sum, i) => sum + (Number(i.amount) * Number(i.gstRate)) / 100, 0);
      await tx.quotation.update({ where: { id: quotation.id }, data: { totalAmount: total, gstAmount: gst, grandTotal: total + gst } });
    });
  }
  const mprId = po.mprId ?? quotation?.mprId ?? null;
  const numbers: string[] = [];
  if (quotation) {
    numbers.push(...(await propagateFromQuotation(quotation.id, projectId, userId, reapprove, reason, true)));
  } else if (mprId) {
    await pushLinesToMpr(mprId, po.items);
  }
  return numbers;
}
