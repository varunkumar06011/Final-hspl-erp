import { Router, Response, NextFunction } from 'express';
import { Permission, POStatus, AuditAction, UserRole, GoodsReceiptStatus } from '@hospital-erp/shared';
import { createPOSchema, listPOsSchema, approvalActionSchema, editPOSchema, regeneratePOSchema } from '@hospital-erp/shared';
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

// ─── Helper: compute total delivered value from posted GRNs ───
// Matches GRN items to PO items by poItemId (correct per-line tracking), with a
// material-name fallback for legacy GR items. Optional materialFilter restricts
// to a subset of materials (used to separate delivered value for remaining vs
// deselected items).
async function getDeliveredValueForPo(
  poId: string,
  poItems: { id?: string; materialName: string; unitPrice: { toNumber?: () => number } | number; gstRate: { toNumber?: () => number } | number | null }[],
  materialFilter?: Set<string>,
): Promise<number> {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { poId, deletedAt: null, status: GoodsReceiptStatus.POSTED },
    select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
  });

  const itemByPoItemId = new Map<string, { unitPrice: number; gstRate: number }>();
  const itemByName = new Map<string, { unitPrice: number; gstRate: number }>();
  for (const item of poItems) {
    const name = item.materialName.toLowerCase();
    if (materialFilter && !materialFilter.has(name)) continue;
    const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : Number(item.unitPrice);
    const gstRate = item.gstRate === null ? 0 : (typeof item.gstRate === 'number' ? item.gstRate : Number(item.gstRate));
    const entry = { unitPrice, gstRate };
    if (item.id) itemByPoItemId.set(item.id, entry);
    itemByName.set(name, entry);
  }

  let deliveredValue = 0;
  for (const receipt of receipts) {
    for (const line of receipt.items) {
      if (Number(line.acceptedQty) <= 0) continue;
      const item =
        (line.poItemId ? itemByPoItemId.get(line.poItemId) : undefined) ??
        itemByName.get(line.materialName.toLowerCase());
      if (item) {
        const lineAmount = item.unitPrice * Number(line.acceptedQty);
        const lineGst = lineAmount * item.gstRate / 100;
        deliveredValue += lineAmount + lineGst;
      }
    }
  }
  return deliveredValue;
}

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN, UserRole.ADMIN_2];
const PO_APPROVER_ROLES = [UserRole.PROJECT_HEAD, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN, UserRole.ADMIN_2];

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
      const { page, pageSize, vendorId, status } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;

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

      res.json({
        data,
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
      const { vendorId, quotationId, paymentType, paymentTerms, deliveryDate, budgetHeadId } = req.body;

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
            paymentTerms: paymentTerms ?? null,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            totalAmount,
            gstAmount: gst,
            grandTotal,
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

        // Initiate approval workflow — one approval from any head/MD.
        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PURCHASE_ORDER',
            entityId: po.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: 1,
            approvalPolicy: 'PO_HEAD_APPROVERS',
            steps: {
              create: [UserRole.PROJECT_HEAD, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN_2].map((role, idx) => ({
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
        newValue: { poNumber, vendorId, quotationId, totalAmount, grandTotal, acknowledged: true },
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

// PATCH /:id — update PO (no editable fields after GST became per-item; kept for future use)
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
      if (existing.status === POStatus.APPROVED || existing.status === POStatus.DELIVERED) {
        res.status(400).json({ error: 'Cannot edit an approved purchase order' });
        return;
      }

      // GST is now auto-calculated from per-item gstRate — no manual override
      const updated = await prisma.purchaseOrder.findUnique({
        where: { id: existing.id },
        include: poInclude,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (only by creator, only if not approved)
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
      if (existing.createdBy !== req.user!.id) {
        res.status(403).json({ error: 'Only the creator can delete this purchase order' });
        return;
      }
      if (existing.status === POStatus.APPROVED || existing.status === POStatus.PARTIALLY_DELIVERED || existing.status === POStatus.DELIVERED) {
        res.status(400).json({ error: 'Cannot delete an approved, partially delivered, or delivered purchase order' });
        return;
      }

      await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'PURCHASE_ORDER',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Purchase order deleted' });
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

      // Check user is one of the PO approver roles (Admin or Admin 2)
      if (!PO_APPROVER_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Project Head, Accounts Head or Admin 2 can approve purchase orders' });
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

// POST /:id/reject — reject PO (any of 4 head roles)
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

      if (!PO_APPROVER_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Project Head, Accounts Head or Admin 2 can reject purchase orders' });
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
        //   grandTotal - deliveredValueForRemainingItems
        // (deliveredValue only includes items still in the edited PO; deselected
        // items' commitment was already excluded at edit time.)
        if (po.budgetHeadId && po.editedAt) {
          const currentItems = await prisma.pOItem.findMany({
            where: { poId: po.id },
            select: { id: true, materialName: true, unitPrice: true, gstRate: true },
          });
          const deliveredForRemaining = await getDeliveredValueForPo(po.id, currentItems);
          const remainingCommitment = Number(po.grandTotal) - deliveredForRemaining;
          if (remainingCommitment !== 0) {
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

      // ── Compute delivered values for correct commitment adjustment ──
      // The delta (newGrandTotal - oldGrandTotal) alone is insufficient when items
      // are deselected: a deselected item's commitment may have already been
      // converted to actual via GRN. Subtracting its full value via delta would
      // over-reduce committed. The correct adjustment is:
      //   delta + deliveredValueForDeselectedItems
      // where deliveredValueForDeselectedItems = totalDelivered - deliveredForRemaining.
      let commitmentAdjustment = grandTotal - Number(po.grandTotal); // base delta
      if (po.budgetHeadId) {
        const remainingMaterials = new Set(newItems.map((i) => i.materialName.toLowerCase()));
        const totalDelivered = await getDeliveredValueForPo(po.id, po.items);
        const deliveredForRemaining = await getDeliveredValueForPo(po.id, po.items, remainingMaterials);
        const deliveredForDeselected = totalDelivered - deliveredForRemaining;
        commitmentAdjustment = (grandTotal - Number(po.grandTotal)) + deliveredForDeselected;
      }

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
        // The adjustment accounts for deselected items whose commitment was
        // already converted to actual via GRN. See computation above.
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
            approvalPolicy: 'PO_HEAD_APPROVERS',
            steps: {
              create: [UserRole.PROJECT_HEAD, UserRole.ACCOUNTS_HEAD, UserRole.ADMIN_2].map((role, idx) => ({
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

export default router;
