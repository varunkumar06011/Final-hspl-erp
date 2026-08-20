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

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
      doc.pipe(res);

      // Colors
      const PRIMARY = '#1a5276';
      const PRIMARY_LIGHT = '#d4e6f1';
      const LIGHT_BG = '#f8f9fa';
      const BORDER = '#d5d8dc';
      const TEXT_DARK = '#2c3e50';
      const TEXT_MUTED = '#7f8c8d';
      const WHITE = '#ffffff';

      const pageWidth = 595; // A4 width in points
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      // ── Header band ──
      doc.rect(0, 0, pageWidth, 80).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(24).font('Helvetica-Bold').text('Vgrand Hospital', margin, 20);
      doc.fontSize(11).font('Helvetica').fillColor('#d4e6f1').text('Purchase Order', margin, 50);
      // PO number badge on the right
      doc.roundedRect(pageWidth - margin - 130, 18, 130, 44, 6).fill(WHITE);
      doc.fillColor(PRIMARY).fontSize(9).font('Helvetica').text('PO NUMBER', pageWidth - margin - 122, 24, { width: 114 });
      doc.fontSize(14).font('Helvetica-Bold').text(po.poNumber, pageWidth - margin - 122, 38, { width: 114 });

      // ── PO info row ──
      let y = 95;
      const infoY = y;
      doc.fontSize(9).font('Helvetica').fillColor(TEXT_MUTED);
      doc.text('Date:', margin, infoY, { width: 50 });
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(new Date(po.createdAt).toLocaleDateString(), margin + 40, infoY, { width: 100 });
      doc.fillColor(TEXT_MUTED).font('Helvetica').text('Time:', margin + 160, infoY, { width: 40 });
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(new Date(po.createdAt).toLocaleTimeString(), margin + 200, infoY, { width: 100 });
      doc.fillColor(TEXT_MUTED).font('Helvetica').text('Created By:', margin + 320, infoY, { width: 70 });
      doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(po.createdByUser?.name ?? '—', margin + 390, infoY, { width: 165 });
      y = infoY + 18;
      if (po.quotation) {
        doc.fillColor(TEXT_MUTED).font('Helvetica').text('Quotation Ref:', margin, y, { width: 90 });
        doc.fillColor(TEXT_DARK).font('Helvetica-Bold').text(po.quotation.quotationNumber, margin + 90, y, { width: 200 });
        y += 16;
      }

      // ── Three info cards ──
      y += 8;
      const cardY = y;
      const cardWidth = (contentWidth - 20) / 3;
      const cardHeight = 110;
      const cardGap = 10;

      // Helper to draw a card
      function drawCard(x: number, label: string, lines: { label: string; value: string }[], valueHeight: number) {
        doc.roundedRect(x, cardY, cardWidth, cardHeight, 6).fillAndStroke(LIGHT_BG, BORDER);
        doc.rect(x, cardY, cardWidth, 22).fill(PRIMARY);
        doc.roundedRect(x, cardY, cardWidth, 6, 6).fill(PRIMARY);
        doc.rect(x, cardY + 4, cardWidth, 18).fill(PRIMARY);
        doc.fillColor(WHITE).fontSize(8).font('Helvetica-Bold').text(label, x + 8, cardY + 7, { width: cardWidth - 16 });
        let ly = cardY + 30;
        for (const line of lines) {
          doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text(line.label, x + 8, ly, { width: cardWidth - 16 });
          doc.fillColor(TEXT_DARK).fontSize(8).font('Helvetica-Bold').text(line.value, x + 8, ly + 10, { width: cardWidth - 16, height: valueHeight });
          ly += 10 + valueHeight + 4;
        }
      }

      drawCard(margin, 'VENDOR', [
        { label: 'Name', value: po.vendor?.name ?? '—' },
        { label: 'Contact', value: po.vendor?.phone ?? po.vendor?.contactPersonPhone ?? '—' },
        { label: 'Address', value: po.vendor?.address ?? '—' },
      ], 22);

      drawCard(margin + cardWidth + cardGap, 'BILL TO', [
        { label: 'Office Address', value: po.project?.officeAddress ?? '—' },
      ], 55);

      drawCard(margin + (cardWidth + cardGap) * 2, 'DELIVERY ADDRESS', [
        { label: 'Hospital Address', value: po.project?.hospitalAddress ?? '—' },
      ], 55);

      y = cardY + cardHeight + 20;

      // ── Items table ──
      doc.fillColor(PRIMARY).fontSize(12).font('Helvetica-Bold').text('Items', margin, y);
      y += 20;

      const colX = { sno: margin, desc: margin + 35, qty: margin + 280, unit: margin + 340, price: margin + 390, total: margin + 470 };
      const colWidths = { sno: 35, desc: 245, qty: 60, unit: 50, price: 80, total: 85 };
      const tableWidth = contentWidth;
      const headerHeight = 24;
      const rowHeight = 22;

      // Table header
      doc.rect(margin, y, tableWidth, headerHeight).fill(PRIMARY);
      doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold');
      doc.text('S.no', colX.sno + 4, y + 7, { width: colWidths.sno - 8, align: 'center' });
      doc.text('Description', colX.desc + 4, y + 7, { width: colWidths.desc - 8 });
      doc.text('Quantity', colX.qty + 4, y + 7, { width: colWidths.qty - 8, align: 'center' });
      doc.text('Unit', colX.unit + 4, y + 7, { width: colWidths.unit - 8, align: 'center' });
      doc.text('Unit Price', colX.price + 4, y + 7, { width: colWidths.price - 8, align: 'right' });
      doc.text('Total Amount', colX.total + 4, y + 7, { width: colWidths.total - 8, align: 'right' });
      y += headerHeight;

      // Table rows
      doc.fontSize(9).font('Helvetica');
      po.items.forEach((item, idx) => {
        if (idx % 2 === 0) {
          doc.rect(margin, y, tableWidth, rowHeight).fill(WHITE);
        } else {
          doc.rect(margin, y, tableWidth, rowHeight).fill(PRIMARY_LIGHT);
        }
        doc.fillColor(TEXT_DARK);
        doc.text(String(idx + 1), colX.sno + 4, y + 6, { width: colWidths.sno - 8, align: 'center' });
        doc.text(item.materialName, colX.desc + 4, y + 6, { width: colWidths.desc - 8 });
        doc.text(String(item.quantity), colX.qty + 4, y + 6, { width: colWidths.qty - 8, align: 'center' });
        doc.text(item.unit ?? '', colX.unit + 4, y + 6, { width: colWidths.unit - 8, align: 'center' });
        doc.text(`Rs. ${Number(item.unitPrice).toFixed(2)}`, colX.price + 4, y + 6, { width: colWidths.price - 8, align: 'right' });
        doc.text(`Rs. ${Number(item.amount).toFixed(2)}`, colX.total + 4, y + 6, { width: colWidths.total - 8, align: 'right' });
        // Row border
        doc.rect(margin, y, tableWidth, rowHeight).stroke(BORDER);
        y += rowHeight;
      });
      // Outer table border
      doc.rect(margin, y - po.items.length * rowHeight, tableWidth, po.items.length * rowHeight + headerHeight).stroke(PRIMARY);

      // ── Totals box ──
      y += 15;
      const totalsX = margin + tableWidth - 220;
      const totalsWidth = 220;
      const totalLines: { label: string; value: string; bold?: boolean }[] = [
        { label: 'Subtotal', value: `Rs. ${Number(po.totalAmount).toFixed(2)}` },
      ];
      if (Number(po.gstAmount) > 0) {
        totalLines.push({ label: 'GST', value: `Rs. ${Number(po.gstAmount).toFixed(2)}` });
      }
      totalLines.push({ label: 'Grand Total', value: `Rs. ${Number(po.grandTotal).toFixed(2)}`, bold: true });

      const totalsHeight = totalLines.length * 22 + 12;
      doc.roundedRect(totalsX, y, totalsWidth, totalsHeight, 6).fillAndStroke(LIGHT_BG, BORDER);
      let ty = y + 8;
      for (const t of totalLines) {
        if (t.bold) {
          doc.fillColor(PRIMARY).fontSize(11).font('Helvetica-Bold');
          // Highlight grand total row
          doc.rect(totalsX, ty - 4, totalsWidth, 22).fill(PRIMARY_LIGHT);
          doc.fillColor(PRIMARY);
        } else {
          doc.fillColor(TEXT_MUTED).fontSize(9).font('Helvetica');
        }
        doc.text(t.label, totalsX + 12, ty, { width: 120 });
        doc.fillColor(t.bold ? PRIMARY : TEXT_DARK).font(t.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(t.bold ? 11 : 9);
        doc.text(t.value, totalsX + 130, ty, { width: totalsWidth - 140, align: 'right' });
        ty += 22;
      }

      // ── Approval signatures ──
      y = ty + 25;
      doc.fillColor(PRIMARY).fontSize(10).font('Helvetica-Bold').text('Approval & Authorization', margin, y);
      y += 18;

      const approvedSteps = po.approvalWorkflow?.steps.filter((s) => s.status === 'APPROVED') ?? [];
      const sigBoxWidth = (contentWidth - 20) / 3;
      const sigBoxHeight = 60;

      // Signature boxes
      for (let i = 0; i < 3; i++) {
        const sx = margin + i * (sigBoxWidth + 10);
        doc.roundedRect(sx, y, sigBoxWidth, sigBoxHeight, 4).stroke(BORDER);
        const step = approvedSteps[i];
        doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica').text(`Approver ${i + 1}`, sx + 8, y + 6, { width: sigBoxWidth - 16 });
        if (step) {
          doc.fillColor(TEXT_DARK).fontSize(9).font('Helvetica-Bold').text(step.approverUser?.name ?? '—', sx + 8, y + 20, { width: sigBoxWidth - 16 });
          doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text(step.approverUser?.role?.replace(/_/g, ' ') ?? '', sx + 8, y + 34, { width: sigBoxWidth - 16 });
          doc.fillColor('#27ae60').fontSize(7).font('Helvetica-Bold').text('APPROVED', sx + 8, y + 46, { width: sigBoxWidth - 16 });
        } else {
          doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica-Oblique').text('Pending', sx + 8, y + 30, { width: sigBoxWidth - 16 });
        }
      }

      // ── Footer ──
      y += sigBoxHeight + 20;
      doc.fillColor(TEXT_MUTED).fontSize(8).font('Helvetica').text(
        `Generated on ${new Date().toLocaleString()}  |  Created by ${po.createdByUser?.name ?? '—'}`,
        margin, y, { width: contentWidth, align: 'center' }
      );
      // Footer line
      doc.moveTo(margin, y + 14).lineTo(pageWidth - margin, y + 14).stroke(PRIMARY);
      doc.fillColor(TEXT_MUTED).fontSize(7).font('Helvetica').text(
        'This is a computer-generated document and does not require a physical signature.',
        margin, y + 18, { width: contentWidth, align: 'center' }
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

export default router;
