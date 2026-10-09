import { prisma } from '../config/prisma';
import {
  AuditAction,
  QuotationStatus,
  ApprovalStatus,
  POStatus,
  VendorType,
  FIRST_LEVEL_APPROVER_ROLES,
  canFinalizeQuotation,
} from '@hospital-erp/shared';
import { generateProjectSequenceNumber } from './sequence.service';
import { notifyApprovers } from './push.service';
import { logAudit } from './audit.service';
import { createPoFromApprovedQuotation } from './po-from-quotation.service';

export interface QuotationLineItem {
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  gstRate?: number;
  amount?: number; // optional manual override; if absent, calculated as qty × unitPrice
}

export interface CreateQuotationInput {
  projectId: string;
  vendorId: string;
  items: QuotationLineItem[];
  createdBy: string;
  quotationNumber?: string;
  workTaskId?: string;
  mprId?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  fileMimeType?: string | null;
  notes?: string | null;
  /** Audit tag for system-made quotations (AUTO_FROM_MPR). */
  source?: string;
}

const quotationInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true, category: true, vendorType: true } },
  mpr: { select: { id: true, mprNumber: true, items: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
};

export { quotationInclude };

async function generateQuotationNumber(projectId: string): Promise<string> {
  return generateProjectSequenceNumber('quotation', 'quotationNumber', 'Q', 3, projectId);
}

export { generateQuotationNumber };

/** Statuses of a quotation that is still waiting to be finalized or not selected. */
export const OPEN_QUOTATION_STATUSES: string[] = [QuotationStatus.SUBMITTED, QuotationStatus.UNDER_REVIEW, 'PENDING'];
/** Statuses of a finalized quotation (the one bought from). */
export const FINALIZED_QUOTATION_STATUSES: string[] = [QuotationStatus.APPROVED, QuotationStatus.CONVERTED_TO_PO];

const normName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** A refused quotation action; `status` is the HTTP status to answer with. */
export class QuotationActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Core quotation creation logic — shared by the quotations endpoint, the
 * "generate quotation from work task" endpoint and the automatic quotation an
 * approved Material Purchase Request gets. Validates the vendor, auto-registers
 * any new vendor materials, computes totals, creates the quotation with its line
 * items and logs an audit entry.
 *
 * Quotations have no approval process: a new quotation waits (SUBMITTED) until
 * one of the finalizers picks it with `finalizeQuotation`, which approves it and
 * raises its PO. Several quotations (from different vendors) can wait side by side
 * for the same request.
 *
 * Returns the created quotation with the standard includes.
 */
export async function createQuotation(input: CreateQuotationInput) {
  const {
    projectId,
    vendorId,
    items,
    createdBy,
    quotationNumber: providedNumber,
    workTaskId,
    mprId = null,
    filePath = null,
    fileName = null,
    fileMimeType = null,
    notes = null,
    source,
  } = input;

  // Validate vendor exists and belongs to project
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, projectId, deletedAt: null },
    include: { materials: true },
  });
  if (!vendor) {
    throw new Error('Vendor not found');
  }

  // Auto-register any materials from the quotation that aren't yet in vendor's materials
  const vendorMaterialNames = vendor.materials.map((m) => m.name.toLowerCase());
  const newMaterials = items
    .filter((item) => !vendorMaterialNames.includes(item.materialName.toLowerCase()))
    .map((item) => ({ name: item.materialName, unit: item.unit || null }));
  if (newMaterials.length > 0) {
    await prisma.vendorMaterial.createMany({
      data: newMaterials.map((m) => ({
        vendorId: vendor.id,
        name: m.name,
        unit: m.unit,
      })),
    });
    console.log(
      `[Quotation] Auto-registered ${newMaterials.length} new material(s) for vendor "${vendor.name}"`
    );
  }

  // Calculate totals — GST is auto-derived from per-item gstRate
  const itemsWithAmounts = items.map((item) => {
    const calculatedAmount = item.quantity * item.unitPrice;
    // Use client-provided amount if present (allows manual override), else calculate
    const amount = item.amount !== undefined && Number(item.amount) > 0
      ? Number(item.amount)
      : calculatedAmount;
    const rate = Number(item.gstRate) || 0;
    return {
      materialName: item.materialName,
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
      amount,
      gstRate: rate,
    };
  });
  const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
  const gstAmount = itemsWithAmounts.reduce(
    (sum, i) => sum + Number(i.amount) * Number(i.gstRate) / 100,
    0
  );
  const grandTotal = totalAmount + gstAmount;

  const quotationNumber = providedNumber ?? (await generateQuotationNumber(projectId));

  const quotation = await prisma.quotation.create({
    data: {
      projectId,
      vendorId,
      mprId,
      quotationNumber,
      status: QuotationStatus.SUBMITTED,
      totalAmount,
      gstAmount,
      grandTotal,
      filePath,
      fileName,
      fileMimeType,
      notes,
      createdBy,
      items: { create: itemsWithAmounts },
    },
    include: quotationInclude,
  });

  // Mark the MPR as having a quotation on file, so the requester can see the
  // request is progressing (vendor-side MPRs go DRAFT → SUBMITTED → APPROVED
  // → QUOTATIONS_RECEIVED → CLOSED).
  if (mprId) {
    await prisma.materialPurchaseRequest.updateMany({
      where: { id: mprId, status: 'APPROVED' },
      data: { status: 'QUOTATIONS_RECEIVED' },
    }).catch((err) => console.error('[Quotation] Failed to sync MPR status:', err));
  }

  await logAudit({
    userId: createdBy,
    action: AuditAction.CREATE,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    newValue: {
      quotationNumber,
      vendorId,
      totalAmount,
      grandTotal,
      acknowledged: true,
      ...(mprId ? { mprId } : {}),
      ...(source ? { source } : {}),
    },
  });

  // The heads are told a quotation is waiting to be finalized. The automatic
  // quotation of a just-approved request needs no push: its approver is looking at it.
  if (source !== 'AUTO_FROM_MPR') {
    notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES], {
      approvalId: '',
      entityType: 'QUOTATION',
      entityId: quotation.id,
      title: 'Quotation Ready to Finalize',
      body: `Quotation ${quotationNumber} from ${quotation.vendor?.name ?? 'vendor'} — ₹${grandTotal}`,
      url: `/quotations?id=${quotation.id}`,
    }).catch((err) => console.error('[Push] Quotation notification error:', err));
  }

  // If raised from a work task, link the quotation back to it and advance
  // the work task from PLANNED to IN_PROGRESS.
  if (workTaskId) {
    await prisma.workTaskQuotation.create({
      data: { workTaskId, quotationId: quotation.id, createdBy },
    }).catch(() => {
      // The unique constraint may fire if already linked — safe to ignore.
    });
    const workTask = await prisma.workTask.findFirst({
      where: { id: workTaskId, projectId },
      select: { status: true },
    });
    const statusPatch = workTask?.status === 'PLANNED' ? { status: 'IN_PROGRESS' } : {};
    await prisma.workTask.update({
      where: { id: workTaskId },
      data: { linkedQuotationId: quotation.id, ...statusPatch },
    });
  }

  return quotation;
}

/**
 * The first quotation of a just-approved vendor request, made from the request's
 * own vendor, items and estimated rates, so nobody has to raise it by hand. More
 * quotations (other vendors) can be added next to it. Does nothing for non-vendor
 * requests, site bills, or a request that already has a quotation.
 */
export async function createQuotationFromMpr(mprId: string, projectId: string, userId: string) {
  const mpr = await prisma.materialPurchaseRequest.findFirst({
    where: { id: mprId, projectId, deletedAt: null },
    include: { items: true, vendor: { select: { vendorType: true } } },
  });
  if (!mpr || !mpr.vendorId || mpr.isSiteBill || mpr.items.length === 0) return null;
  if (mpr.vendor?.vendorType === VendorType.NON_VENDOR) return null;
  const existing = await prisma.quotation.count({
    where: { mprId, deletedAt: null, status: { not: QuotationStatus.DELETED } },
  });
  if (existing > 0) return null;

  return createQuotation({
    projectId,
    vendorId: mpr.vendorId,
    mprId,
    createdBy: userId,
    notes: mpr.description ?? null,
    source: 'AUTO_FROM_MPR',
    items: mpr.items.map((item) => ({
      materialName: item.materialName,
      quantity: Number(item.quantity),
      unit: item.unit ?? undefined,
      unitPrice: Number(item.estimatedRate ?? 0),
      gstRate: Number(mpr.estimatedGstRate ?? 0),
    })),
  });
}

interface ActingUser {
  id: string;
  role: string;
  extraPermissions?: readonly string[] | null;
}

/**
 * When every material of the request is covered by a finalized quotation, the
 * quotations still waiting are closed as "not selected". Returns their numbers.
 */
export async function closeUnselectedQuotations(mprId: string, projectId: string, userId: string): Promise<string[]> {
  const [mprItems, quotations] = await Promise.all([
    prisma.materialPurchaseRequestItem.findMany({ where: { mprId }, select: { materialName: true } }),
    prisma.quotation.findMany({
      where: { mprId, projectId, deletedAt: null },
      include: { items: { select: { materialName: true } }, approvalWorkflow: { select: { id: true, status: true } } },
    }),
  ]);
  const covered = new Set(
    quotations
      .filter((q) => FINALIZED_QUOTATION_STATUSES.includes(q.status))
      .flatMap((q) => q.items.map((i) => normName(i.materialName))),
  );
  if (mprItems.length === 0 || !mprItems.every((i) => covered.has(normName(i.materialName)))) return [];

  const open = quotations.filter((q) => OPEN_QUOTATION_STATUSES.includes(q.status));
  for (const q of open) {
    await prisma.quotation.update({ where: { id: q.id }, data: { status: QuotationStatus.REJECTED } });
    if (q.approvalWorkflow && q.approvalWorkflow.status !== ApprovalStatus.APPROVED && q.approvalWorkflow.status !== ApprovalStatus.REJECTED) {
      await prisma.approvalWorkflow.update({ where: { id: q.approvalWorkflow.id }, data: { status: ApprovalStatus.REJECTED } });
    }
    await logAudit({
      userId,
      action: AuditAction.REJECT,
      entityType: 'QUOTATION',
      entityId: q.id,
      projectId,
      newValue: { status: QuotationStatus.REJECTED, reason: 'NOT_SELECTED', note: 'Every material of the request was finalized from other quotations' },
    });
  }
  return open.map((q) => q.quotationNumber);
}

/**
 * Finalize (pick) a quotation: it becomes APPROVED, its PO is raised at once and
 * waits for approval. Only the Project Head, Head of Construction, Admin 1,
 * Admin 2 or a super admin may do it. For one request a material can be
 * finalized only once, but different materials may come from different vendors
 * (cement from A and steel from B gives two POs).
 */
export async function finalizeQuotation(quotationId: string, projectId: string, user: ActingUser, comments?: string) {
  if (!canFinalizeQuotation(user.role, user.extraPermissions)) {
    throw new QuotationActionError('Only the Project Head, Head of Construction, Admin 1, Admin 2 or a super admin can finalize quotations', 403);
  }
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, projectId, deletedAt: null },
    include: { items: true, approvalWorkflow: { select: { id: true, status: true } } },
  });
  if (!quotation) throw new QuotationActionError('Quotation not found', 404);

  const alreadyFinalized = FINALIZED_QUOTATION_STATUSES.includes(quotation.status);
  if (!alreadyFinalized && !OPEN_QUOTATION_STATUSES.includes(quotation.status)) {
    throw new QuotationActionError(`Cannot finalize a quotation that is ${quotation.status.replace(/_/g, ' ').toLowerCase()}`);
  }
  if (quotation.items.length === 0 || Number(quotation.grandTotal) <= 0) {
    throw new QuotationActionError('Enter the rates on this quotation before finalizing it');
  }

  if (alreadyFinalized) {
    // An older approved quotation that never got its PO: raise it now.
    const po = await createPoFromApprovedQuotation(quotation.id, user.id);
    if (!po) throw new QuotationActionError('This quotation is already finalized');
    return { quotationId: quotation.id, po, notSelected: [] as string[] };
  }

  if (quotation.mprId) {
    const finalizedSiblings = await prisma.quotation.findMany({
      where: { mprId: quotation.mprId, deletedAt: null, id: { not: quotation.id }, status: { in: FINALIZED_QUOTATION_STATUSES } },
      select: { quotationNumber: true, items: { select: { materialName: true } } },
    });
    const takenBy = new Map<string, string>();
    for (const q of finalizedSiblings) for (const i of q.items) takenBy.set(normName(i.materialName), q.quotationNumber);
    const clash = quotation.items.find((i) => takenBy.has(normName(i.materialName)));
    if (clash) {
      throw new QuotationActionError(
        `"${clash.materialName}" is already finalized in ${takenBy.get(normName(clash.materialName))}. A material can be finalized only once per request.`,
      );
    }
  }

  // Claim it atomically, so a double click or two finalizers cannot raise two POs.
  const claimed = await prisma.quotation.updateMany({
    where: { id: quotation.id, status: quotation.status },
    data: { status: QuotationStatus.APPROVED, finalizedAt: new Date(), finalizedBy: user.id },
  });
  if (claimed.count === 0) throw new QuotationActionError('This quotation was just changed by someone else. Refresh and try again.', 409);

  // An older quotation may still carry an open approval workflow: close it so it leaves the queues.
  if (quotation.approvalWorkflow && quotation.approvalWorkflow.status !== ApprovalStatus.APPROVED) {
    await prisma.approvalWorkflow.update({ where: { id: quotation.approvalWorkflow.id }, data: { status: ApprovalStatus.APPROVED } });
  }

  await logAudit({
    userId: user.id,
    action: AuditAction.APPROVE,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    newValue: { status: QuotationStatus.APPROVED, finalized: true, ...(comments ? { comments } : {}) },
  });

  const po = await createPoFromApprovedQuotation(quotation.id, user.id);
  const notSelected = quotation.mprId ? await closeUnselectedQuotations(quotation.mprId, projectId, user.id) : [];
  return { quotationId: quotation.id, po, notSelected };
}

/** Close a waiting quotation as "not selected" (the finalizers' counterpart of finalize). */
export async function rejectQuotation(quotationId: string, projectId: string, user: ActingUser, reason: string) {
  if (!canFinalizeQuotation(user.role, user.extraPermissions)) {
    throw new QuotationActionError('Only the Project Head, Head of Construction, Admin 1, Admin 2 or a super admin can reject quotations', 403);
  }
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, projectId, deletedAt: null },
    include: { approvalWorkflow: { select: { id: true, status: true } } },
  });
  if (!quotation) throw new QuotationActionError('Quotation not found', 404);
  if (!OPEN_QUOTATION_STATUSES.includes(quotation.status)) {
    throw new QuotationActionError(`Cannot reject a quotation that is already ${quotation.status.replace(/_/g, ' ').toLowerCase()}`);
  }
  const claimed = await prisma.quotation.updateMany({
    where: { id: quotation.id, status: quotation.status },
    data: { status: QuotationStatus.REJECTED },
  });
  if (claimed.count === 0) throw new QuotationActionError('This quotation was just changed by someone else. Refresh and try again.', 409);
  if (quotation.approvalWorkflow && quotation.approvalWorkflow.status !== ApprovalStatus.REJECTED && quotation.approvalWorkflow.status !== ApprovalStatus.APPROVED) {
    await prisma.approvalWorkflow.update({ where: { id: quotation.approvalWorkflow.id }, data: { status: ApprovalStatus.REJECTED } });
  }
  await logAudit({
    userId: user.id,
    action: AuditAction.REJECT,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    newValue: { status: QuotationStatus.REJECTED, reason },
  });
  return { quotationId: quotation.id };
}

const DEAD_PO_STATUSES: string[] = [POStatus.DELETED, POStatus.REJECTED, POStatus.CANCELLED];
const COMMITTED_PO_STATUSES: string[] = [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED];

/**
 * Cancel a finalized quotation together with the PO raised from it. Refused when that PO
 * is already approved or has goods receipts, invoices or payments: those need their own
 * reversal first. A pending PO is closed (DELETED) and any budget it holds is released.
 */
export async function cancelQuotation(quotationId: string, projectId: string, user: ActingUser, reason: string) {
  if (!canFinalizeQuotation(user.role, user.extraPermissions)) {
    throw new QuotationActionError('Only the Project Head, Head of Construction, Admin 1, Admin 2 or a super admin can cancel quotations', 403);
  }
  const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, projectId, deletedAt: null } });
  if (!quotation) throw new QuotationActionError('Quotation not found', 404);
  if (!FINALIZED_QUOTATION_STATUSES.includes(quotation.status)) {
    throw new QuotationActionError(
      `Only a finalized quotation can be cancelled. This one is ${quotation.status.replace(/_/g, ' ').toLowerCase()}; use "Not selected" for quotations still waiting.`
    );
  }

  const pos = await prisma.purchaseOrder.findMany({
    where: { quotationId: quotation.id, projectId, deletedAt: null, isContract: false, status: { notIn: DEAD_PO_STATUSES } },
    select: { id: true, poNumber: true, status: true, budgetHeadId: true, grandTotal: true, editedAt: true, approvalWorkflowId: true },
  });
  const committed = pos.filter((p) => COMMITTED_PO_STATUSES.includes(p.status));
  if (committed.length > 0) {
    throw new QuotationActionError(
      `${committed.map((p) => p.poNumber).join(', ')} already approved. Deactivate it on the Purchase Orders page first, then cancel the quotation.`
    );
  }

  const poIds = pos.map((p) => p.id);
  if (poIds.length > 0) {
    const where = { projectId, deletedAt: null, poId: { in: poIds } };
    const [receipts, invoices, payments] = await Promise.all([
      prisma.goodsReceipt.count({ where }),
      prisma.vendorInvoice.count({ where }),
      prisma.paymentRequest.count({ where }),
    ]);
    if (receipts + invoices + payments > 0) {
      throw new QuotationActionError('The PO for this quotation already has goods receipts, invoices or payments, so it cannot be cancelled here.');
    }
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quotation.updateMany({
      where: { id: quotation.id, status: quotation.status },
      data: { status: QuotationStatus.CANCELLED },
    });
    if (claimed.count === 0) {
      throw new QuotationActionError('This quotation was just changed by someone else. Refresh and try again.', 409);
    }
    for (const po of pos) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: POStatus.DELETED } });
      // An approved PO that was edited keeps its commitment while it waits for re-approval.
      if (po.budgetHeadId && po.editedAt) {
        const head = await tx.budgetHead.findUnique({ where: { id: po.budgetHeadId }, select: { committedAmount: true } });
        const release = Math.min(Number(po.grandTotal), Number(head?.committedAmount ?? 0));
        if (release > 0) {
          await tx.budgetHead.update({ where: { id: po.budgetHeadId }, data: { committedAmount: { decrement: release } } });
        }
      }
      if (po.approvalWorkflowId) {
        await tx.approvalWorkflow.updateMany({
          where: { id: po.approvalWorkflowId, status: { notIn: [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED] } },
          data: { status: ApprovalStatus.REJECTED },
        });
      }
    }
  });

  await logAudit({
    userId: user.id,
    action: AuditAction.DELETE,
    entityType: 'QUOTATION',
    entityId: quotation.id,
    projectId,
    newValue: { status: QuotationStatus.CANCELLED, previousStatus: quotation.status, reason, purchaseOrders: pos.map((p) => p.poNumber) },
  });
  return { quotationId: quotation.id, cancelledPoIds: poIds };
}
