import { Router, Response, NextFunction } from 'express';
import { Permission, POStatus, POPaymentType, AuditAction, UserRole, GoodsReceiptStatus } from '@hospital-erp/shared';
import { createPOSchema, listPOsSchema, approvalActionSchema, editPOSchema, editUnapprovedPOSchema, regeneratePOSchema, changePOPaymentTypeSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateSequenceNumber } from '../services/sequence.service';
import * as approvalService from '../services/approval.service';
import { notifyApprovers } from '../services/push.service';
import { streamPurchaseOrderPdf } from '../services/purchase-order-pdf.service';

const router = Router();
router.use(authMiddleware);

// ─── Helper: compute accepted quantities from posted Goods Receipts ───
// Keyed by poItemId for correct per-line tracking (a PO may have the same
// material on multiple lines at different rates). A material-name fallback map
// is also returned for legacy GR items that have no poItemId.
async function getAcceptedQuantitiesByPo(poId: string): Promise<{
  byPoItemId: Map<string, number>;
  byName: Map<string, number>;
}> {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { poId, deletedAt: null, status: GoodsReceiptStatus.POSTED },
    select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
  });
  const byPoItemId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const receipt of receipts) {
    for (const item of receipt.items) {
      const qty = Number(item.acceptedQty);
      if (item.poItemId) {
        byPoItemId.set(item.poItemId, (byPoItemId.get(item.poItemId) ?? 0) + qty);
      }
      const name = item.materialName.toLowerCase();
      byName.set(name, (byName.get(name) ?? 0) + qty);
    }
  }
  return { byPoItemId, byName };
}

// Lookup accepted qty for a PO item, preferring poItemId, falling back to name.
function acceptedForPoItem(
  acc: { byPoItemId: Map<string, number>; byName: Map<string, number> },
  item: { id?: string; materialName: string },
): number {
  if (item.id && acc.byPoItemId.has(item.id)) {
    return acc.byPoItemId.get(item.id)!;
  }
  return acc.byName.get(item.materialName.toLowerCase()) ?? 0;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN, UserRole.ADMIN_2];
const PO_APPROVER_ROLES = [UserRole.ADMIN, UserRole.ADMIN_2];

async function generatePONumber(projectId: string): Promise<string> {
  return generateSequenceNumber('purchaseOrder', 'poNumber', 'VGH-PO', 3, { projectId });
}

/**
 * Generate a regenerated PO number: VGH-REGPO{originalNum}/{regenSeq}
 * e.g. original VGH-PO004 → first regen VGH-REGPO004/1, second VGH-REGPO004/2
 */
async function generateRegeneratedPONumber(parentPo: { poNumber: string; id: string }): Promise<string> {
  const originalMatch = parentPo.poNumber.match(/^VGH-(?:REGPO(\d+)\/\d+|PO(\d+))$/);
  const originalNum = originalMatch ? (originalMatch[1] ?? originalMatch[2]) : '001';
  const childCount = await prisma.purchaseOrder.count({
    where: { parentPoId: parentPo.id },
  });
  return `VGH-REGPO${originalNum}/${childCount + 1}`;
}

/**
 * Recalculate PO status based on accepted quantities vs ordered quantities.
 * Returns DELIVERED if all items are fully received, else PARTIALLY_DELIVERED.
 */
async function recalculatePoStatus(poId: string): Promise<string> {
  const acc = await getAcceptedQuantitiesByPo(poId);
  const poItems = await prisma.pOItem.findMany({
    where: { poId },
    select: { id: true, materialName: true, quantity: true },
  });
  const fullyReceived = poItems.every(
    (item) => acceptedForPoItem(acc, item) >= Number(item.quantity),
  );
  return fullyReceived ? POStatus.DELIVERED : POStatus.PARTIALLY_DELIVERED;
}

const poInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true, phone: true, address: true, contactPersonName: true, contactPersonPhone: true } },
  quotation: { select: { id: true, quotationNumber: true, date: true, createdAt: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  editedByUser: { select: { id: true, name: true } },
  parentPo: { select: { id: true, poNumber: true } },
  childPos: { select: { id: true, poNumber: true, regenerationNumber: true, status: true } },
  budgetHead: { select: { id: true, particulars: true } },
  advancePaymentRequests: {
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      amount: true,
      requestNumber: true,
      type: true,
      payments: {
        where: { status: 'PAID' },
        select: { id: true, amount: true, date: true, mode: true },
      },
    },
  },
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
};

// GET / — list POs
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listPOsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, vendorId, status, search, minAmount, maxAmount, dateFilter } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { poNumber: { contains: String(search), mode: 'insensitive' } },
          { vendor: { name: { contains: String(search), mode: 'insensitive' } } },
        ];
      }

      // Amount range filter
      if (minAmount || maxAmount) {
        const range: Record<string, number> = {};
        if (minAmount) range.gte = Number(minAmount);
        if (maxAmount) range.lte = Number(maxAmount);
        where.grandTotal = range;
      }

      // Date range filter
      if (dateFilter) {
        const now = new Date();
        let start: Date | null = null;
        let end: Date | null = null;
        switch (String(dateFilter)) {
          case 'today':
            start = new Date(now); start.setHours(0, 0, 0, 0);
            end = new Date(now); end.setHours(23, 59, 59, 999);
            break;
          case 'this_week':
            start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0);
            end = new Date(now); end.setHours(23, 59, 59, 999);
            break;
          case 'this_month':
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            break;
          case 'last_month':
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            break;
        }
        if (start && end) where.createdAt = { gte: start, lte: end };
      }

      const [data, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where,
          include: poInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.purchaseOrder.count({ where }),
      ]);

      // Calculate paidToDate and amountToPayNow for each PO
      const dataWithPayments = data.map((po) => {
        const paidToDate = (po.advancePaymentRequests ?? []).reduce(
          (sum, pr) => sum + (pr.payments ?? []).reduce((s, p) => s + Number(p.amount), 0),
          0,
        );
        // Net Payable follows the same priority as the PDF:
        //   1. NET PAYABLE (when deductions exist) — po.netPayable = grandTotal - totalDeductions
        //   2. ADVANCE NOW PAY (when advance amount > 0) — po.advanceAmount
        //   3. GRAND TOTAL (fallback) — po.grandTotal
        const effectiveNetPayable =
          po.totalDeductions !== null && Number(po.totalDeductions) > 0
            ? Number(po.netPayable ?? po.grandTotal)
            : po.advanceAmount !== null && Number(po.advanceAmount) > 0
              ? Number(po.advanceAmount)
              : Number(po.grandTotal);
        const amountToPayNow = Math.max(0, effectiveNetPayable - paidToDate);
        return {
          ...po,
          paidToDate,
          amountToPayNow,
        };
      });

      res.json({
        data: dataWithPayments,
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — get single PO
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: poInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/delivery-trail — full delivery history for a PO
router.get(
  '/:id/delivery-trail',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: {
          id: true,
          poNumber: true,
          status: true,
          items: true,
          assets: {
            orderBy: { assetId: 'asc' },
            select: {
              id: true,
              assetId: true,
              status: true,
              location: true,
              serialNumber: true,
              totalCost: true,
              receiptNumber: true,
              inventoryItem: { select: { id: true, name: true } },
            },
          },
          gatePasses: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              passNumber: true,
              status: true,
              createdAt: true,
              otpApprovedAt: true,
              items: { select: { materialName: true, quantity: true, unit: true } },
              goodsReceipts: {
                select: {
                  id: true,
                  receiptNumber: true,
                  status: true,
                  inspectedAt: true,
                  postedAt: true,
                  items: {
                    select: {
                      materialName: true,
                      deliveredQty: true,
                      acceptedQty: true,
                      rejectedQty: true,
                      rejectionReason: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      // Build per-item summary using accepted quantities from posted receipts
      const acceptedMap = await getAcceptedQuantitiesByPo(po.id);
      const itemSummary = po.items.map((item) => {
        const ordered = Number(item.quantity);
        const accepted = acceptedForPoItem(acceptedMap, item);
        return {
          materialName: item.materialName,
          unit: item.unit,
          orderedQuantity: ordered,
          acceptedQuantity: accepted,
          remainingQuantity: Math.max(0, ordered - accepted),
        };
      });

      // Build delivery instances from gate passes
      const deliveries = po.gatePasses.map((gp) => ({
        gatePassId: gp.id,
        passNumber: gp.passNumber,
        gatePassStatus: gp.status,
        gatePassDate: gp.createdAt,
        approvedDate: gp.otpApprovedAt,
        items: gp.items.map((gpi) => ({
          materialName: gpi.materialName,
          deliveredQty: Number(gpi.quantity),
          unit: gpi.unit,
        })),
        goodsReceipts: gp.goodsReceipts.map((gr) => ({
          receiptNumber: gr.receiptNumber,
          receiptStatus: gr.status,
          inspectedAt: gr.inspectedAt,
          postedAt: gr.postedAt,
          items: gr.items.map((gri) => ({
            materialName: gri.materialName,
            deliveredQty: Number(gri.deliveredQty),
            acceptedQty: Number(gri.acceptedQty),
            rejectedQty: Number(gri.rejectedQty),
            rejectionReason: gri.rejectionReason,
          })),
        })),
      }));

      res.json({
        poNumber: po.poNumber,
        poStatus: po.status,
        itemSummary,
        deliveries,
        assets: po.assets.map((a) => ({
          id: a.id,
          assetId: a.assetId,
          status: a.status,
          location: a.location,
          serialNumber: a.serialNumber,
          totalCost: a.totalCost ? Number(a.totalCost) : null,
          receiptNumber: a.receiptNumber,
          itemName: a.inventoryItem.name,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(createPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { vendorId, quotationId, paymentType, paymentTerms, deliveryDate, budgetHeadId, advanceAmount, deductions, notes } = req.body;

      // Validate quotation exists, belongs to project, is approved, and matches vendor
      const quotation = await prisma.quotation.findFirst({
        where: { id: quotationId, projectId, deletedAt: null },
        include: { items: true, vendor: true },
      });
      if (!quotation) {
        res.status(400).json({ error: 'Quotation not found' });
        return;
      }
      if (quotation.status !== 'APPROVED') {
        res.status(400).json({ error: 'Only approved quotations can be converted to Purchase Orders' });
        return;
      }
      if (quotation.vendorId !== vendorId) {
        res.status(400).json({ error: 'Vendor does not match the quotation vendor' });
        return;
      }

      const poNumber = await generatePONumber(projectId);
      const totalAmount = Number(quotation.totalAmount);
      // Auto-calculate GST from per-item gstRate (copied from quotation items)
      const gst = quotation.items.reduce((sum, item) => sum + Number(item.amount) * Number(item.gstRate) / 100, 0);
      const grandTotal = totalAmount + gst;

      // ── Compute deductions (TDS, retention, advance adjustment, etc.) ──
      const deductionRows: { amount: number; reason: string }[] = Array.isArray(deductions) ? deductions : [];
      const totalDeductions = deductionRows.reduce((sum, d) => sum + Number(d.amount), 0);
      if (totalDeductions > grandTotal) {
        res.status(400).json({ error: `Total deductions (${totalDeductions}) cannot exceed PO grand total (${grandTotal})` });
        return;
      }
      const netPayable = grandTotal - totalDeductions;

      // Resolve the agreed advance amount based on payment type.
      // ADVANCE / FULL_PAYMENT require an advance amount (≤ grandTotal); AFTER_DELIVERY must have none.
      let resolvedAdvanceAmount: number | null;
      if (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) {
        const amt = Number(advanceAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          res.status(400).json({ error: 'Advance amount is required for advance / full payment POs' });
          return;
        }
        if (amt > grandTotal) {
          res.status(400).json({ error: `Advance amount cannot exceed PO grand total of ${grandTotal}` });
          return;
        }
        resolvedAdvanceAmount = amt;
      } else {
        resolvedAdvanceAmount = null;
      }

      // Create PO + approval workflow atomically so a rollback can't leave an
      // orphan workflow or a PO without its workflow linkage.
      const { po, workflow } = await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            projectId,
            vendorId,
            quotationId,
            poNumber,
            status: POStatus.PENDING_APPROVAL,
            paymentType,
            advanceAmount: resolvedAdvanceAmount,
            paymentTerms: paymentTerms ?? null,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            notes: notes ?? null,
            totalAmount,
            gstAmount: gst,
            grandTotal,
            deductions: deductionRows.length > 0 ? deductionRows : Prisma.JsonNull,
            totalDeductions,
            netPayable,
            budgetHeadId: budgetHeadId ?? null,
            createdBy: req.user!.id,
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
          include: poInclude,
        });

        // Initiate approval workflow — one approval from any Admin (ADMIN or ADMIN_2).
        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PURCHASE_ORDER',
            entityId: po.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: 1,
            approvalPolicy: 'PO_SINGLE_APPROVER',
            steps: {
              create: [UserRole.ADMIN, UserRole.ADMIN_2].map((role, idx) => ({
                stepNumber: idx + 1,
                approverRole: role,
                status: 'PENDING',
              })),
            },
          },
          include: { steps: true },
        });

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { approvalWorkflowId: workflow.id },
        });

        return { po, workflow };
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: { poNumber, vendorId, quotationId, totalAmount, grandTotal, paymentType, advanceAmount: resolvedAdvanceAmount, acknowledged: true },
      });

      // Notify all approvers via push notification
      notifyApprovers(projectId, HEAD_ROLES, {
        approvalId: workflow.id,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'New Approval Required',
        body: `Purchase Order ${poNumber} — ₹${grandTotal}`,
        url: `/pos?approval=${workflow.id}`,
      }).catch((err) => console.error('[Push] PO notification error:', err));

      const result = await prisma.purchaseOrder.findUnique({
        where: { id: po.id },
        include: poInclude,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id — update PO notes (allowed for any status, including APPROVED/DELIVERED)
router.patch(
  '/:id',
  rbacMiddleware(Permission.CREATE_PO),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      // DELETED POs are frozen — no edits allowed
      if (existing.status === POStatus.DELETED) {
        res.status(400).json({ error: 'Cannot edit a deleted purchase order' });
        return;
      }

      // Only notes/description can be edited — allowed for ALL other statuses
      if (req.body.notes === undefined) {
        res.status(400).json({ error: 'Only description/notes can be updated' });
        return;
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: { notes: req.body.notes || null },
        include: poInclude,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — mark as DELETED (stays visible in list, excluded from counts/ledger)
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_PO),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      const isAdmin = req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.ADMIN_2;
      const isCreator = existing.createdBy === req.user!.id;
      if (!isAdmin && !isCreator) {
        res.status(403).json({ error: 'Only the creator or an admin can deactivate this purchase order' });
        return;
      }
      if (!isAdmin && (existing.status === POStatus.APPROVED || existing.status === POStatus.PARTIALLY_DELIVERED || existing.status === POStatus.DELIVERED)) {
        res.status(400).json({ error: 'Only an admin can deactivate an approved, partially delivered, or delivered purchase order' });
        return;
      }
      if (existing.status === POStatus.DELETED) {
        res.status(400).json({ error: 'Purchase order is already deleted' });
        return;
      }

      // ── Release committed budget when a PO is deleted ──
      // Only genuinely-committed statuses contribute to committedAmount
      // (APPROVED / PARTIALLY_DELIVERED / DELIVERED). Releasing here keeps the
      // cached total in sync with the source events and prevents deleted POs
      // from inflating the committed card on the budget head.
      const committedStatuses: string[] = [
        POStatus.APPROVED,
        POStatus.PARTIALLY_DELIVERED,
        POStatus.DELIVERED,
      ];
      const bhId = existing.budgetHeadId;
      if (bhId && committedStatuses.includes(existing.status)) {
        await prisma.$transaction(async (tx) => {
          await tx.purchaseOrder.update({
            where: { id: existing.id },
            data: { status: POStatus.DELETED },
          });
          const head = await tx.budgetHead.findUnique({
            where: { id: bhId },
            select: { committedAmount: true },
          });
          if (head) {
            const release = Math.min(
              Number(existing.grandTotal),
              Number(head.committedAmount)
            );
            if (release > 0) {
              await tx.budgetHead.update({
                where: { id: bhId },
                data: { committedAmount: { decrement: release } },
              });
            }
          }
        });
      } else {
        await prisma.purchaseOrder.update({
          where: { id: existing.id },
          data: { status: POStatus.DELETED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'PURCHASE_ORDER',
        entityId: existing.id,
        projectId,
        newValue: { status: 'DELETED', previousStatus: existing.status },
      });

      res.json({ message: 'Purchase order marked as deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve — approve PO (Kaushal Sir or Vinod Sir)
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!po || !po.approvalWorkflow) {
        res.status(404).json({ error: 'Purchase order or approval workflow not found' });
        return;
      }

      // Prevent approving a deleted PO
      if (po.status === POStatus.DELETED) {
        res.status(400).json({ error: 'Cannot approve a deleted purchase order' });
        return;
      }

      // Check user is one of the PO approver roles (Admin or Admin 2)
      if (!PO_APPROVER_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Admin or Admin 2 can approve purchase orders' });
        return;
      }

      // Find the step for this user's role
      const step = po.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending approval step for your role, or you may have already approved' });
        return;
      }

      // Check same person hasn't already approved
      const alreadyApproved = po.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this purchase order' });
        return;
      }

      // ── Budget overrun check: warn but allow approval with override reason ──
      // If committing this PO's grand total would exceed the budget head's allocated
      // amount, require a non-empty comment (override reason) from the approver.
      // Skip for edited POs: their commitment was already adjusted at edit time,
      // so re-approval does not add any additional commitment.
      if (po.budgetHeadId && !po.editedAt) {
        const head = await prisma.budgetHead.findFirst({
          where: { id: po.budgetHeadId, projectId, deletedAt: null },
          select: { allocatedAmount: true, committedAmount: true, particulars: true },
        });
        if (head) {
          const projectedCommitted = Number(head.committedAmount) + Number(po.grandTotal);
          if (projectedCommitted > Number(head.allocatedAmount)) {
            if (!req.body.comments || req.body.comments.trim().length === 0) {
              res.status(400).json({
                error: `Budget overrun: approving this PO will push budget head "${head.particulars}" committed amount to ${projectedCommitted}, exceeding the allocated ${Number(head.allocatedAmount)}. Provide an override reason in the comments to proceed.`,
              });
              return;
            }
          }
        }
      }

      // Approve the step
      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      // Only update PO status to APPROVED when fully approved (2 approvals)
      if (result.isFullyApproved) {
        // If this PO was edited (has editedAt), recalculate status based on accepted quantities
        // An edited PO that matches what was delivered should be DELIVERED, not just APPROVED
        if (po.editedAt) {
          const newStatus = await recalculatePoStatus(po.id);
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: newStatus },
          });
        } else {
          await prisma.purchaseOrder.update({
            where: { id: po.id },
            data: { status: POStatus.APPROVED },
          });
        }

        // ── Finance integration: increase budget head committedAmount ──
        // Skip for edited POs: their commitment was already adjusted at edit time
        // (delta = newGrandTotal - oldGrandTotal). Adding grandTotal again here
        // would double-count and permanently inflate the committed budget.
        if (po.budgetHeadId && !po.editedAt) {
          // Atomic increment — DB applies the delta, preventing lost updates
          // when multiple POs against the same budget head are approved concurrently.
          await prisma.budgetHead.update({
            where: { id: po.budgetHeadId },
            data: { committedAmount: { increment: Number(po.grandTotal) } },
          });
        }
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: { comments: req.body.comments, acknowledged: true },
      });

      const updated = await prisma.purchaseOrder.findUnique({
        where: { id: po.id },
        include: poInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject — reject PO (Admin or Admin 2)
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!po || !po.approvalWorkflow) {
        res.status(404).json({ error: 'Purchase order or approval workflow not found' });
        return;
      }

      // Prevent rejecting a deleted PO
      if (po.status === POStatus.DELETED) {
        res.status(400).json({ error: 'Cannot reject a deleted purchase order' });
        return;
      }

      if (!PO_APPROVER_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Admin or Admin 2 can reject purchase orders' });
        return;
      }

      const step = po.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: POStatus.REJECTED },
        });

        // ── Reverse commitment for edited POs on rejection ──
        // When an edited PO is rejected, the commitment that was adjusted at edit
        // time must be reversed. The remaining commitment for this PO is:
        //   grandTotal - paymentsAlreadyMadeAgainstThisPO
        // (payments already released part of the commitment via postVoucher;
        // GRNs no longer affect budget — they are inventory only.)
        if (po.budgetHeadId && po.editedAt) {
          const paymentsAgg = await prisma.payment.aggregate({
            where: { budgetHeadId: po.budgetHeadId, paymentRequest: { poId: po.id, deletedAt: null } },
            _sum: { amount: true },
          });
          const paidSoFar = Number(paymentsAgg._sum.amount) || 0;
          const remainingCommitment = Number(po.grandTotal) - paidSoFar;
          if (remainingCommitment > 0) {
            // Atomic decrement — DB applies the delta.
            await prisma.budgetHead.update({
              where: { id: po.budgetHeadId },
              data: { committedAmount: { decrement: remainingCommitment } },
            });
          }
        }
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: { reason, acknowledged: true },
      });

      const updated = await prisma.purchaseOrder.findUnique({
        where: { id: po.id },
        include: poInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/pdf — generate and download PDF
router.get(
  '/:id/pdf',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          vendor: true,
          quotation: { select: { quotationNumber: true } },
          items: true,
          createdByUser: { select: { name: true } },
          approvalWorkflow: {
            include: {
              steps: {
                orderBy: { stepNumber: 'asc' as const },
                include: { approverUser: { select: { name: true, role: true } } },
              },
            },
          },
          project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
      await streamPurchaseOrderPdf(res as unknown as NodeJS.WritableStream, po);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/gate-pass-eligible — check if PO is eligible for gate pass creation
router.get(
  '/:id/gate-pass-eligible',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: { id: true, status: true, createdBy: true },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      res.json({
        eligible: po.status === POStatus.APPROVED,
        status: po.status,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/edit-unapproved — edit a PENDING_APPROVAL or REJECTED PO (all fields editable)
router.post(
  '/:id/edit-unapproved',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(editUnapprovedPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.status !== POStatus.PENDING_APPROVAL && po.status !== POStatus.REJECTED) {
        res.status(400).json({ error: 'Only pending or rejected POs can be edited' });
        return;
      }

      const { paymentTerms, deliveryDate, budgetHeadId, items: newItems, deductions, notes } = req.body;

      // Validate budget head exists and belongs to project
      const budgetHead = await prisma.budgetHead.findFirst({
        where: { id: budgetHeadId, projectId, deletedAt: null },
      });
      if (!budgetHead) {
        res.status(400).json({ error: 'Budget head not found' });
        return;
      }

      // Recalculate amounts from new items
      const totalAmount = newItems.reduce((sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice, 0);
      const gstAmount = newItems.reduce((sum: number, i: { quantity: number; unitPrice: number; gstRate: number }) => sum + (i.quantity * i.unitPrice) * i.gstRate / 100, 0);
      const grandTotal = totalAmount + gstAmount;

      // ── Compute deductions ──
      const deductionRows: { amount: number; reason: string }[] = Array.isArray(deductions) ? deductions : [];
      const totalDeductions = deductionRows.reduce((sum, d) => sum + Number(d.amount), 0);
      if (totalDeductions > grandTotal) {
        res.status(400).json({ error: `Total deductions (${totalDeductions}) cannot exceed PO grand total (${grandTotal})` });
        return;
      }
      const netPayable = grandTotal - totalDeductions;

      // Payment type is fixed at creation — not editable here. If the PO has an
      // agreed advance amount, ensure the edited grand total still covers it.
      if (po.advanceAmount !== null && Number(po.advanceAmount) > grandTotal) {
        res.status(400).json({ error: `Edited grand total (${grandTotal}) is less than the agreed advance amount (${Number(po.advanceAmount)}). Increase the items or reduce the advance.` });
        return;
      }

      // Snapshot old values for audit
      const oldValue = {
        paymentType: po.paymentType,
        paymentTerms: po.paymentTerms,
        deliveryDate: po.deliveryDate,
        budgetHeadId: po.budgetHeadId,
        items: po.items.map((i) => ({ materialName: i.materialName, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), gstRate: Number(i.gstRate ?? 0) })),
        totalAmount: Number(po.totalAmount),
        gstAmount: Number(po.gstAmount),
        grandTotal: Number(po.grandTotal),
      };

      const result = await prisma.$transaction(async (tx) => {
        // Adjust budget head commitment if budget head or total changed
        if (po.budgetHeadId && po.budgetHeadId !== budgetHeadId) {
          // Old budget head: remove commitment
          await tx.budgetHead.update({
            where: { id: po.budgetHeadId },
            data: { committedAmount: { decrement: Number(po.grandTotal) } },
          });
          // New budget head: add commitment
          await tx.budgetHead.update({
            where: { id: budgetHeadId },
            data: { committedAmount: { increment: grandTotal } },
          });
        } else if (po.budgetHeadId === budgetHeadId) {
          // Same budget head — adjust by delta
          const delta = grandTotal - Number(po.grandTotal);
          if (delta !== 0) {
            await tx.budgetHead.update({
              where: { id: budgetHeadId },
              data: { committedAmount: { increment: delta } },
            });
          }
        } else if (!po.budgetHeadId) {
          // No previous budget head — add commitment to new one
          await tx.budgetHead.update({
            where: { id: budgetHeadId },
            data: { committedAmount: { increment: grandTotal } },
          });
        }

        // Delete existing items
        await tx.pOItem.deleteMany({ where: { poId: po.id } });

        // Create new items
        await tx.pOItem.createMany({
          data: newItems.map((i: { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }) => ({
            poId: po.id,
            materialName: i.materialName,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            gstRate: i.gstRate,
          })),
        });

        // Update PO fields
        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            paymentTerms: paymentTerms ?? null,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            notes: notes ?? null,
            budgetHeadId,
            totalAmount,
            gstAmount,
            grandTotal,
            deductions: deductionRows.length > 0 ? deductionRows : Prisma.JsonNull,
            totalDeductions,
            netPayable,
            editedAt: new Date(),
            editedBy: req.user!.id,
            status: POStatus.PENDING_APPROVAL,
          },
          include: poInclude,
        });

        // Reset approval workflow if it exists
        if (po.approvalWorkflowId) {
          await tx.approvalStep.deleteMany({ where: { workflowId: po.approvalWorkflowId } });
          await tx.approvalWorkflow.update({
            where: { id: po.approvalWorkflowId },
            data: {
              status: 'VERIFICATION',
              currentStep: 0,
              steps: {
                create: [UserRole.ADMIN, UserRole.ADMIN_2].map((role, idx) => ({
                  stepNumber: idx + 1,
                  approverRole: role,
                  status: 'PENDING',
                })),
              },
            },
          });
        }

        return updated;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue,
        newValue: { paymentTerms, deliveryDate, budgetHeadId, items: newItems, totalAmount, gstAmount, grandTotal },
      });

      // Notify approvers
      notifyApprovers(projectId, PO_APPROVER_ROLES as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Edited — Re-approval Required',
        body: `${po.poNumber} was edited and needs re-approval`,
        url: `/pos?approval=${po.approvalWorkflowId ?? ''}`,
      }).catch((err) => console.error('[Push] PO edit notification error:', err));

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// POST /:id/change-payment-type — change payment type on an APPROVED PO.
// The PO goes back to PENDING_APPROVAL and must be re-approved; once approved
// it is treated as the new type everywhere (advance payments, invoice flow).
router.post(
  '/:id/change-payment-type',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(changePOPaymentTypeSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          advancePaymentRequests: {
            where: { deletedAt: null, status: { not: 'REJECTED' } },
            select: { id: true, paymentCode: true },
          },
          invoices: { where: { deletedAt: null }, select: { id: true, invoiceCode: true } },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.status !== POStatus.APPROVED) {
        res.status(400).json({ error: 'Only approved POs can have their payment type changed' });
        return;
      }
      if (po.advancePaymentRequests.length > 0) {
        res.status(409).json({
          error: `Payment request ${po.advancePaymentRequests[0].paymentCode} already exists against this PO — cancel or complete it first`,
        });
        return;
      }
      if (po.invoices.length > 0) {
        res.status(409).json({
          error: `Invoice ${po.invoices[0].invoiceCode} already exists against this PO — payment type cannot be changed`,
        });
        return;
      }

      const { paymentType, advanceAmount, reason } = req.body;
      if (paymentType === po.paymentType) {
        res.status(400).json({ error: 'Payment type is already ' + paymentType });
        return;
      }

      // Same rules as PO creation: ADVANCE / FULL_PAYMENT need an agreed
      // advance amount ≤ grandTotal; AFTER_DELIVERY carries none.
      let resolvedAdvanceAmount: number | null;
      if (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) {
        const amt = Number(advanceAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          res.status(400).json({ error: 'Advance amount is required for advance / full payment POs' });
          return;
        }
        if (amt > Number(po.grandTotal)) {
          res.status(400).json({ error: `Advance amount cannot exceed PO grand total of ${Number(po.grandTotal)}` });
          return;
        }
        resolvedAdvanceAmount = amt;
      } else {
        resolvedAdvanceAmount = null;
      }

      const oldValue = { paymentType: po.paymentType, advanceAmount: po.advanceAmount ? Number(po.advanceAmount) : null };

      const updated = await prisma.$transaction(async (tx) => {
        const updatedPo = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            paymentType,
            advanceAmount: resolvedAdvanceAmount,
            status: POStatus.PENDING_APPROVAL,
            editReason: reason,
            editedAt: new Date(),
            editedBy: req.user!.id,
          },
          include: poInclude,
        });

        // Reset approval workflow for re-approval (one ADMIN/ADMIN_2 approval)
        if (po.approvalWorkflowId) {
          await tx.approvalStep.deleteMany({ where: { workflowId: po.approvalWorkflowId } });
          await tx.approvalWorkflow.update({
            where: { id: po.approvalWorkflowId },
            data: {
              status: 'VERIFICATION',
              currentStep: 0,
              steps: {
                create: PO_APPROVER_ROLES.map((role, idx) => ({
                  stepNumber: idx + 1,
                  approverRole: role,
                  status: 'PENDING',
                })),
              },
            },
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
              approvalPolicy: 'PO_SINGLE_APPROVER',
              steps: {
                create: PO_APPROVER_ROLES.map((role, idx) => ({
                  stepNumber: idx + 1,
                  approverRole: role,
                  status: 'PENDING',
                })),
              },
            },
          });
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { approvalWorkflowId: workflow.id },
          });
        }

        return updatedPo;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue,
        newValue: { paymentType, advanceAmount: resolvedAdvanceAmount, reason },
      });

      notifyApprovers(projectId, PO_APPROVER_ROLES as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Payment Type Changed — Re-approval Required',
        body: `${po.poNumber} payment type changed to ${paymentType.replace(/_/g, ' ')} and needs re-approval`,
        url: `/pos?approval=${po.approvalWorkflowId ?? ''}`,
      }).catch((err) => console.error('[Push] PO payment-type notification error:', err));

      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

// POST /:id/edit — edit a PARTIALLY_DELIVERED PO (reduce quantities to match delivered, re-approve)
router.post(
  '/:id/edit',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(editPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.status !== POStatus.PARTIALLY_DELIVERED) {
        res.status(400).json({ error: 'Only partially delivered POs can be edited' });
        return;
      }
      if (po.parentPoId) {
        res.status(400).json({ error: 'Regenerated POs cannot be edited. Edit the original PO instead.' });
        return;
      }

      // Compute accepted quantities per material
      const acceptedMap = await getAcceptedQuantitiesByPo(po.id);

      // Validate: each submitted item's quantity must be >= accepted qty for that material
      const newItems = req.body.items as { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[];
      for (const item of newItems) {
        const accepted = acceptedMap.byName.get(item.materialName.toLowerCase()) ?? 0;
        if (item.quantity < accepted) {
          res.status(400).json({
            error: `Cannot reduce "${item.materialName}" below accepted quantity (${accepted}). Already delivered.`,
          });
          return;
        }
      }

      // Compute remaining items for regeneration (items from original PO not included in edit, or reduced quantity)
      const remainingItems: { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[] = [];

      for (const origItem of po.items) {
        const accepted = acceptedForPoItem(acceptedMap, origItem);
        const editedItem = newItems.find((i) => i.materialName === origItem.materialName);

        if (!editedItem) {
          // Item was deselected — remaining = original ordered - accepted
          const remaining = Number(origItem.quantity) - accepted;
          if (remaining > 0) {
            remainingItems.push({
              materialName: origItem.materialName,
              quantity: remaining,
              unit: origItem.unit ?? 'nos',
              unitPrice: Number(origItem.unitPrice),
              gstRate: Number(origItem.gstRate ?? 0),
            });
          }
        } else {
          // Item was edited — remaining = original qty - edited qty (the portion cut from the PO that needs a new vendor)
          const remaining = Number(origItem.quantity) - editedItem.quantity;
          if (remaining > 0) {
            remainingItems.push({
              materialName: origItem.materialName,
              quantity: remaining,
              unit: editedItem.unit,
              unitPrice: editedItem.unitPrice,
              gstRate: editedItem.gstRate,
            });
          }
        }
      }

      // Recalculate amounts from new items
      const totalAmount = newItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      const gstAmount = newItems.reduce((sum, i) => sum + (i.quantity * i.unitPrice) * i.gstRate / 100, 0);
      const grandTotal = totalAmount + gstAmount;

      // Snapshot old values for audit
      const oldValue = {
        items: po.items.map((i) => ({ materialName: i.materialName, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), gstRate: Number(i.gstRate ?? 0) })),
        totalAmount: Number(po.totalAmount),
        gstAmount: Number(po.gstAmount),
        grandTotal: Number(po.grandTotal),
      };

      // ── Compute commitment adjustment for the PO edit ──
      // In the new budget model, GRNs no longer affect budget (inventory only).
      // Payments reduce committed and increase actual/paid. So the commitment
      // adjustment for a PO edit is simply the delta: newGrandTotal - oldGrandTotal.
      // Payments already made against this PO are unaffected by the edit.
      const commitmentAdjustment = grandTotal - Number(po.grandTotal);

      const result = await prisma.$transaction(async (tx) => {
        // Delete existing items
        await tx.pOItem.deleteMany({ where: { poId: po.id } });

        // Create new items
        await tx.pOItem.createMany({
          data: newItems.map((i) => ({
            poId: po.id,
            materialName: i.materialName,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            gstRate: i.gstRate,
          })),
        });

        // Store regeneration data for later, set edit metadata, reset status to PENDING_APPROVAL
        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            totalAmount,
            gstAmount,
            grandTotal,
            editReason: req.body.editReason,
            editedAt: new Date(),
            editedBy: req.user!.id,
            regenerationData: remainingItems.length > 0 ? remainingItems : Prisma.JsonNull,
            status: POStatus.PENDING_APPROVAL,
          },
          include: poInclude,
        });

        // ── Adjust budget head commitment ──
        // The adjustment is the delta (newGrandTotal - oldGrandTotal).
        // This is done at edit time so re-approval does NOT re-add the full total.
        if (po.budgetHeadId && commitmentAdjustment !== 0) {
          // Atomic adjustment — increment handles both directions (negative
          // commitmentAdjustment decrements). Prevents lost updates.
          await tx.budgetHead.update({
            where: { id: po.budgetHeadId },
            data: { committedAmount: { increment: commitmentAdjustment } },
          });
        }

        // Reset the existing approval workflow — create fresh steps
        if (po.approvalWorkflowId) {
          // Delete old steps and reset workflow
          await tx.approvalStep.deleteMany({ where: { workflowId: po.approvalWorkflowId } });
          await tx.approvalWorkflow.update({
            where: { id: po.approvalWorkflowId },
            data: {
              status: 'VERIFICATION',
              currentStep: 0,
              steps: {
                create: [UserRole.ADMIN, UserRole.ADMIN_2].map((role, idx) => ({
                  stepNumber: idx + 1,
                  approverRole: role,
                  status: 'PENDING',
                })),
              },
            },
          });
        }

        return updated;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue,
        newValue: { items: newItems, editReason: req.body.editReason, remainingItems },
      });

      // Notify approvers
      notifyApprovers(projectId, PO_APPROVER_ROLES as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Edited — Re-approval Required',
        body: `${po.poNumber} was edited and needs re-approval`,
        url: `/pos?approval=${po.approvalWorkflowId ?? ''}`,
      }).catch((err) => console.error('[Push] PO edit notification error:', err));

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/regenerate — generate a new PO for remaining items from an edited PO
router.post(
  '/:id/regenerate',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(regeneratePOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.parentPoId) {
        res.status(400).json({ error: 'Cannot regenerate a regenerated PO. Regenerate from the original PO.' });
        return;
      }
      if (!po.regenerationData || !Array.isArray(po.regenerationData) || (po.regenerationData as unknown[]).length === 0) {
        res.status(400).json({ error: 'No remaining items to regenerate. Edit the PO first to reduce quantities.' });
        return;
      }
      // Must be DELIVERED (i.e. edited PO was re-approved and status recalculated)
      if (po.status !== POStatus.DELIVERED) {
        res.status(400).json({ error: 'PO must be delivered (edited and re-approved) before regenerating.' });
        return;
      }
      // Check no child PO already exists
      const existingChild = await prisma.purchaseOrder.findFirst({
        where: { parentPoId: po.id, deletedAt: null },
      });
      if (existingChild) {
        res.status(400).json({ error: `Already regenerated to ${existingChild.poNumber}` });
        return;
      }

      const remainingItems = po.regenerationData as { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[];
      const regenNumber = await generateRegeneratedPONumber(po);
      const totalAmount = remainingItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      const gstAmount = remainingItems.reduce((sum, i) => sum + (i.quantity * i.unitPrice) * i.gstRate / 100, 0);
      const grandTotal = totalAmount + gstAmount;

      const result = await prisma.$transaction(async (tx) => {
        // Create regenerated PO
        const regenPo = await tx.purchaseOrder.create({
          data: {
            projectId,
            vendorId: po.vendorId,
            quotationId: po.quotationId,
            phaseId: po.phaseId,
            poNumber: regenNumber,
            status: POStatus.PENDING_APPROVAL,
            paymentType: po.paymentType,
            totalAmount,
            gstAmount,
            grandTotal,
            budgetHeadId: po.budgetHeadId,
            createdBy: req.user!.id,
            parentPoId: po.id,
            regenerationNumber: 1,
          },
          include: poInclude,
        });

        // Create items
        await tx.pOItem.createMany({
          data: remainingItems.map((i) => ({
            poId: regenPo.id,
            materialName: i.materialName,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: i.unitPrice,
            amount: i.quantity * i.unitPrice,
            gstRate: i.gstRate,
          })),
        });

        // Initiate approval workflow
        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PURCHASE_ORDER',
            entityId: regenPo.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: 1,
            approvalPolicy: 'PO_SINGLE_APPROVER',
            steps: {
              create: [UserRole.ADMIN, UserRole.ADMIN_2].map((role, idx) => ({
                stepNumber: idx + 1,
                approverRole: role,
                status: 'PENDING',
              })),
            },
          },
          include: { steps: true },
        });

        await tx.purchaseOrder.update({
          where: { id: regenPo.id },
          data: { approvalWorkflowId: workflow.id },
        });

        return tx.purchaseOrder.findUnique({ where: { id: regenPo.id }, include: poInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: result!.id,
        projectId,
        newValue: { poNumber: regenNumber, parentPoId: po.id, parentPoNumber: po.poNumber, items: remainingItems },
      });

      // Notify approvers
      notifyApprovers(projectId, PO_APPROVER_ROLES as UserRole[], {
        approvalId: result!.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: result!.id,
        title: 'Regenerated PO — Approval Required',
        body: `${regenNumber} (from ${po.poNumber}) needs approval`,
        url: `/pos?approval=${result!.approvalWorkflowId ?? ''}`,
      }).catch((err) => console.error('[Push] Regen PO notification error:', err));

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/change-budget-head — admin-only: change the budget head of an
// approved (or partially delivered / delivered) PO. Moves the committed and
// actual amounts from the old budget head to the new one atomically so the
// old head gets its money back and the new head is charged.
//
// Allowed for ADMIN / ADMIN_2 only (MANAGE_FINANCE permission).
router.post(
  '/:id/change-budget-head',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { budgetHeadId: newBudgetHeadId, reason } = req.body as { budgetHeadId: string; reason?: string };

      if (!newBudgetHeadId || typeof newBudgetHeadId !== 'string') {
        res.status(400).json({ error: 'New budget head ID is required' });
        return;
      }

      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true, budgetHead: { select: { particulars: true } } },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      // Only approved / partially delivered / delivered POs have committed
      // budget that needs to be moved. Pending/rejected POs can be edited
      // directly via the edit-unapproved flow.
      if (![POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED].includes(po.status as POStatus)) {
        res.status(400).json({ error: 'Budget head can only be changed on approved or delivered POs' });
        return;
      }

      if (!po.budgetHeadId) {
        res.status(400).json({ error: 'This PO has no budget head to change' });
        return;
      }

      if (po.budgetHeadId === newBudgetHeadId) {
        res.status(400).json({ error: 'New budget head is the same as the current one' });
        return;
      }

      // Validate the new budget head exists and belongs to the project
      const newBudgetHead = await prisma.budgetHead.findFirst({
        where: { id: newBudgetHeadId, projectId, deletedAt: null },
        select: { id: true, particulars: true, allocatedAmount: true, committedAmount: true, actualAmount: true },
      });
      if (!newBudgetHead) {
        res.status(400).json({ error: 'New budget head not found' });
        return;
      }

      // Compute how much of this PO's value is still committed vs already
      // paid via payments. GRNs no longer affect budget — they are inventory only.
      const grandTotal = Number(po.grandTotal);
      const paymentsAgg = await prisma.payment.aggregate({
        where: { budgetHeadId: po.budgetHeadId, paymentRequest: { poId: po.id, deletedAt: null } },
        _sum: { amount: true },
      });
      const paidSoFar = Number(paymentsAgg._sum.amount) || 0;
      const remainingCommitted = Math.max(0, grandTotal - paidSoFar);

      const oldBudgetHeadId = po.budgetHeadId;
      const oldParticulars = po.budgetHead?.particulars ?? 'unknown';
      const newParticulars = newBudgetHead.particulars;

      // Atomic transaction: move committed + actual + paid amounts from old
      // head to new head, re-tag the linked payments and their bank/cash
      // transactions + ledger entries, and update the PO's budgetHeadId.
      const updated = await prisma.$transaction(async (tx) => {
        // Old budget head: return the remaining committed amount AND the
        // actual/paid amount that was already moved via payments.
        await tx.budgetHead.update({
          where: { id: oldBudgetHeadId },
          data: {
            committedAmount: { decrement: remainingCommitted },
            actualAmount: { decrement: paidSoFar },
            paidAmount: { decrement: paidSoFar },
          },
        });

        // New budget head: add the remaining committed amount AND the
        // actual/paid amount (so the new head reflects the full PO value).
        await tx.budgetHead.update({
          where: { id: newBudgetHeadId },
          data: {
            committedAmount: { increment: remainingCommitted },
            actualAmount: { increment: paidSoFar },
            paidAmount: { increment: paidSoFar },
          },
        });

        // Re-tag linked payments and their bank/cash transactions + ledger
        // entries so the recompute stays consistent with the cached totals.
        const poPayments = await tx.payment.findMany({
          where: { budgetHeadId: oldBudgetHeadId, paymentRequest: { poId: po.id, deletedAt: null } },
          select: { id: true, journalVoucherId: true },
        });
        for (const pmt of poPayments) {
          await tx.payment.update({
            where: { id: pmt.id },
            data: { budgetHeadId: newBudgetHeadId },
          });
          if (pmt.journalVoucherId) {
            await tx.bankTransaction.updateMany({
              where: { referenceId: pmt.journalVoucherId, budgetHeadId: oldBudgetHeadId },
              data: { budgetHeadId: newBudgetHeadId },
            });
            await tx.cashTransaction.updateMany({
              where: { referenceId: pmt.journalVoucherId, budgetHeadId: oldBudgetHeadId },
              data: { budgetHeadId: newBudgetHeadId },
            });
            await tx.ledgerEntry.updateMany({
              where: { journalVoucherId: pmt.journalVoucherId, budgetHeadId: oldBudgetHeadId },
              data: { budgetHeadId: newBudgetHeadId },
            });
          }
        }

        // Update the PO's budget head
        return tx.purchaseOrder.update({
          where: { id: po.id },
          data: { budgetHeadId: newBudgetHeadId },
          include: poInclude,
        });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue: { budgetHeadId: oldBudgetHeadId, budgetHead: oldParticulars },
        newValue: {
          budgetHeadId: newBudgetHeadId,
          budgetHead: newParticulars,
          movedCommitted: remainingCommitted,
          movedActual: paidSoFar,
          reason: reason ?? 'Admin budget head change',
        },
      });

      console.log(
        `[PO] Budget head changed for ${po.poNumber}: ` +
        `"${oldParticulars}" → "${newParticulars}" ` +
        `(committed: ₹${remainingCommitted}, paid: ₹${paidSoFar})`
      );

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
