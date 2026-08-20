import { Router, Response, NextFunction } from 'express';
import { APPROVAL_CONFIG, Permission, POStatus, AuditAction, UserRole } from '@hospital-erp/shared';
import { createPOSchema, listPOsSchema, approvalActionSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import PDFDocument from 'pdfkit';

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

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

const poInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true, phone: true, address: true, contactPersonName: true, contactPersonPhone: true } },
  quotation: { select: { id: true, quotationNumber: true } },
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

// POST / — create PO from an approved quotation
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_PO),
  validateMiddleware(createPOSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { vendorId, quotationId, gstAmount } = req.body;

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
      const gst = Number(gstAmount) || 0;
      const grandTotal = totalAmount + gst;

      // Create PO with items copied from quotation
      const po = await prisma.purchaseOrder.create({
        data: {
          projectId,
          vendorId,
          quotationId,
          poNumber,
          status: POStatus.PENDING_APPROVAL,
          totalAmount,
          gstAmount: gst,
          grandTotal,
          createdBy: req.user!.id,
          items: {
            create: quotation.items.map((item) => ({
              materialName: item.materialName,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              amount: item.amount,
            })),
          },
        },
        include: poInclude,
      });

      // Initiate approval workflow — any 2 of 4 head roles
      const workflow = await prisma.approvalWorkflow.create({
        data: {
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          projectId,
          status: 'VERIFICATION',
          currentStep: 0,
          minApprovers: APPROVAL_CONFIG.MIN_APPROVERS,
          steps: {
            create: HEAD_ROLES.map((role, idx) => ({
              stepNumber: idx + 1,
              approverRole: role,
              status: 'PENDING',
            })),
          },
        },
        include: { steps: true },
      });

      await prisma.purchaseOrder.update({
        where: { id: po.id },
        data: { approvalWorkflowId: workflow.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PURCHASE_ORDER',
        entityId: po.id,
        projectId,
        newValue: { poNumber, vendorId, quotationId, totalAmount, grandTotal, acknowledged: true },
      });

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

// PATCH /:id — update PO (only GST can be updated, and only if not approved)
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

      const updateData: Record<string, unknown> = {};
      if (req.body.gstAmount !== undefined) {
        const gst = Number(req.body.gstAmount);
        updateData.gstAmount = gst;
        updateData.grandTotal = Number(existing.totalAmount) + gst;
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: updateData,
        include: poInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PURCHASE_ORDER',
        entityId: existing.id,
        projectId,
        newValue: updateData,
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
      if (existing.status === POStatus.APPROVED || existing.status === POStatus.DELIVERED) {
        res.status(400).json({ error: 'Cannot delete an approved purchase order' });
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

// POST /:id/approve — approve PO (any 2 of 4 head roles)
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

      // Check user is one of the 4 head roles
      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Project Head, Head of Construction, Admin, or Admin 2 can approve' });
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

      // Approve the step
      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      // Only update PO status to APPROVED when fully approved (2 approvals)
      if (result.isFullyApproved) {
        await prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { status: POStatus.APPROVED },
        });
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

      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Project Head, Head of Construction, Admin, or Admin 2 can reject' });
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
          project: { select: { name: true, officeAddress: true, hospitalAddress: true } },
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

      // Header
      doc.fontSize(22).font('Helvetica-Bold').text('Vgrand Hospital', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text('Purchase Order', { align: 'center' });
      doc.moveDown(0.5);

      // PO info
      doc.fontSize(10);
      doc.text(`PO Number: ${po.poNumber}`, 50, doc.y);
      doc.text(`Date: ${new Date(po.createdAt).toLocaleDateString()}`, 300, doc.y - 15);
      doc.text(`Time: ${new Date(po.createdAt).toLocaleTimeString()}`, 50, doc.y);
      doc.text(`Created By: ${po.createdByUser?.name ?? '—'}`, 300, doc.y - 15);
      if (po.quotation) {
        doc.text(`Quotation Ref: ${po.quotation.quotationNumber}`, 50, doc.y);
      }
      doc.moveDown(1);

      // Three cards: Vendor, Bill To, Delivery Address
      const cardY = doc.y;
      const cardWidth = 165;
      const cardHeight = 90;
      const gap = 10;

      // Card 1: Vendor
      doc.roundedRect(50, cardY, cardWidth, cardHeight, 5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).text('VENDOR', 55, cardY + 5, { width: cardWidth - 10 });
      doc.font('Helvetica').fontSize(8);
      doc.text(`Name: ${po.vendor?.name ?? '—'}`, 55, cardY + 20, { width: cardWidth - 10 });
      doc.text(`Contact: ${po.vendor?.phone ?? po.vendor?.contactPersonPhone ?? '—'}`, 55, cardY + 33, { width: cardWidth - 10 });
      const vendorAddr = po.vendor?.address ?? '—';
      doc.text(`Address: ${vendorAddr}`, 55, cardY + 46, { width: cardWidth - 10, height: 40 });

      // Card 2: Bill To
      const card2X = 50 + cardWidth + gap;
      doc.roundedRect(card2X, cardY, cardWidth, cardHeight, 5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', card2X + 5, cardY + 5, { width: cardWidth - 10 });
      doc.font('Helvetica').fontSize(8);
      doc.text(`Office Address:`, card2X + 5, cardY + 20, { width: cardWidth - 10 });
      doc.text(po.project?.officeAddress ?? '—', card2X + 5, cardY + 33, { width: cardWidth - 10, height: 55 });

      // Card 3: Delivery Address
      const card3X = card2X + cardWidth + gap;
      doc.roundedRect(card3X, cardY, cardWidth, cardHeight, 5).stroke();
      doc.font('Helvetica-Bold').fontSize(9).text('DELIVERY ADDRESS', card3X + 5, cardY + 5, { width: cardWidth - 10 });
      doc.font('Helvetica').fontSize(8);
      doc.text(`Hospital Address:`, card3X + 5, cardY + 20, { width: cardWidth - 10 });
      doc.text(po.project?.hospitalAddress ?? '—', card3X + 5, cardY + 33, { width: cardWidth - 10, height: 55 });

      doc.y = cardY + cardHeight + 20;

      // Items table
      doc.font('Helvetica-Bold').fontSize(10).text('Items', 50, doc.y);
      doc.moveDown(0.5);

      const tableY = doc.y;
      const colX = { sno: 50, desc: 90, qty: 280, unit: 340, price: 390, total: 470 };
      const colWidths = { sno: 40, desc: 190, qty: 60, unit: 50, price: 80, total: 80 };

      // Table header
      doc.font('Helvetica-Bold').fontSize(9);
      doc.rect(50, tableY, 500, 20).fillAndStroke('#f0f0f0', '#ccc');
      doc.fillColor('black');
      doc.text('S.no', colX.sno + 2, tableY + 5, { width: colWidths.sno - 4 });
      doc.text('Description', colX.desc + 2, tableY + 5, { width: colWidths.desc - 4 });
      doc.text('Quantity', colX.qty + 2, tableY + 5, { width: colWidths.qty - 4 });
      doc.text('Unit', colX.unit + 2, tableY + 5, { width: colWidths.unit - 4 });
      doc.text('Unit Price', colX.price + 2, tableY + 5, { width: colWidths.price - 4 });
      doc.text('Total Amount', colX.total + 2, tableY + 5, { width: colWidths.total - 4 });

      // Table rows
      doc.font('Helvetica').fontSize(8);
      let rowY = tableY + 20;
      po.items.forEach((item, idx) => {
        if (idx % 2 === 1) {
          doc.rect(50, rowY, 500, 18).fill('#f9f9f9');
          doc.fillColor('black');
        }
        doc.text(String(idx + 1), colX.sno + 2, rowY + 4, { width: colWidths.sno - 4 });
        doc.text(item.materialName, colX.desc + 2, rowY + 4, { width: colWidths.desc - 4 });
        doc.text(String(item.quantity), colX.qty + 2, rowY + 4, { width: colWidths.qty - 4 });
        doc.text(item.unit ?? '', colX.unit + 2, rowY + 4, { width: colWidths.unit - 4 });
        doc.text(`Rs. ${Number(item.unitPrice).toFixed(2)}`, colX.price + 2, rowY + 4, { width: colWidths.price - 4 });
        doc.text(`Rs. ${Number(item.amount).toFixed(2)}`, colX.total + 2, rowY + 4, { width: colWidths.total - 4 });
        rowY += 18;
      });

      // Totals
      rowY += 10;
      doc.font('Helvetica').fontSize(9);
      doc.text(`Total: Rs. ${Number(po.totalAmount).toFixed(2)}`, 350, rowY);
      rowY += 15;
      if (Number(po.gstAmount) > 0) {
        doc.text(`GST: Rs. ${Number(po.gstAmount).toFixed(2)}`, 350, rowY);
        rowY += 15;
      }
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(`Grand Total: Rs. ${Number(po.grandTotal).toFixed(2)}`, 350, rowY);

      // Approved by / Created by
      rowY += 40;
      doc.font('Helvetica').fontSize(9);
      const approvedStep = po.approvalWorkflow?.steps.find((s) => s.status === 'APPROVED');
      const approvedBy = approvedStep?.approverUser?.name ?? '—';
      doc.text(`Approved By: ${approvedBy}`, 50, rowY);
      doc.text(`Created By: ${po.createdByUser?.name ?? '—'}`, 300, rowY);
      rowY += 15;
      doc.text(`Date & Time: ${new Date(po.createdAt).toLocaleString()}`, 50, rowY);

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

export default router;
