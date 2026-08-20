import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, InvoiceVerificationStatus, PaymentStatus, UserRole } from '@hospital-erp/shared';
import { createInvoiceSchema, listInvoicesSchema, approvalActionSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { getStorageService } from '../services/storage.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

async function generateInvoiceCode(): Promise<string> {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { invoiceCode: { startsWith: 'VGH-INV' } },
    select: { invoiceCode: true },
  });
  const maxNum = invoices.reduce((max, inv) => {
    const match = inv.invoiceCode?.match(/^VGH-INV(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-INV${String(maxNum + 1).padStart(3, '0')}`;
}

const invoiceInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      items: true,
    },
  },
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

// GET / — list invoices
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listInvoicesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, vendorId, verificationStatus } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (verificationStatus) where.verificationStatus = verificationStatus;

      const [data, total] = await Promise.all([
        prisma.vendorInvoice.findMany({
          where,
          include: invoiceInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.vendorInvoice.count({ where }),
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

// GET /:id — get single invoice
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: invoiceInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create invoice (with optional file upload)
router.post(
  '/',
  rbacMiddleware(Permission.VERIFY_INVOICE),
  upload.single('file'),
  validateMiddleware(createInvoiceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { vendorId, poId, invoiceNumber, amount, taxAmount, totalAmount, advancePaid, advanceType, advanceOtherType, deliveryDate } = req.body;

      // Validate vendor
      const vendor = await prisma.vendor.findFirst({
        where: { id: vendorId, projectId, deletedAt: null },
      });
      if (!vendor) {
        res.status(400).json({ error: 'Vendor not found' });
        return;
      }

      // Validate PO if provided
      if (poId) {
        const po = await prisma.purchaseOrder.findFirst({
          where: { id: poId, projectId, deletedAt: null },
        });
        if (!po) {
          res.status(400).json({ error: 'Purchase order not found' });
          return;
        }
        if (po.vendorId !== vendorId) {
          res.status(400).json({ error: 'PO does not belong to the selected vendor' });
          return;
        }
      }

      const invoiceCode = await generateInvoiceCode();

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `invoices/${subPath}/${invoiceCode}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const invoice = await prisma.vendorInvoice.create({
        data: {
          projectId,
          vendorId,
          poId: poId ?? null,
          invoiceCode,
          invoiceNumber,
          amount: Number(amount),
          taxAmount: Number(taxAmount) || 0,
          totalAmount: Number(totalAmount),
          advancePaid: Number(advancePaid) || 0,
          advanceType: advanceType ?? null,
          advanceOtherType: advanceOtherType ?? null,
          paymentStatus: PaymentStatus.PENDING,
          stockStatus: 'PENDING',
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          filePath,
          fileName,
          fileMimeType,
          verificationStatus: InvoiceVerificationStatus.PENDING,
          createdBy: req.user!.id,
        },
        include: invoiceInclude,
      });

      // Initiate approval workflow — 1 step per head role, minApprovers=1
      const workflow = await prisma.approvalWorkflow.create({
        data: {
          entityType: 'VENDOR_INVOICE',
          entityId: invoice.id,
          projectId,
          status: 'VERIFICATION',
          currentStep: 0,
          minApprovers: 2,
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

      await prisma.vendorInvoice.update({
        where: { id: invoice.id },
        data: { approvalWorkflowId: workflow.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { invoiceCode, invoiceNumber, vendorId, totalAmount },
      });

      const result = await prisma.vendorInvoice.findUnique({
        where: { id: invoice.id },
        include: invoiceInclude,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id — update invoice (only if not approved)
router.patch(
  '/:id',
  rbacMiddleware(Permission.VERIFY_INVOICE),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (existing.verificationStatus === InvoiceVerificationStatus.VERIFIED) {
        res.status(400).json({ error: 'Cannot edit a verified invoice' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      for (const key of ['amount', 'taxAmount', 'totalAmount', 'advancePaid', 'advanceType', 'advanceOtherType']) {
        if (req.body[key] !== undefined) {
          updateData[key] = req.body[key];
        }
      }
      if (req.body.deliveryDate !== undefined) {
        updateData.deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : null;
      }

      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `invoices/${subPath}/${existing.invoiceCode}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        updateData.filePath = uploadResult.filePath;
        updateData.fileName = req.file.originalname;
        updateData.fileMimeType = req.file.mimetype;
      }

      const updated = await prisma.vendorInvoice.update({
        where: { id: existing.id },
        data: updateData,
        include: invoiceInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VENDOR_INVOICE',
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

// DELETE /:id — soft delete
router.delete(
  '/:id',
  rbacMiddleware(Permission.VERIFY_INVOICE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (existing.verificationStatus === InvoiceVerificationStatus.VERIFIED) {
        res.status(400).json({ error: 'Cannot delete a verified invoice' });
        return;
      }

      await prisma.vendorInvoice.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'VENDOR_INVOICE',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Invoice deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve — approve invoice (any of 4 head roles, 1 approval needed)
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!invoice || !invoice.approvalWorkflow) {
        res.status(404).json({ error: 'Invoice or approval workflow not found' });
        return;
      }

      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only heads can approve invoices' });
        return;
      }

      const step = invoice.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already approved' });
        return;
      }

      const alreadyApproved = invoice.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this invoice' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      // Only mark VERIFIED when fully approved (2 approvals)
      if (result.isFullyApproved) {
        await prisma.vendorInvoice.update({
          where: { id: invoice.id },
          data: { verificationStatus: InvoiceVerificationStatus.VERIFIED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { comments: req.body.comments },
      });

      const updated = await prisma.vendorInvoice.findUnique({
        where: { id: invoice.id },
        include: invoiceInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject — reject invoice
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!invoice || !invoice.approvalWorkflow) {
        res.status(404).json({ error: 'Invoice or approval workflow not found' });
        return;
      }

      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only heads can reject invoices' });
        return;
      }

      const step = invoice.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      await approvalService.reject(step.id, req.user!.id, reason);

      await prisma.vendorInvoice.update({
        where: { id: invoice.id },
        data: { verificationStatus: InvoiceVerificationStatus.REJECTED },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { reason },
      });

      const updated = await prisma.vendorInvoice.findUnique({
        where: { id: invoice.id },
        include: invoiceInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/mark-stock-received — check for approved gate pass, then mark stock as received
router.post(
  '/:id/mark-stock-received',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (invoice.verificationStatus !== InvoiceVerificationStatus.VERIFIED) {
        res.status(400).json({ error: 'Invoice must be approved first' });
        return;
      }
      if (invoice.stockStatus === 'RECEIVED') {
        res.status(400).json({ error: 'Stock already marked as received' });
        return;
      }

      // STRICT RULE: No inventory entry without an approved gate pass for this invoice
      const gatePass = await prisma.gatePass.findFirst({
        where: { invoiceId: invoice.id, projectId, deletedAt: null, status: 'APPROVED' },
      });
      if (!gatePass) {
        res.status(400).json({
          error: 'No approved gate pass exists for this invoice. Create and approve a gate pass first — without a gate pass, no entry can be made in the inventory.',
        });
        return;
      }

      // Gate pass already added items to inventory during OTP approval — just mark as received
      await prisma.vendorInvoice.update({
        where: { id: invoice.id },
        data: { stockStatus: 'RECEIVED' },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { stockStatus: 'RECEIVED', gatePassId: gatePass.id },
      });

      const updated = await prisma.vendorInvoice.findUnique({
        where: { id: invoice.id },
        include: invoiceInclude,
      });

      res.json({ invoice: updated, message: 'Stock marked as received (items were added to inventory via gate pass).' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/mark-payment-paid — mark payment status as paid
router.post(
  '/:id/mark-payment-paid',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (invoice.verificationStatus !== InvoiceVerificationStatus.VERIFIED) {
        res.status(400).json({ error: 'Invoice must be approved first' });
        return;
      }

      const updated = await prisma.vendorInvoice.update({
        where: { id: invoice.id },
        data: { paymentStatus: PaymentStatus.PAID },
        include: invoiceInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { paymentStatus: PaymentStatus.PAID },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
