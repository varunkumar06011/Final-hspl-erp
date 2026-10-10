import { Router, Response, NextFunction } from 'express';
import { Permission, POStatus, POPaymentType, AuditAction, UserRole, GoodsReceiptStatus, isAdminRole, isFirstLevelApproverRole, FIRST_LEVEL_APPROVER_ROLES, VoucherType, GST_LEDGER_NAMES, VendorType, MPRStatus } from '@hospital-erp/shared';
import { createPOSchema, listPOsSchema, approvalActionSchema, editPOSchema, editUnapprovedPOSchema, regeneratePOSchema, changePOPaymentTypeSchema, createContractPOSchema, createSubPOSchema, updateContractTermsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { HEAD_THEN_ADMIN_POLICY, headThenAdminSteps } from '../services/approval.service';
import { notifyApprovers } from '../services/push.service';
import { streamPurchaseOrderPdf } from '../services/purchase-order-pdf.service';
import { ensureVendorLedger, findLedgerByName } from './ledger.routes';
import { postVoucher, generateVoucherNumber } from './voucher.routes';
import { getActiveAdminRoles, generatePONumber, createNonVendorPoFromMpr, findLivePoForMpr } from '../services/non-vendor-po.service';
import { reconcilePoAccrualSafe, hasPoAccrual, payableAfterDeductions } from '../services/po-accrual.service';

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

// PO approver roles now include all dynamic admin roles (ADMIN_3, ADMIN_4, ...)
// via isAdminRole(). The fixed array is kept for backward compatibility with
// approval workflow step creation.

function isPoApprover(role: string): boolean {
  return isAdminRole(role) || isFirstLevelApproverRole(role);
}

/** A contract PO has no items of its own — item-level edits belong on its sub-POs. */
const CONTRACT_PO_ITEM_EDIT_ERROR =
  'This is a contract PO: it has no items. Edit the contract terms, or edit the individual sub-PO.';

/**
 * Generate a regenerated PO number: VGH-REGPO{originalNum}/{regenSeq}
 * e.g. original VGH-PO004 → first regen VGH-REGPO004/1, second VGH-REGPO004/2
 */
async function generateRegeneratedPONumber(parentPo: { poNumber: string; id: string }): Promise<string> {
  // The leading project code (VGH, ABC, ...) is carried over from the parent PO.
  const originalMatch = parentPo.poNumber.match(/^([A-Z][A-Z0-9]*)-(?:REGPO(\d+)\/\d+|PO(\d+))$/);
  const projectCode = originalMatch ? originalMatch[1] : 'VGH';
  const originalNum = originalMatch ? (originalMatch[2] ?? originalMatch[3]) : '001';
  const childCount = await prisma.purchaseOrder.count({
    where: { parentPoId: parentPo.id },
  });
  return `${projectCode}-REGPO${originalNum}/${childCount + 1}`;
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
  if (fullyReceived) return POStatus.DELIVERED;
  const anyAccepted = poItems.some((item) => acceptedForPoItem(acc, item) > 0);
  return anyAccepted ? POStatus.PARTIALLY_DELIVERED : POStatus.APPROVED;
}

const poInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true, phone: true, address: true, contactPersonName: true, contactPersonPhone: true } },
  quotation: {
    select: {
      id: true,
      quotationNumber: true,
      date: true,
      createdAt: true,
      items: { select: { materialName: true, quantity: true, unit: true, unitPrice: true } },
      mpr: { select: { id: true, mprNumber: true, items: { select: { materialName: true, quantity: true, unit: true, estimatedRate: true } } } },
    },
  },
  mpr: { select: { id: true, mprNumber: true } },
  items: {
    include: {
      ledgerPosts: {
        include: {
          ledger: { select: { id: true, name: true } },
          journalVoucher: { select: { jvNumber: true } },
        },
      },
    },
  },
  createdByUser: { select: { id: true, name: true } },
  editedByUser: { select: { id: true, name: true } },
  parentPo: { select: { id: true, poNumber: true } },
  childPos: { select: { id: true, poNumber: true, regenerationNumber: true, status: true } },
  contractPo: { select: { id: true, poNumber: true, contractTitle: true, contractType: true } },
  subPos: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, poNumber: true, status: true, grandTotal: true, periodLabel: true, periodFrom: true, periodTo: true },
  },
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
      const { page, pageSize, vendorId, status, search, minAmount, maxAmount, dateFilter, kind } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      if (kind === 'contract') where.isContract = true;
      else if (kind === 'po') where.isContract = false;
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

      // Which of these POs already have their vendor payable booked to the ledger
      const accrualRows = data.length
        ? await prisma.journalVoucher.findMany({
            where: { sourcePoId: { in: data.map((po) => po.id) }, deletedAt: null },
            select: { sourcePoId: true },
          })
        : [];
      const bookedPoIds = new Set(accrualRows.map((r) => r.sourcePoId));

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
          payableBooked: bookedPoIds.has(po.id),
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
      res.json({ ...record, payableBooked: await hasPoAccrual(record.id) });
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
          // Receipts raised straight against the PO (no gate pass)
          goodsReceipts: {
            where: { deletedAt: null, gatePassId: null },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              receiptNumber: true,
              status: true,
              createdAt: true,
              inspectedAt: true,
              postedAt: true,
              items: { select: { materialName: true, deliveredQty: true, acceptedQty: true, rejectedQty: true, rejectionReason: true } },
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
      const deliveries: Record<string, any>[] = po.gatePasses.map((gp) => ({
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

      // Receipts with no gate pass appear as deliveries without a gate pass.
      for (const gr of po.goodsReceipts) {
        deliveries.push({
          gatePassId: null,
          passNumber: null,
          gatePassStatus: null,
          gatePassDate: gr.createdAt,
          approvedDate: null,
          items: gr.items.map((gri) => ({ materialName: gri.materialName, deliveredQty: Number(gri.deliveredQty), unit: null })),
          goodsReceipts: [
            {
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
            },
          ],
        });
      }

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
      const { vendorId, quotationId, mprId, paymentType, paymentTerms, deliveryDate, budgetHeadId, advanceAmount, deductions, notes, referredBy } = req.body;

      const orderVendor = await prisma.vendor.findFirst({ where: { id: vendorId, projectId }, select: { vendorType: true } });
      if (!orderVendor) {
        res.status(400).json({ error: 'Vendor not found' });
        return;
      }

      // NON_VENDOR suppliers have no quotation: the PO is raised straight from
      // the approved Material Purchase Request with amount 0, and the amounts
      // are filled in by editing the PO afterwards.
      if (orderVendor.vendorType === VendorType.NON_VENDOR) {
        if (!mprId) {
          res.status(400).json({ error: 'Select the approved material request for this non-vendor purchase order' });
          return;
        }
        const mpr = await prisma.materialPurchaseRequest.findFirst({
          where: { id: mprId, projectId, deletedAt: null },
          select: { status: true, vendorId: true },
        });
        if (!mpr) {
          res.status(400).json({ error: 'Material Purchase Request not found' });
          return;
        }
        if (mpr.status !== MPRStatus.APPROVED) {
          res.status(400).json({ error: 'The Material Purchase Request must be approved before a purchase order can be raised' });
          return;
        }
        if (mpr.vendorId !== vendorId) {
          res.status(400).json({ error: 'Vendor does not match the vendor on the Material Purchase Request' });
          return;
        }
        const existingMprPo = await findLivePoForMpr(mprId);
        if (existingMprPo) {
          res.status(400).json({ error: `Purchase Order ${existingMprPo.poNumber} already exists for this request` });
          return;
        }
        const created = await createNonVendorPoFromMpr(mprId, projectId, req.user!.id);
        const nonVendorPo = created && await prisma.purchaseOrder.findUnique({ where: { id: created.id }, include: poInclude });
        res.status(201).json(nonVendorPo);
        return;
      }

      if (!quotationId) {
        res.status(400).json({ error: 'An approved quotation is required' });
        return;
      }
      // The budget head is optional here: it can be set later (change-budget-head).
      if (budgetHeadId) {
        const head = await prisma.budgetHead.findFirst({ where: { id: budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
        if (!head) {
          res.status(400).json({ error: 'Budget head not found' });
          return;
        }
      }

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

      // One live PO per quotation — after a re-edit/resend the quotation may
      // become APPROVED again while an earlier PO still references it; a
      // second conversion would create a duplicate PO for the same document.
      const existingPo = await prisma.purchaseOrder.findFirst({
        where: {
          quotationId: quotation.id,
          deletedAt: null,
          status: { notIn: ['DELETED', 'CANCELLED', 'REJECTED'] },
        },
        select: { poNumber: true },
      });
      if (existingPo) {
        res.status(400).json({ error: `Purchase Order ${existingPo.poNumber} already exists for this quotation` });
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
      const adminRoles = await getActiveAdminRoles(projectId);
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
            referredBy: typeof referredBy === 'string' && referredBy.trim() ? referredBy.trim() : null,
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
            approvalPolicy: HEAD_THEN_ADMIN_POLICY,
            steps: {
              create: headThenAdminSteps(adminRoles),
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

      // Notify all approvers via push notification (heads + dynamic admin roles)
      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: workflow.id,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'New Approval Required',
        body: `Purchase Order ${poNumber} — ₹${grandTotal}`,
        url: `/pos?id=${po.id}`,
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

// ═══════════════════════════════════════════════════════════════════════════
// Contract POs: one umbrella PO (approved once) + a sub-PO per billing period.
// A sub-PO is an ordinary PO row (contractPoId -> contract), so approval, goods
// receipt / service sign-off, invoice, payment, budget commitment and the vendor
// payable all work on it exactly as on any PO. The contract itself carries no
// items or amount (grandTotal 0) so nothing is double-counted.
// ═══════════════════════════════════════════════════════════════════════════

const DEAD_PO_STATUSES: string[] = [POStatus.DELETED, POStatus.REJECTED, POStatus.CANCELLED];
const COMMITTED_PO_STATUSES: string[] = [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED];

// POST /contracts — raise a contract PO (goes through the normal PO approval)
router.post(
  '/contracts',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(createContractPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { vendorId, contractTitle, contractType, estimatedValue, contractStart, contractEnd, budgetHeadId, paymentTerms, notes, referredBy } = req.body;

      const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, projectId, deletedAt: null }, select: { id: true } });
      if (!vendor) {
        res.status(400).json({ error: 'Vendor not found' });
        return;
      }
      if (budgetHeadId) {
        const head = await prisma.budgetHead.findFirst({ where: { id: budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
        if (!head) {
          res.status(400).json({ error: 'Budget head not found' });
          return;
        }
      }
      if (contractStart && contractEnd && new Date(contractEnd) < new Date(contractStart)) {
        res.status(400).json({ error: 'Contract end date cannot be before the start date' });
        return;
      }

      const poNumber = await generatePONumber(projectId);
      const adminRoles = await getActiveAdminRoles(projectId);
      const { po, workflow } = await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.create({
          data: {
            projectId,
            vendorId,
            poNumber,
            status: POStatus.PENDING_APPROVAL,
            paymentType: POPaymentType.AFTER_DELIVERY,
            paymentTerms: paymentTerms ?? null,
            notes: notes ?? null,
            referredBy: typeof referredBy === 'string' && referredBy.trim() ? referredBy.trim() : null,
            budgetHeadId: budgetHeadId ?? null,
            createdBy: req.user!.id,
            isContract: true,
            contractTitle,
            contractType: contractType || null,
            estimatedValue: estimatedValue === undefined ? null : estimatedValue,
            contractStart: contractStart ? new Date(contractStart) : null,
            contractEnd: contractEnd ? new Date(contractEnd) : null,
          },
        });
        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PURCHASE_ORDER',
            entityId: po.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: 1,
            approvalPolicy: HEAD_THEN_ADMIN_POLICY,
            steps: { create: headThenAdminSteps(adminRoles) },
          },
          include: { steps: true },
        });
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { approvalWorkflowId: workflow.id } });
        return { po, workflow };
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: { poNumber, vendorId, isContract: true, contractTitle, contractType, estimatedValue, acknowledged: true },
      });

      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: workflow.id,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'New Contract — Approval Required',
        body: `Contract ${poNumber} — ${contractTitle}`,
        url: `/pos?id=${po.id}`,
      }).catch((err) => console.error('[Push] Contract PO notification error:', err));

      res.status(201).json(await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: poInclude }));
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/sub-pos — raise the sub-PO for one billing period of an approved contract.
// Same vendor/budget as the contract, amounts entered per period (no cap), own approval.
router.post(
  '/:id/sub-pos',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(createSubPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const contract = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null, isContract: true },
      });
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      if (contract.status !== POStatus.APPROVED) {
        res.status(400).json({ error: 'Sub-POs can only be raised against an approved contract' });
        return;
      }
      if (contract.contractClosedAt) {
        res.status(400).json({ error: 'This contract is closed. Reopen it to raise more sub-POs' });
        return;
      }

      const { periodLabel, periodFrom, periodTo, paymentType, advanceAmount, paymentTerms, notes, items, deductions } = req.body;
      if (periodFrom && periodTo && new Date(periodTo) < new Date(periodFrom)) {
        res.status(400).json({ error: 'Period end cannot be before the period start' });
        return;
      }

      const budgetHeadId: string | null = req.body.budgetHeadId ?? contract.budgetHeadId ?? null;
      if (!budgetHeadId) {
        res.status(400).json({ error: 'Budget head is required' });
        return;
      }
      const head = await prisma.budgetHead.findFirst({ where: { id: budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
      if (!head) {
        res.status(400).json({ error: 'Budget head not found' });
        return;
      }

      const lines = items as { materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[];
      const totalAmount = lines.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const gstAmount = lines.reduce((s, i) => s + (i.quantity * i.unitPrice * i.gstRate) / 100, 0);
      const grandTotal = totalAmount + gstAmount;

      const deductionRows: { amount: number; reason: string }[] = Array.isArray(deductions) ? deductions : [];
      const totalDeductions = deductionRows.reduce((s, d) => s + Number(d.amount), 0);
      if (totalDeductions > grandTotal) {
        res.status(400).json({ error: `Total deductions (${totalDeductions}) cannot exceed the sub-PO grand total (${grandTotal})` });
        return;
      }

      let resolvedAdvanceAmount: number | null = null;
      if (paymentType === POPaymentType.ADVANCE || paymentType === POPaymentType.FULL_PAYMENT) {
        const amt = Number(advanceAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          res.status(400).json({ error: 'Advance amount is required for advance / full payment' });
          return;
        }
        if (amt > grandTotal) {
          res.status(400).json({ error: `Advance amount cannot exceed the sub-PO grand total of ${grandTotal}` });
          return;
        }
        resolvedAdvanceAmount = amt;
      }

      const adminRoles = await getActiveAdminRoles(projectId);
      // Numbered <contract>-SUB01, -SUB02 ... (deleted ones keep their number); retry if two are raised at once.
      const existingCount = await prisma.purchaseOrder.count({ where: { contractPoId: contract.id } });
      let created: { id: string; poNumber: string; approvalWorkflowId: string | null } | null = null;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const poNumber = `${contract.poNumber}-SUB${String(existingCount + 1 + attempt).padStart(2, '0')}`;
        try {
          created = await prisma.$transaction(async (tx) => {
            const sub = await tx.purchaseOrder.create({
              data: {
                projectId,
                vendorId: contract.vendorId,
                poNumber,
                status: POStatus.PENDING_APPROVAL,
                paymentType,
                advanceAmount: resolvedAdvanceAmount,
                paymentTerms: paymentTerms ?? contract.paymentTerms ?? null,
                notes: notes ?? null,
                referredBy: contract.referredBy,
                totalAmount,
                gstAmount,
                grandTotal,
                deductions: deductionRows.length > 0 ? deductionRows : Prisma.JsonNull,
                totalDeductions,
                netPayable: grandTotal - totalDeductions,
                budgetHeadId,
                phaseId: contract.phaseId,
                createdBy: req.user!.id,
                contractPoId: contract.id,
                contractType: contract.contractType,
                periodLabel,
                periodFrom: periodFrom ? new Date(periodFrom) : null,
                periodTo: periodTo ? new Date(periodTo) : null,
                items: {
                  create: lines.map((i) => ({
                    materialName: i.materialName,
                    quantity: i.quantity,
                    unit: i.unit,
                    unitPrice: i.unitPrice,
                    amount: i.quantity * i.unitPrice,
                    gstRate: i.gstRate,
                  })),
                },
              },
            });
            const workflow = await tx.approvalWorkflow.create({
              data: {
                entityType: 'PURCHASE_ORDER',
                entityId: sub.id,
                projectId,
                status: 'VERIFICATION',
                currentStep: 0,
                minApprovers: 1,
                approvalPolicy: HEAD_THEN_ADMIN_POLICY,
                steps: { create: headThenAdminSteps(adminRoles) },
              },
            });
            await tx.purchaseOrder.update({ where: { id: sub.id }, data: { approvalWorkflowId: workflow.id } });
            return { id: sub.id, poNumber, approvalWorkflowId: workflow.id };
          });
        } catch (err) {
          const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
          if (!duplicate) throw err;
        }
      }
      if (!created) {
        res.status(409).json({ error: 'Could not allocate a sub-PO number, please try again' });
        return;
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: created.id,
        projectId,
        newValue: { poNumber: created.poNumber, contractPoId: contract.id, contractPoNumber: contract.poNumber, periodLabel, totalAmount, grandTotal, paymentType, acknowledged: true },
      });

      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: created.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: created.id,
        title: 'New Approval Required',
        body: `Sub-PO ${created.poNumber} (${contract.poNumber}) — ₹${grandTotal}`,
        url: `/pos?id=${created.id}`,
      }).catch((err) => console.error('[Push] Sub-PO notification error:', err));

      res.status(201).json(await prisma.purchaseOrder.findUnique({ where: { id: created.id }, include: poInclude }));
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id/contract-terms — edit the contract's own terms any time (estimate, dates, title,
// close / reopen). No re-approval: the estimate is indicative, each sub-PO is approved separately.
router.patch(
  '/:id/contract-terms',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(updateContractTermsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const contract = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null, isContract: true },
      });
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }
      if (contract.status === POStatus.DELETED) {
        res.status(400).json({ error: 'Cannot edit a deleted contract' });
        return;
      }

      const b = req.body;
      if (b.budgetHeadId) {
        const head = await prisma.budgetHead.findFirst({ where: { id: b.budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
        if (!head) {
          res.status(400).json({ error: 'Budget head not found' });
          return;
        }
      }
      const start = b.contractStart !== undefined ? b.contractStart : contract.contractStart;
      const end = b.contractEnd !== undefined ? b.contractEnd : contract.contractEnd;
      if (start && end && new Date(end) < new Date(start)) {
        res.status(400).json({ error: 'Contract end date cannot be before the start date' });
        return;
      }

      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {};
      if (b.contractTitle !== undefined) data.contractTitle = b.contractTitle;
      if (b.contractType !== undefined) data.contractType = b.contractType || null;
      if (b.estimatedValue !== undefined) data.estimatedValue = b.estimatedValue;
      if (b.contractStart !== undefined) data.contractStart = b.contractStart;
      if (b.contractEnd !== undefined) data.contractEnd = b.contractEnd;
      if (b.budgetHeadId !== undefined) data.budgetHeadId = b.budgetHeadId;
      if (b.paymentTerms !== undefined) data.paymentTerms = b.paymentTerms || null;
      if (b.notes !== undefined) data.notes = b.notes || null;
      if (b.closed !== undefined) data.contractClosedAt = b.closed ? (contract.contractClosedAt ?? new Date()) : null;
      if (Object.keys(data).length === 0) {
        res.status(400).json({ error: 'Nothing to update' });
        return;
      }

      const updated = await prisma.purchaseOrder.update({ where: { id: contract.id }, data, include: poInclude });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: contract.id,
        projectId,
        oldValue: {
          contractTitle: contract.contractTitle,
          contractType: contract.contractType,
          estimatedValue: contract.estimatedValue === null ? null : Number(contract.estimatedValue),
          contractStart: contract.contractStart,
          contractEnd: contract.contractEnd,
          closed: !!contract.contractClosedAt,
        },
        newValue: { ...b },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/contract-summary — live totals for a contract: what has been raised, approved,
// paid and what is still to pay, with the sub-PO list. The estimate is shown for reference only.
router.get(
  '/:id/contract-summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const contract = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null, isContract: true },
        include: { vendor: { select: { id: true, name: true, vendorCode: true } } },
      });
      if (!contract) {
        res.status(404).json({ error: 'Contract not found' });
        return;
      }

      const subs = await prisma.purchaseOrder.findMany({
        where: { contractPoId: contract.id, projectId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          poNumber: true,
          status: true,
          paymentType: true,
          grandTotal: true,
          totalDeductions: true,
          periodLabel: true,
          periodFrom: true,
          periodTo: true,
          date: true,
        },
      });
      const ids = subs.map((s) => s.id);
      const payments = ids.length
        ? await prisma.payment.findMany({
            where: {
              status: 'PAID',
              paymentRequest: { deletedAt: null, OR: [{ poId: { in: ids } }, { invoice: { poId: { in: ids } } }] },
            },
            select: { amount: true, paymentRequest: { select: { poId: true, invoice: { select: { poId: true } } } } },
          })
        : [];
      const paidBySub = new Map<string, number>();
      for (const p of payments) {
        const subId = p.paymentRequest?.poId ?? p.paymentRequest?.invoice?.poId;
        if (subId) paidBySub.set(subId, (paidBySub.get(subId) ?? 0) + Number(p.amount));
      }

      const rows = subs.map((s) => {
        const grandTotal = Number(s.grandTotal);
        const payable = payableAfterDeductions(grandTotal, Number(s.totalDeductions ?? 0));
        const paid = paidBySub.get(s.id) ?? 0;
        const committed = COMMITTED_PO_STATUSES.includes(s.status);
        return {
          id: s.id,
          poNumber: s.poNumber,
          status: s.status,
          paymentType: s.paymentType,
          periodLabel: s.periodLabel,
          periodFrom: s.periodFrom,
          periodTo: s.periodTo,
          date: s.date,
          grandTotal,
          netPayable: payable,
          paid,
          outstanding: committed ? Math.max(0, payable - paid) : 0,
        };
      });

      const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => number) => list.reduce((a, r) => a + pick(r), 0);
      const approved = rows.filter((r) => COMMITTED_PO_STATUSES.includes(r.status));
      const pending = rows.filter((r) => r.status === POStatus.PENDING_APPROVAL);
      const approvedValue = sum(approved, (r) => r.grandTotal);
      const pendingValue = sum(pending, (r) => r.grandTotal);
      const estimatedValue = contract.estimatedValue === null ? null : Number(contract.estimatedValue);
      const raisedValue = approvedValue + pendingValue;

      res.json({
        contract: {
          id: contract.id,
          poNumber: contract.poNumber,
          status: contract.status,
          contractTitle: contract.contractTitle,
          contractType: contract.contractType,
          estimatedValue,
          contractStart: contract.contractStart,
          contractEnd: contract.contractEnd,
          contractClosedAt: contract.contractClosedAt,
          vendor: contract.vendor,
        },
        totals: {
          subPoCount: rows.filter((r) => !DEAD_PO_STATUSES.includes(r.status)).length,
          approvedValue,
          pendingValue,
          paid: sum(rows, (r) => r.paid),
          outstanding: sum(rows, (r) => r.outstanding),
          estimatedValue,
          remainingVsEstimate: estimatedValue === null ? null : estimatedValue - raisedValue,
          exceedsEstimate: estimatedValue !== null && raisedValue > estimatedValue,
        },
        subPos: rows,
      });
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

      // Only notes/description and Referred By can be edited — allowed for ALL other statuses
      const data: Record<string, unknown> = {};
      if (req.body.notes !== undefined) data.notes = req.body.notes || null;
      if (req.body.referredBy !== undefined) {
        data.referredBy = typeof req.body.referredBy === 'string' && req.body.referredBy.trim() ? req.body.referredBy.trim() : null;
      }
      if (Object.keys(data).length === 0) {
        res.status(400).json({ error: 'Only description/notes and Referred By can be updated' });
        return;
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data,
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
      const isAdmin = isAdminRole(req.user!.role);
      // A contract that still has live sub-POs cannot be deactivated: they would be orphaned.
      if (existing.isContract) {
        const liveSubPos = await prisma.purchaseOrder.count({
          where: {
            contractPoId: existing.id,
            deletedAt: null,
            status: { notIn: [POStatus.DELETED, POStatus.REJECTED, POStatus.CANCELLED] },
          },
        });
        if (liveSubPos > 0) {
          res.status(400).json({ error: `This contract has ${liveSubPos} active sub-PO(s). Deactivate them first.` });
          return;
        }
      }
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

      // Deactivating reverses the vendor payable booked at approval. If items were
      // also moved to expense ledgers, those postings sit on top of it and must be
      // cancelled first (Vouchers page) — otherwise the books end up half-reversed.
      if (await hasPoAccrual(existing.id)) {
        const itemPost = await prisma.pOItemLedgerPost.findFirst({
          where: { poItem: { poId: existing.id } },
          select: { id: true },
        });
        if (itemPost) {
          res.status(400).json({
            error: 'Items of this PO were posted to expense ledgers. Cancel those vouchers first, then deactivate the PO.',
          });
          return;
        }
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

      // Reverse the vendor payable booked at approval (no-op if none was booked).
      await reconcilePoAccrualSafe(existing.id, req.user!.id);

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
      if (!isPoApprover(req.user!.role) && !approvalService.canOverride(req.user!)) {
        res.status(403).json({ error: 'Only Project Head, Head of Construction or Admin can approve purchase orders' });
        return;
      }

      // Find the step for this user's role
      const step = approvalService.findApprovableStep(po.approvalWorkflow.steps, req.user!);
      if (!step) {
        res.status(400).json({ error: 'No pending approval step for your role, or you may have already approved' });
        return;
      }

      // Check same person hasn't already approved
      const alreadyApproved = po.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved && !approvalService.canOverride(req.user!)) {
        res.status(400).json({ error: 'You have already approved this purchase order' });
        return;
      }

      // The only thing that stops an approval is a missing amount. Budget head,
      // description and payment type can be filled in any time (no re-approval).
      // Contract POs carry no amount of their own, so they are never blocked.
      if (!po.isContract && Number(po.grandTotal) <= 0) {
        res.status(400).json({ error: 'Enter the item prices on this purchase order (Edit) before approving it — the amount is 0', code: 'PO_AMOUNT_MISSING' });
        return;
      }

      // ── Budget overrun check: warn but allow approval with override reason ──
      // If committing this PO's grand total would exceed the budget head's allocated
      // amount, require a non-empty comment (override reason) from the approver.
      // An edited PO's commitment was already booked at edit time, so for it the
      // head's committed amount already includes this PO (nothing more is added).
      if (po.budgetHeadId) {
        const head = await prisma.budgetHead.findFirst({
          where: { id: po.budgetHeadId, projectId, deletedAt: null },
          select: { allocatedAmount: true, committedAmount: true, particulars: true },
        });
        if (head) {
          const projectedCommitted = Number(head.committedAmount) + (po.editedAt ? 0 : Number(po.grandTotal));
          if (projectedCommitted > Number(head.allocatedAmount)) {
            if (!req.body.comments || req.body.comments.trim().length === 0) {
              res.status(400).json({
                error: `Budget overrun: approving this PO will push budget head "${head.particulars}" committed amount to ${projectedCommitted}, exceeding the allocated ${Number(head.allocatedAmount)}. Provide an override reason in the comments to proceed.`,
                code: 'BUDGET_OVERRUN',
                budget: {
                  budgetHead: head.particulars,
                  allocated: Number(head.allocatedAmount),
                  committed: Number(head.committedAmount),
                  afterApproval: projectedCommitted,
                },
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

        // ── Accounting: we now owe the vendor — Dr Purchase / Cr Vendor ledger ──
        // For an edited PO this posts only the difference vs. what is already booked.
        await reconcilePoAccrualSafe(po.id, req.user!.id);
      }

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

      if (!isPoApprover(req.user!.role) && !approvalService.canOverride(req.user!)) {
        res.status(403).json({ error: 'Only Project Head, Head of Construction or Admin can reject purchase orders' });
        return;
      }

      const step = approvalService.findApprovableStep(po.approvalWorkflow.steps, req.user!);
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

        // A previously approved PO that is rejected on re-approval no longer
        // counts as owed — reverse its vendor payable (no-op if never booked).
        await reconcilePoAccrualSafe(po.id, req.user!.id);
      }

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

// POST /:id/resubmit — send a REJECTED PO back for approval without editing it.
// Resets the approval workflow to fresh pending steps and flips the PO to
// PENDING_APPROVAL. Use edit-unapproved instead if the content must change.
router.post(
  '/:id/resubmit',
  rbacMiddleware(Permission.CREATE_PO),
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
      if (po.status !== POStatus.REJECTED) {
        res.status(400).json({ error: 'Only rejected purchase orders can be resubmitted for approval' });
        return;
      }

      const adminRoles = await getActiveAdminRoles(projectId);
      await prisma.$transaction(async (tx) => {
        // Rejecting an edited PO reversed its commitment (see /reject). Its
        // re-approval skips the commitment step, so restore it here.
        if (po.budgetHeadId && po.editedAt) {
          const paymentsAgg = await tx.payment.aggregate({
            where: { budgetHeadId: po.budgetHeadId, paymentRequest: { poId: po.id, deletedAt: null } },
            _sum: { amount: true },
          });
          const remainingCommitment = Number(po.grandTotal) - (Number(paymentsAgg._sum.amount) || 0);
          if (remainingCommitment > 0) {
            await tx.budgetHead.update({
              where: { id: po.budgetHeadId },
              data: { committedAmount: { increment: remainingCommitment } },
            });
          }
        }

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: POStatus.PENDING_APPROVAL },
        });

        if (po.approvalWorkflowId) {
          await tx.approvalStep.deleteMany({ where: { workflowId: po.approvalWorkflowId } });
          await tx.approvalWorkflow.update({
            where: { id: po.approvalWorkflowId },
            data: {
              status: 'VERIFICATION',
              currentStep: 0,
              approvalPolicy: HEAD_THEN_ADMIN_POLICY,
              steps: {
                create: headThenAdminSteps(adminRoles),
              },
            },
          });
        }
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue: { status: POStatus.REJECTED },
        newValue: { status: POStatus.PENDING_APPROVAL, resubmitted: true },
      });

      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Resubmitted — Approval Required',
        body: `${po.poNumber} was resubmitted for approval`,
        url: `/pos?id=${po.id}`,
      }).catch((err) => console.error('[Push] PO resubmit notification error:', err));

      const updated = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: poInclude });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

const PDF_ALLOWED_STATUSES: POStatus[] = [
  POStatus.APPROVED,
  POStatus.DELIVERED,
  POStatus.PARTIALLY_DELIVERED,
];

// GET /:id/pdf — generate and download PDF (approved POs only)
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

      // The PO document is only issued once it has been approved.
      if (!PDF_ALLOWED_STATUSES.includes(po.status as POStatus)) {
        res.status(409).json({
          error: 'PO PDF can be downloaded only after the PO is approved',
          code: 'PO_NOT_APPROVED',
        });
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
      if (po.isContract) {
        res.status(400).json({ error: CONTRACT_PO_ITEM_EDIT_ERROR });
        return;
      }
      const isApprovedPo = po.status === POStatus.APPROVED;
      if (po.status !== POStatus.PENDING_APPROVAL && po.status !== POStatus.REJECTED && !isApprovedPo) {
        res.status(400).json({ error: 'Only pending, rejected, or approved POs can be edited' });
        return;
      }
      // Editing an already-approved PO is an admin-only action; the PO returns
      // to PENDING_APPROVAL and must pass the approval workflow again.
      if (isApprovedPo && !isAdminRole(req.user!.role)) {
        res.status(403).json({ error: 'Only an admin can edit an approved purchase order' });
        return;
      }
      const { paymentTerms, deliveryDate, items: newItems, deductions, notes, referredBy } = req.body;
      // The budget head is optional: omitted keeps the PO's current one (which may be none).
      const budgetHeadId: string | null = req.body.budgetHeadId ?? po.budgetHeadId ?? null;

      // Validate budget head exists and belongs to project
      if (budgetHeadId) {
        const budgetHead = await prisma.budgetHead.findFirst({
          where: { id: budgetHeadId, projectId, deletedAt: null },
        });
        if (!budgetHead) {
          res.status(400).json({ error: 'Budget head not found' });
          return;
        }
      }

      // Recalculate amounts from new items
      const totalAmount = newItems.reduce((sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice, 0);
      const gstAmount = newItems.reduce((sum: number, i: { quantity: number; unitPrice: number; gstRate: number }) => sum + (i.quantity * i.unitPrice) * i.gstRate / 100, 0);
      const grandTotal = totalAmount + gstAmount;

      // ── Compute deductions ──
      // When the request omits deductions entirely, keep the PO's existing
      // deductions rather than silently clearing them.
      const deductionRows: { amount: number; reason: string }[] =
        deductions === undefined
          ? (Array.isArray(po.deductions) ? (po.deductions as { amount: number; reason: string }[]) : [])
          : (Array.isArray(deductions) ? deductions : []);
      const totalDeductions = deductionRows.reduce((sum, d) => sum + Number(d.amount), 0);
      if (totalDeductions > grandTotal) {
        res.status(400).json({ error: `Total deductions (${totalDeductions}) cannot exceed PO grand total (${grandTotal})` });
        return;
      }
      const netPayable = grandTotal - totalDeductions;

      // Payment type is editable here (keeps existing value when omitted).
      // ADVANCE / FULL_PAYMENT need an agreed advance amount ≤ grandTotal;
      // AFTER_DELIVERY carries none.
      const newPaymentType: string = req.body.paymentType ?? po.paymentType;
      let newAdvanceAmount: number | null;
      if (newPaymentType === POPaymentType.ADVANCE || newPaymentType === POPaymentType.FULL_PAYMENT) {
        // Full payment follows the edited total unless an amount is given.
        const amt = Number(req.body.advanceAmount ?? (newPaymentType === POPaymentType.FULL_PAYMENT ? grandTotal : po.advanceAmount ?? 0));
        if (!Number.isFinite(amt) || amt <= 0) {
          res.status(400).json({ error: 'Advance amount is required for advance / full payment POs' });
          return;
        }
        if (amt > grandTotal) {
          res.status(400).json({ error: `Advance amount (${amt}) cannot exceed the edited grand total (${grandTotal})` });
          return;
        }
        newAdvanceAmount = amt;
      } else {
        newAdvanceAmount = null;
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

      const adminRoles = await getActiveAdminRoles(projectId);
      const result = await prisma.$transaction(async (tx) => {
        // Adjust budget head commitment if budget head or total changed. After this
        // edit the PO counts as committed (editedAt set, approval adds nothing), so a
        // PO that had committed nothing yet (never approved, never edited) books its
        // full total now instead of a delta.
        const committedBefore = po.status === POStatus.APPROVED || (po.status === POStatus.PENDING_APPROVAL && !!po.editedAt);
        if (!budgetHeadId) {
          // PO stays without a budget head
        } else if (!committedBefore) {
          await tx.budgetHead.update({
            where: { id: budgetHeadId },
            data: { committedAmount: { increment: grandTotal } },
          });
        } else if (po.budgetHeadId && po.budgetHeadId !== budgetHeadId) {
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
            paymentType: newPaymentType,
            advanceAmount: newAdvanceAmount,
            paymentTerms: paymentTerms ?? null,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            notes: notes === undefined ? po.notes : (notes || null),
            referredBy: referredBy === undefined ? po.referredBy : (typeof referredBy === 'string' && referredBy.trim() ? referredBy.trim() : null),
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
              approvalPolicy: HEAD_THEN_ADMIN_POLICY,
              steps: {
                create: headThenAdminSteps(adminRoles),
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
        newValue: { paymentTerms, deliveryDate, budgetHeadId, items: newItems, notes, totalAmount, gstAmount, grandTotal },
      });

      // Notify approvers
      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Edited — Re-approval Required',
        body: `${po.poNumber} was edited and needs re-approval`,
        url: `/pos?id=${po.id}`,
      }).catch((err) => console.error('[Push] PO edit notification error:', err));

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

// POST /:id/change-payment-type — set or change the payment type on a PO that is
// waiting for approval or already approved. NO re-approval: the type only drives
// how advances / invoices are paid, and it is recorded in the audit log.
router.post(
  '/:id/change-payment-type',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(changePOPaymentTypeSchema),
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
      if (![POStatus.PENDING_APPROVAL, POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED].includes(po.status as POStatus)) {
        res.status(400).json({ error: 'The payment type can only be changed on pending, approved or delivered POs' });
        return;
      }
      const { paymentType, advanceAmount, reason } = req.body;
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

      // Only the payment fields change; status, approval and commitment stay as they are.
      // (editedAt is deliberately NOT touched: it would make a later approval skip the
      // budget commitment.)
      const updated = await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          paymentType,
          advanceAmount: resolvedAdvanceAmount,
          editReason: reason ?? null,
          editedBy: req.user!.id,
        },
        include: poInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        oldValue,
        newValue: { paymentType, advanceAmount: resolvedAdvanceAmount, reason, noReapproval: true },
      });

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

      // Validate: each submitted item's quantity must be >= accepted qty for that material.
      // Items are matched to the original PO line by poItemId when provided (allows
      // material-name edits), falling back to name matching for older payloads.
      const newItems = req.body.items as { poItemId?: string; materialName: string; quantity: number; unit: string; unitPrice: number; gstRate: number }[];
      const matchOrig = (i: { poItemId?: string; materialName: string }) =>
        i.poItemId
          ? po.items.find((o) => o.id === i.poItemId)
          : po.items.find((o) => o.materialName === i.materialName);
      for (const item of newItems) {
        const orig = matchOrig(item);
        const accepted = orig ? acceptedForPoItem(acceptedMap, orig) : 0;
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
        const editedItem = newItems.find((i) => (i.poItemId ? i.poItemId === origItem.id : i.materialName === origItem.materialName));

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

      // Items being removed must not carry goods-receipt history — those rows
      // hold GoodsReceiptItem.poItemId references that a delete would orphan.
      const removedOrig = po.items.filter((o) => !newItems.some((i) => (i.poItemId ? i.poItemId === o.id : i.materialName === o.materialName)));
      if (removedOrig.length > 0) {
        const linkedCount = await prisma.goodsReceiptItem.count({ where: { poItemId: { in: removedOrig.map((r) => r.id) } } });
        if (linkedCount > 0) {
          const names = removedOrig.map((r) => r.materialName).join(', ');
          res.status(400).json({ error: `Cannot remove item(s) with delivery records: ${names}` });
          return;
        }
      }

      const adminRoles = await getActiveAdminRoles(projectId);
      const result = await prisma.$transaction(async (tx) => {
        // Update existing lines in place (keeps POItem ids stable so linked
        // GoodsReceiptItem rows stay attached), create only genuinely new
        // lines, and delete deselected ones that passed the guard above.
        const keptIds = new Set<string>();
        for (const i of newItems) {
          const orig = matchOrig(i);
          if (orig) {
            keptIds.add(orig.id);
            await tx.pOItem.update({
              where: { id: orig.id },
              data: {
                materialName: i.materialName,
                quantity: i.quantity,
                unit: i.unit,
                unitPrice: i.unitPrice,
                amount: i.quantity * i.unitPrice,
                gstRate: i.gstRate,
              },
            });
          } else {
            await tx.pOItem.create({
              data: {
                poId: po.id,
                materialName: i.materialName,
                quantity: i.quantity,
                unit: i.unit,
                unitPrice: i.unitPrice,
                amount: i.quantity * i.unitPrice,
                gstRate: i.gstRate,
              },
            });
          }
        }
        const deleteIds = po.items.filter((o) => !keptIds.has(o.id)).map((o) => o.id);
        if (deleteIds.length > 0) {
          await tx.pOItem.deleteMany({ where: { id: { in: deleteIds } } });
        }

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
              approvalPolicy: HEAD_THEN_ADMIN_POLICY,
              steps: {
                create: headThenAdminSteps(adminRoles),
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
      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: po.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        title: 'PO Edited — Re-approval Required',
        body: `${po.poNumber} was edited and needs re-approval`,
        url: `/pos?id=${po.id}`,
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

      const adminRoles = await getActiveAdminRoles(projectId);
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
            referredBy: po.referredBy,
            createdBy: req.user!.id,
            parentPoId: po.id,
            regenerationNumber: 1,
            contractPoId: po.contractPoId,
            periodLabel: po.periodLabel,
            periodFrom: po.periodFrom,
            periodTo: po.periodTo,
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
            approvalPolicy: HEAD_THEN_ADMIN_POLICY,
            steps: {
              create: headThenAdminSteps(adminRoles),
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
      notifyApprovers(projectId, [...FIRST_LEVEL_APPROVER_ROLES] as UserRole[], {
        approvalId: result!.approvalWorkflowId ?? '',
        entityType: 'PURCHASE_ORDER',
        entityId: result!.id,
        title: 'Regenerated PO — Approval Required',
        body: `${regenNumber} (from ${po.poNumber}) needs approval`,
        url: `/pos?id=${result!.id}`,
      }).catch((err) => console.error('[Push] Regen PO notification error:', err));

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/change-budget-head — assign or change the budget head of a PO.
// Pending / rejected POs just take the new head. Approved (or partially delivered /
// delivered) POs move the committed and actual amounts from the old budget head to
// the new one atomically, or — when no head was set yet — commit the PO to the new
// head. NO re-approval in either case.
router.post(
  '/:id/change-budget-head',
  rbacMiddleware(Permission.CREATE_PO),
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

      const isCommitted = [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED].includes(po.status as POStatus);
      if (!isCommitted && po.status !== POStatus.PENDING_APPROVAL && po.status !== POStatus.REJECTED) {
        res.status(400).json({ error: 'The budget head cannot be changed on this purchase order' });
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

      // Not committed yet (waiting for approval): the head is just recorded; the
      // commitment is added when the PO is approved.
      // An edited PO is the exception: its commitment was booked at edit time
      // (approval then skips it), so the commitment moves with the head.
      if (!isCommitted) {
        const tagged = await prisma.$transaction(async (tx) => {
          if (po.editedAt && po.status === POStatus.PENDING_APPROVAL) {
            if (po.budgetHeadId) {
              await tx.budgetHead.update({ where: { id: po.budgetHeadId }, data: { committedAmount: { decrement: Number(po.grandTotal) } } });
            }
            await tx.budgetHead.update({ where: { id: newBudgetHeadId }, data: { committedAmount: { increment: Number(po.grandTotal) } } });
          }
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
          oldValue: { budgetHeadId: po.budgetHeadId },
          newValue: { budgetHeadId: newBudgetHeadId, budgetHead: newBudgetHead.particulars, noReapproval: true },
        });
        res.json(tagged);
        return;
      }

      // Approved PO that never had a head: commit its remaining value to the new head.
      if (!po.budgetHeadId) {
        const toCommit = Number(po.grandTotal);
        const tagged = await prisma.$transaction(async (tx) => {
          await tx.budgetHead.update({
            where: { id: newBudgetHeadId },
            data: { committedAmount: { increment: toCommit } },
          });
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
          oldValue: { budgetHeadId: null },
          newValue: { budgetHeadId: newBudgetHeadId, budgetHead: newBudgetHead.particulars, committed: toCommit, noReapproval: true },
        });
        res.json(tagged);
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

// POST /:id/items/:itemId/post-ledger — post a single PO item to a chosen
// ledger (Tally-style item-wise expense booking). Creates a PURCHASE voucher:
//   Dr <selected ledger>          (item taxable amount)
//   Dr Input CGST/SGST or IGST    (item GST portion, when gstRate > 0)
//   Cr Vendor ledger              (item total incl. GST) — when the payable
//                                 isn't booked yet; consumes a paid advance
//                                 or books the payable to the vendor
//   Cr Purchase ledger            (reclassification) — when the item's value
//                                 was already booked via a posted GRN or an
//                                 invoice posted to books
// Every posting is recorded in POItemLedgerPost so an item can never be
// posted for more than its amount.
router.post(
  '/:id/items/:itemId/post-ledger',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { ledgerId, amount: reqAmount } = req.body as { ledgerId?: string; amount?: number };

      if (!ledgerId || typeof ledgerId !== 'string') {
        res.status(400).json({ error: 'Ledger is required' });
        return;
      }

      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          vendor: { select: { id: true, name: true } },
          invoices: { select: { id: true } },
          items: { where: { id: req.params.itemId }, include: { ledgerPosts: true } },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (![POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED].includes(po.status as POStatus)) {
        res.status(400).json({ error: 'Items can only be posted to ledgers after the PO is approved' });
        return;
      }
      const item = po.items[0];
      if (!item) {
        res.status(404).json({ error: 'PO item not found' });
        return;
      }

      const ledger = await prisma.ledger.findFirst({
        where: { id: ledgerId, projectId, deletedAt: null, isActive: true },
      });
      if (!ledger) {
        res.status(400).json({ error: 'Ledger not found or inactive' });
        return;
      }

      // Linked ledgers are rejected — posting an item to a bank/cash ledger
      // would fake a deposit, and to another vendor/owner would debit someone
      // else's account. The one exception is THIS PO's own vendor ledger:
      // selecting it means "mark this amount as utilised in the vendor
      // account" — handled below by debiting the generic Purchase pool
      // instead of the ledger itself (avoids a self-cancelling Dr/Cr pair).
      const isLinked = !!ledger.linkedEntityType && ledger.linkedEntityType !== 'NONE';
      const isOwnVendorLedger = ledger.linkedEntityType === 'VENDOR' && ledger.linkedEntityId === po.vendorId;
      if (isLinked && !isOwnVendorLedger) {
        res.status(400).json({
          error: 'Items can only be posted to expense/asset ledgers — not to bank, cash, owner, or other vendor accounts. Create a ledger (e.g. "Office Rent") if needed.',
        });
        return;
      }

      const postedSoFar = item.ledgerPosts.reduce((s, p) => s + Number(p.taxableAmount), 0);
      const remaining = Math.round((Number(item.amount) - postedSoFar) * 100) / 100;
      if (remaining <= 0) {
        res.status(400).json({ error: `"${item.materialName}" is already fully posted to ledgers` });
        return;
      }
      const taxable = reqAmount !== undefined ? Math.round(Number(reqAmount) * 100) / 100 : remaining;
      if (!Number.isFinite(taxable) || taxable <= 0) {
        res.status(400).json({ error: 'Amount must be greater than 0' });
        return;
      }
      if (taxable > remaining + 0.01) {
        res.status(400).json({ error: `Amount exceeds the unposted balance of ₹${remaining.toFixed(2)} for "${item.materialName}"` });
        return;
      }

      const gstRate = Number(item.gstRate ?? 0);
      const fullGst = Math.round(taxable * gstRate) / 100;

      // ── Credit side ──
      // If this item's value is already booked in the generic "Purchase"
      // ledger (the vendor payable booked when the PO was approved, a posted
      // GRN containing this item, or a linked invoice that was posted to
      // books), the payable was already recorded — so this posting
      // reclassifies it: Cr Purchase → Dr <selected ledger>.
      // Otherwise the payable isn't booked yet: Cr the vendor ledger, which
      // consumes an advance already paid to the vendor or books the payable.
      const invoiceIds = po.invoices.map((i) => i.id);
      const [grnBooking, invoiceVoucher, poAccrued] = await Promise.all([
        prisma.goodsReceiptItem.findFirst({
          where: {
            poItemId: item.id,
            acceptedQty: { gt: 0 },
            goodsReceipt: { status: GoodsReceiptStatus.POSTED, deletedAt: null },
          },
          select: { id: true },
        }),
        invoiceIds.length > 0
          ? prisma.journalVoucher.findFirst({
              where: { sourceInvoiceId: { in: invoiceIds }, status: 'POSTED', deletedAt: null },
              select: { id: true },
            })
          : Promise.resolve(null),
        hasPoAccrual(po.id),
      ]);
      const alreadyBooked = !!grnBooking || !!invoiceVoucher || poAccrued;

      // A reclassification only moves the taxable cost between ledgers: the
      // Input GST was already booked together with the payable, so debiting it
      // again here would double-count it.
      const gst = alreadyBooked ? 0 : fullGst;
      const total = Math.round((taxable + gst) * 100) / 100;

      // Resolve the generic "Purchase" pool — needed as the debit target when
      // the user posts into the vendor's own ledger, and as the credit target
      // when the item was already booked via GRN/invoice.
      const getPurchaseLedgerId = async (): Promise<string> => {
        const existing = await findLedgerByName('Purchase', projectId);
        if (existing) return existing;
        const created = await prisma.ledger.create({
          data: {
            projectId,
            name: 'Purchase',
            group: 'PURCHASE',
            linkedEntityType: 'NONE',
            openingBalance: 0,
            currentBalance: 0,
            isActive: true,
          },
        });
        return created.id;
      };

      // Debit target: normally the selected ledger. When the user picks the
      // vendor's own ledger, the item must land as a Credit (usage) inside
      // that account — the debit therefore goes to the generic Purchase pool
      // instead, so the vendor ledger never shows a self-cancelling pair.
      // (Only valid when the payable isn't already booked — posting into the
      // vendor ledger would then need Cr Purchase AND Dr Purchase.)
      let debitLedgerId = ledger.id;
      if (isOwnVendorLedger) {
        if (alreadyBooked) {
          res.status(400).json({
            error: `"${item.materialName}" is already booked to the vendor (PO approval, GRN or invoice) — post it to an expense ledger to reclassify.`,
          });
          return;
        }
        debitLedgerId = await getPurchaseLedgerId();
      }

      let creditLedgerId: string;
      let creditDesc: string;
      if (alreadyBooked) {
        creditLedgerId = await getPurchaseLedgerId();
        creditDesc = `Reclassify ${item.materialName} - PO ${po.poNumber}`;
      } else {
        creditLedgerId = await ensureVendorLedger(po.vendorId, projectId);
        // Reads like Tally: in the vendor's statement this credit row shows
        // the contra account ("By Office Rent - First floor rent - PO ...").
        creditDesc = `By ${isOwnVendorLedger ? 'Purchase' : ledger.name} - ${item.materialName} - PO ${po.poNumber}`;
      }

      // Safety net: a posting whose debit and credit land on the same ledger
      // would show a self-cancelling pair — e.g. selecting "Purchase" while
      // the item is already booked (Cr Purchase) — always reject it.
      if (debitLedgerId === creditLedgerId) {
        res.status(400).json({
          error: `Cannot post "${item.materialName}" to "${ledger.name}" — the credit side resolves to the same ledger.`,
        });
        return;
      }

      const entries: Array<{ ledgerId: string; debit: number; credit: number; description: string }> = [
        { ledgerId: debitLedgerId, debit: taxable, credit: 0, description: `${item.materialName} - PO ${po.poNumber}` },
      ];
      if (gst > 0) {
        const cgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_CGST, projectId);
        const sgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_SGST, projectId);
        const igstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_IGST, projectId);
        if (cgstLedgerId && sgstLedgerId) {
          const half = Math.round(gst / 2 * 100) / 100;
          entries.push({ ledgerId: cgstLedgerId, debit: half, credit: 0, description: `Input CGST - PO ${po.poNumber}` });
          entries.push({ ledgerId: sgstLedgerId, debit: Math.round((gst - half) * 100) / 100, credit: 0, description: `Input SGST - PO ${po.poNumber}` });
        } else if (igstLedgerId) {
          entries.push({ ledgerId: igstLedgerId, debit: gst, credit: 0, description: `Input IGST - PO ${po.poNumber}` });
        } else {
          entries[0].debit += gst; // no GST ledgers seeded — keep the voucher balanced
        }
      }
      entries.push({
        ledgerId: creditLedgerId,
        debit: 0,
        credit: total,
        description: creditDesc,
      });

      const ledgerIds = entries.map((e) => e.ledgerId);
      const ledgers = await prisma.ledger.findMany({
        where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true },
      });
      if (ledgers.length !== new Set(ledgerIds).size) {
        res.status(400).json({ error: 'One or more required ledgers not found. Run ledger sync first.' });
        return;
      }
      const ledgerMap = new Map(ledgers.map((l) => [l.id, { id: l.id, name: l.name, group: l.group, linkedEntityType: l.linkedEntityType, linkedEntityId: l.linkedEntityId }]));

      const jvNumber = await generateVoucherNumber(VoucherType.PURCHASE, projectId);

      const result = await prisma.$transaction(async (tx) => {
        // Re-check the unposted balance inside the transaction so two
        // concurrent posts cannot exceed the item amount.
        const posted = await tx.pOItemLedgerPost.aggregate({
          where: { poItemId: item.id },
          _sum: { taxableAmount: true },
        });
        const inTxRemaining = Math.round((Number(item.amount) - Number(posted._sum.taxableAmount ?? 0)) * 100) / 100;
        if (taxable > inTxRemaining + 0.01) {
          throw new Error(`Amount exceeds the unposted balance of ₹${inTxRemaining.toFixed(2)} for "${item.materialName}"`);
        }

        const voucherResult = await postVoucher({
          projectId,
          jvNumber,
          voucherType: VoucherType.PURCHASE,
          voucherDate: new Date(),
          description: `PO ${po.poNumber} - ${item.materialName}`,
          totalDebit: total,
          totalCredit: total,
          entries,
          ledgerMap,
          budgetHeadMap: new Map(),
          sourceInvoiceId: null,
          billSettlements: [],
          userId: req.user!.id,
          tx,
        });

        await tx.pOItemLedgerPost.create({
          data: {
            poItemId: item.id,
            journalVoucherId: voucherResult.voucherId,
            ledgerId: ledger.id,
            taxableAmount: taxable,
            gstAmount: gst,
            createdBy: req.user!.id,
          },
        });

        return voucherResult;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: {
          action: 'POST_ITEM_TO_LEDGER',
          poNumber: po.poNumber,
          itemId: item.id,
          materialName: item.materialName,
          ledgerId: ledger.id,
          ledgerName: ledger.name,
          creditLedgerId,
          taxableAmount: taxable,
          gstAmount: gst,
          jvNumber,
        },
      });

      res.json({ message: `"${item.materialName}" posted to ${ledger.name}`, jvNumber, voucherId: result.voucherId });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
