import { Router, Response, NextFunction } from 'express';
import { Permission, POStatus, AuditAction, UserRole, GoodsReceiptStatus, POPaymentType } from '@hospital-erp/shared';
import { createPOSchema, listPOsSchema, approvalActionSchema, editPOSchema, regeneratePOSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { notifyApprovers } from '../services/push.service';
import PDFDocument from 'pdfkit';

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

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];
const PO_APPROVER_ROLES = [UserRole.ADMIN, UserRole.ADMIN_2];

async function generatePONumber(projectId: string): Promise<string> {
  const pos = await prisma.purchaseOrder.findMany({
    where: { projectId, poNumber: { startsWith: 'VGH-PO' } },
    select: { poNumber: true },
  });
  const maxNum = pos.reduce((max, p) => {
    const match = p.poNumber?.match(/^VGH-PO(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-PO${String(maxNum + 1).padStart(3, '0')}`;
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
      const { vendorId, quotationId, paymentType } = req.body;

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
            totalAmount,
            gstAmount: gst,
            grandTotal,
            budgetHeadId: req.body.budgetHeadId ?? null,
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

        // Initiate approval workflow — one approval from Kaushal Sir or Vinod Sir
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
          const head = await prisma.budgetHead.findFirst({
            where: { id: po.budgetHeadId, projectId, deletedAt: null },
          });
          if (head) {
            await prisma.budgetHead.update({
              where: { id: po.budgetHeadId },
              data: { committedAmount: Number(head.committedAmount) + Number(po.grandTotal) },
            });
          }
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
            const head = await prisma.budgetHead.findFirst({
              where: { id: po.budgetHeadId, projectId, deletedAt: null },
            });
            if (head) {
              await prisma.budgetHead.update({
                where: { id: po.budgetHeadId },
                data: { committedAmount: Number(head.committedAmount) - remainingCommitment },
              });
            }
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
          project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true } },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
      doc.pipe(res);

      // Colors
      const PRIMARY = '#1a5276';
      const PRIMARY_LIGHT = '#d4e6f1';
      const LIGHT_BG = '#f8f9fa';
      const BORDER = '#bdc3c7';
      const TEXT_DARK = '#2c3e50';
      const TEXT_MUTED = '#7f8c8d';
      const WHITE = '#ffffff';
      const GREEN = '#27ae60';

      const pageWidth = 595;
      const pageHeight = 842;
      const margin = 50;
      const contentWidth = pageWidth - margin * 2; // 495

      // ── Header band ──
      doc.rect(0, 0, pageWidth, 70).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(22).font('Helvetica-Bold').text(po.project?.name ?? 'Vgrand Hospital', margin, 14);
      doc.fontSize(10).font('Helvetica').fillColor(PRIMARY_LIGHT).text('PURCHASE ORDER', margin, 40);
      if (po.project?.gstNumber) {
        doc.fontSize(8).font('Helvetica').fillColor(PRIMARY_LIGHT).text(`GSTIN: ${po.project.gstNumber}`, margin, 55);
      }
      // PO number badge on the right
      const badgeW = 120;
      const badgeX = pageWidth - margin - badgeW;
      doc.roundedRect(badgeX, 15, badgeW, 40, 5).fill(WHITE);
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text('PO NUMBER', badgeX + 8, 20, { width: badgeW - 16 });
      doc.fillColor(PRIMARY).fontSize(13).font('Helvetica-Bold').text(po.poNumber, badgeX + 8, 32, { width: badgeW - 16 });

      // ── PO info row ──
      let y = 85;
      doc.fontSize(8).font('Helvetica').fillColor(TEXT_MUTED);
      doc.text('Date:', margin, y, { width: 35 });
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(
        new Date(po.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        margin + 35,
        y,
        { width: 80 }
      );
      doc.fillColor(TEXT_MUTED).font('Helvetica').text('Created By:', margin + 140, y, { width: 60 });
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(po.createdByUser?.name ?? '—', margin + 200, y, { width: 120 });
      if (po.quotation) {
        doc.fillColor(TEXT_MUTED).font('Helvetica').text('Quotation:', margin + 340, y, { width: 55 });
        doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(po.quotation.quotationNumber, margin + 395, y, { width: 100 });
      }
      y += 15;

      // Payment type line
      const paymentTypeLabel = po.paymentType === POPaymentType.ADVANCE
        ? 'Against Advance'
        : po.paymentType === POPaymentType.FULL_PAYMENT
          ? 'Against Full Payment'
          : 'After Delivery';
      doc.fillColor(TEXT_MUTED).font('Helvetica').text('Payment Type:', margin, y, { width: 70 });
      doc.fillColor(PRIMARY).font('Helvetica-Bold').text(paymentTypeLabel, margin + 70, y, { width: 200 });
      y += 15;

      // ── Info cards: 2 columns (Vendor on left, Addresses on right) ──
      y += 5;
      const cardGap = 10;
      const leftCardW = 240;
      const rightCardW = contentWidth - leftCardW - cardGap; // 245
      const cardH = 100;

      // Vendor card (left)
      doc.roundedRect(margin, y, leftCardW, cardH, 5).fillAndStroke(LIGHT_BG, BORDER);
      doc.rect(margin, y, leftCardW, 20).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold').text('VENDOR', margin + 8, y + 6, { width: leftCardW - 16 });
      let vy = y + 28;
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text('Name', margin + 8, vy, { width: leftCardW - 16 });
      doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(po.vendor?.name ?? '—', margin + 8, vy + 9, { width: leftCardW - 16 });
      vy += 26;
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text('Contact', margin + 8, vy, { width: leftCardW - 16 });
      doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(po.vendor?.phone ?? po.vendor?.contactPersonPhone ?? '—', margin + 8, vy + 9, { width: leftCardW - 16 });
      vy += 26;
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text('Address', margin + 8, vy, { width: leftCardW - 16 });
      doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica').text(po.vendor?.address ?? '—', margin + 8, vy + 9, { width: leftCardW - 16, height: 12 });

      // Bill To + Delivery (right, stacked)
      const rightX = margin + leftCardW + cardGap;
      const subCardH = (cardH - 10) / 2; // 45 each

      // Bill To
      doc.roundedRect(rightX, y, rightCardW, subCardH, 5).fillAndStroke(LIGHT_BG, BORDER);
      doc.rect(rightX, y, rightCardW, 18).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(7).font('Helvetica-Bold').text('BILL TO (Office Address)', rightX + 8, y + 5, { width: rightCardW - 16 });
      doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica').text(po.project?.officeAddress ?? '—', rightX + 8, y + 22, { width: rightCardW - 16, height: 20 });

      // Delivery Address
      const dy2 = y + subCardH + 10;
      doc.roundedRect(rightX, dy2, rightCardW, subCardH, 5).fillAndStroke(LIGHT_BG, BORDER);
      doc.rect(rightX, dy2, rightCardW, 18).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(7).font('Helvetica-Bold').text('DELIVERY ADDRESS (Hospital)', rightX + 8, dy2 + 5, { width: rightCardW - 16 });
      doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica').text(po.project?.hospitalAddress ?? '—', rightX + 8, dy2 + 22, { width: rightCardW - 16, height: 20 });

      y += cardH + 15;

      // ── Items table ──
      doc.fillColor(PRIMARY).fontSize(11).font('Helvetica-Bold').text('Items', margin, y);
      y += 16;

      // Column layout — all within contentWidth (495)
      // S.no: 30, Description: 200, Qty: 50, Unit: 40, Unit Price: 80, Total: 95 = 495
      const cols = [
        { key: 'sno', label: 'S.no', x: margin, w: 30, align: 'center' },
        { key: 'desc', label: 'Description', x: margin + 30, w: 200, align: 'left' },
        { key: 'qty', label: 'Qty', x: margin + 230, w: 50, align: 'center' },
        { key: 'unit', label: 'Unit', x: margin + 280, w: 40, align: 'center' },
        { key: 'price', label: 'Unit Price', x: margin + 320, w: 80, align: 'right' },
        { key: 'total', label: 'Total Amount', x: margin + 400, w: 95, align: 'right' },
      ];
      const tableW = contentWidth;
      const headerH = 22;
      const rowH = 20;

      // Table header
      doc.rect(margin, y, tableW, headerH).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold');
      for (const c of cols) {
        doc.text(c.label, c.x + 4, y + 7, { width: c.w - 8, align: c.align as 'center' | 'left' | 'right' });
      }
      y += headerH;

      // Table rows
      doc.fontSize(8).font('Helvetica');
      po.items.forEach((item, idx) => {
        // Alternating row background
        doc.rect(margin, y, tableW, rowH).fill(idx % 2 === 0 ? WHITE : PRIMARY_LIGHT);
        doc.fillColor(TEXT_DARK);
        doc.text(String(idx + 1), cols[0].x + 4, y + 6, { width: cols[0].w - 8, align: 'center' });
        doc.text(item.materialName, cols[1].x + 4, y + 6, { width: cols[1].w - 8 });
        doc.text(String(item.quantity), cols[2].x + 4, y + 6, { width: cols[2].w - 8, align: 'center' });
        doc.text(item.unit ?? '', cols[3].x + 4, y + 6, { width: cols[3].w - 8, align: 'center' });
        doc.text(`Rs. ${Number(item.unitPrice).toFixed(2)}`, cols[4].x + 4, y + 6, { width: cols[4].w - 8, align: 'right' });
        doc.text(`Rs. ${Number(item.amount).toFixed(2)}`, cols[5].x + 4, y + 6, { width: cols[5].w - 8, align: 'right' });
        y += rowH;
      });
      // Table outer border
      doc.rect(margin, y - po.items.length * rowH - headerH, tableW, po.items.length * rowH + headerH).stroke(PRIMARY);

      // ── Totals section (full width, below table) ──
      y += 10;
      const totalsH = 28;
      const hasGst = Number(po.gstAmount) > 0;

      // Subtotal row
      doc.rect(margin, y, tableW, totalsH).fill(LIGHT_BG).stroke(BORDER);
      doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica').text('Subtotal', margin + 12, y + 9, { width: 300 });
      doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(`Rs. ${Number(po.totalAmount).toFixed(2)}`, margin + 350, y + 9, { width: tableW - 360, align: 'right' });
      y += totalsH;

      if (hasGst) {
        doc.rect(margin, y, tableW, totalsH).fill(LIGHT_BG).stroke(BORDER);
        doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica').text('GST', margin + 12, y + 9, { width: 300 });
        doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(`Rs. ${Number(po.gstAmount).toFixed(2)}`, margin + 350, y + 9, { width: tableW - 360, align: 'right' });
        y += totalsH;
      }

      // Grand total row (highlighted)
      doc.rect(margin, y, tableW, totalsH + 4).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(11).font('Helvetica-Bold').text('GRAND TOTAL', margin + 12, y + 10, { width: 300 });
      doc.fillColor(WHITE).fontSize(12).font('Helvetica-Bold').text(`Rs. ${Number(po.grandTotal).toFixed(2)}`, margin + 350, y + 9, { width: tableW - 360, align: 'right' });
      y += totalsH + 4 + 15;

      // ── Approval signatures ──
      // Check if we need a new page
      if (y > pageHeight - 120) {
        doc.addPage({ margin: 50, size: 'A4' });
        y = 60;
      }

      doc.fillColor(PRIMARY).fontSize(10).font('Helvetica-Bold').text('Approval & Authorization', margin, y);
      y += 16;

      const approvedSteps = po.approvalWorkflow?.steps.filter((s) => s.status === 'APPROVED') ?? [];
      const sigW = (contentWidth - 20) / 3;
      const sigH = 55;

      for (let i = 0; i < 3; i++) {
        const sx = margin + i * (sigW + 10);
        doc.roundedRect(sx, y, sigW, sigH, 4).stroke(BORDER);
        const step = approvedSteps[i];
        doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text(`Approver ${i + 1}`, sx + 6, y + 5, { width: sigW - 12 });
        if (step) {
          doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text(step.approverUser?.name ?? '—', sx + 6, y + 18, { width: sigW - 12 });
          doc.fillColor(TEXT_MUTED).fontSize(6).font('Helvetica').text((step.approverUser?.role ?? '').replace(/_/g, ' '), sx + 6, y + 30, { width: sigW - 12 });
          doc.fillColor(GREEN).fontSize(7).font('Helvetica-Bold').text('APPROVED', sx + 6, y + 42, { width: sigW - 12 });
        } else {
          doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica-Oblique').text('Pending', sx + 6, y + 28, { width: sigW - 12 });
        }
      }

      // ── Footer ──
      y += sigH + 20;
      doc.moveTo(margin, y).lineTo(pageWidth - margin, y).stroke(PRIMARY);
      y += 6;
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text(
        `Generated on ${new Date(po.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}  |  Created by ${po.createdByUser?.name ?? '—'}`,
        margin, y, { width: contentWidth, align: 'center' }
      );

      doc.end();
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
          const head = await tx.budgetHead.findFirst({
            where: { id: po.budgetHeadId, projectId, deletedAt: null },
          });
          if (head) {
            await tx.budgetHead.update({
              where: { id: po.budgetHeadId },
              data: { committedAmount: Number(head.committedAmount) + commitmentAdjustment },
            });
          }
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

export default router;
