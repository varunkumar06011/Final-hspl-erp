import { Router, Response, NextFunction } from 'express';
import { APPROVAL_CONFIG, Permission, AuditAction, PaymentStatus, UserRole, InvoiceVerificationStatus } from '@hospital-erp/shared';
import {
  createPaymentRequestSchema,
  listPaymentRequestsSchema,
  recordPaymentSchema,
  approvalActionSchema,
} from '@hospital-erp/shared';
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

async function generatePaymentCode(): Promise<string> {
  const reqs = await prisma.paymentRequest.findMany({
    where: { paymentCode: { startsWith: 'VGH-PAY' } },
    select: { paymentCode: true },
  });
  const maxNum = reqs.reduce((max, r) => {
    const match = r.paymentCode?.match(/^VGH-PAY(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-PAY${String(maxNum + 1).padStart(3, '0')}`;
}

const prInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  invoice: { select: { id: true, invoiceCode: true, invoiceNumber: true, totalAmount: true } },
  createdByUser: { select: { id: true, name: true } },
  payments: true,
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
};

// GET / — list all payment requests (invoices + expenses)
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listPaymentRequestsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, status, vendorId, type } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (status) where.status = status;
      if (vendorId) where.vendorId = vendorId;
      if (type) where.type = type;

      const [data, total] = await Promise.all([
        prisma.paymentRequest.findMany({
          where,
          include: prInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.paymentRequest.count({ where }),
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

// GET /pending-invoices — list verified invoices that don't have a payment request yet
router.get(
  '/pending-invoices',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      // Get all verified invoices
      const verifiedInvoices = await prisma.vendorInvoice.findMany({
        where: {
          projectId,
          deletedAt: null,
          verificationStatus: InvoiceVerificationStatus.VERIFIED,
          paymentStatus: { not: PaymentStatus.PAID },
        },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          createdByUser: { select: { id: true, name: true } },
          paymentRequests: { where: { deletedAt: null }, select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Filter out invoices that already have a non-rejected payment request
      const pendingInvoices = verifiedInvoices.filter(
        (inv) => !inv.paymentRequests.some((pr) => pr.status !== PaymentStatus.REJECTED)
      );

      res.json({
        data: pendingInvoices.map((inv) => ({
          id: inv.id,
          invoiceCode: inv.invoiceCode,
          invoiceNumber: inv.invoiceNumber,
          vendorId: inv.vendorId,
          vendor: inv.vendor,
          totalAmount: Number(inv.totalAmount),
          advancePaid: Number(inv.advancePaid),
          balanceDue: Number(inv.totalAmount) - Number(inv.advancePaid),
          createdBy: inv.createdByUser?.name ?? '—',
          createdAt: inv.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /invoice-payment — create payment request for a verified invoice
router.post(
  '/invoice-payment',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(createPaymentRequestSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { invoiceId, vendorId, requestNumber, amount, paymentMode, notes } = req.body;

      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: invoiceId, projectId, deletedAt: null },
      });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (invoice.verificationStatus !== InvoiceVerificationStatus.VERIFIED) {
        res.status(400).json({ error: 'Invoice must be verified before creating a payment request' });
        return;
      }

      const existingPR = await prisma.paymentRequest.findFirst({
        where: { invoiceId, projectId, deletedAt: null, status: { notIn: [PaymentStatus.REJECTED] } },
      });
      if (existingPR) {
        res.status(409).json({ error: 'A payment request already exists for this invoice' });
        return;
      }

      if (Number(amount) > Number(invoice.totalAmount)) {
        res.status(400).json({ error: `Payment amount cannot exceed invoice total of ${invoice.totalAmount}` });
        return;
      }

      const paymentCode = await generatePaymentCode();

      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.paymentRequest.create({
          data: {
            projectId,
            invoiceId,
            vendorId,
            paymentCode,
            requestNumber,
            type: 'INVOICE',
            amount: Number(amount),
            paymentMode: paymentMode ?? null,
            notes: notes ?? null,
            createdBy: req.user!.id,
          },
        });

        const workflow = await prisma.approvalWorkflow.create({
          data: {
            entityType: 'PAYMENT_REQUEST',
            entityId: created.id,
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

        await tx.paymentRequest.update({
          where: { id: created.id },
          data: { approvalWorkflowId: workflow.id },
        });

        return created;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PAYMENT_REQUEST',
        entityId: result.id,
        projectId,
        newValue: { paymentCode, requestNumber, amount: String(amount), type: 'INVOICE' },
      });

      const record = await prisma.paymentRequest.findUnique({
        where: { id: result.id },
        include: prInclude,
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /expense — create daily expense with file upload
router.post(
  '/expense',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { description, amount, category, expenseDate, paymentMode } = req.body;

      if (!description || !amount || !category) {
        res.status(400).json({ error: 'Description, amount, and category are required' });
        return;
      }

      const paymentCode = await generatePaymentCode();

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `expenses/${subPath}/${paymentCode}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.paymentRequest.create({
          data: {
            projectId,
            paymentCode,
            requestNumber: paymentCode,
            type: 'EXPENSE',
            amount: Number(amount),
            description,
            category,
            expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
            paymentMode: paymentMode ?? null,
            filePath,
            fileName,
            fileMimeType,
            createdBy: req.user!.id,
          },
        });

        const workflow = await prisma.approvalWorkflow.create({
          data: {
            entityType: 'PAYMENT_REQUEST',
            entityId: created.id,
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

        await tx.paymentRequest.update({
          where: { id: created.id },
          data: { approvalWorkflowId: workflow.id },
        });

        return created;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PAYMENT_REQUEST',
        entityId: result.id,
        projectId,
        newValue: { paymentCode, description, amount: String(amount), category, type: 'EXPENSE' },
      });

      const record = await prisma.paymentRequest.findUnique({
        where: { id: result.id },
        include: prInclude,
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — single payment request
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: prInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve — approve payment request (any of 4 heads, 2 approvals needed)
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pr = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!pr || !pr.approvalWorkflow) {
        res.status(404).json({ error: 'Payment request or approval workflow not found' });
        return;
      }

      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only heads can approve payment requests' });
        return;
      }

      const step = pr.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already approved' });
        return;
      }

      const alreadyApproved = pr.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this payment request' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      // Only update status to APPROVED when fully approved (2 approvals)
      if (result.isFullyApproved) {
        await prisma.paymentRequest.update({
          where: { id: pr.id },
          data: { status: PaymentStatus.APPROVED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'PAYMENT_REQUEST',
        entityId: pr.id,
        projectId,
        newValue: { comments: req.body.comments, isFullyApproved: result.isFullyApproved, acknowledged: true },
      });

      const updated = await prisma.paymentRequest.findUnique({
        where: { id: pr.id },
        include: prInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject — reject payment request
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pr = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!pr || !pr.approvalWorkflow) {
        res.status(404).json({ error: 'Payment request or approval workflow not found' });
        return;
      }

      if (!HEAD_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only heads can reject payment requests' });
        return;
      }

      const step = pr.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.paymentRequest.update({
          where: { id: pr.id },
          data: { status: PaymentStatus.REJECTED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'PAYMENT_REQUEST',
        entityId: pr.id,
        projectId,
        newValue: { reason, acknowledged: true },
      });

      const updated = await prisma.paymentRequest.findUnique({
        where: { id: pr.id },
        include: prInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/pay — record payment after approval
router.post(
  '/:id/pay',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(recordPaymentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pr = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { payments: true, invoice: true },
      });
      if (!pr) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }
      if (pr.status !== PaymentStatus.APPROVED) {
        res.status(400).json({ error: `Payment request must be APPROVED. Current status: ${pr.status}` });
        return;
      }
      if (pr.payments.length > 0) {
        res.status(409).json({ error: 'Payment has already been recorded' });
        return;
      }
      if (Number(req.body.amount) !== Number(pr.amount)) {
        res.status(400).json({ error: `Payment amount must match the approved amount of ${pr.amount}` });
        return;
      }

      const [payment] = await prisma.$transaction([
        prisma.payment.create({
          data: {
            paymentRequestId: pr.id,
            amount: Number(req.body.amount),
            mode: req.body.mode,
            reference: req.body.reference ?? null,
          },
        }),
        prisma.paymentRequest.update({
          where: { id: pr.id },
          data: { status: PaymentStatus.PAID },
        }),
      ]);

      // If this is an invoice payment, also update the invoice's payment status
      if (pr.invoiceId && pr.invoice) {
        await prisma.vendorInvoice.update({
          where: { id: pr.invoiceId },
          data: { paymentStatus: PaymentStatus.PAID },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PAYMENT_REQUEST',
        entityId: pr.id,
        projectId,
        oldValue: { status: PaymentStatus.APPROVED },
        newValue: { status: PaymentStatus.PAID, paymentAmount: String(req.body.amount) },
      });

      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (only by creator, only if not approved/paid)
router.delete(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }
      if (existing.createdBy !== req.user!.id) {
        res.status(403).json({ error: 'Only the creator can delete this payment request' });
        return;
      }
      if (existing.status === PaymentStatus.APPROVED || existing.status === PaymentStatus.PAID) {
        res.status(400).json({ error: 'Cannot delete an approved or paid payment request' });
        return;
      }

      const storage = getStorageService();
      if (existing.filePath) {
        await storage.deleteFile(existing.filePath).catch(() => {});
      }

      await prisma.paymentRequest.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'PAYMENT_REQUEST',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Payment request deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
