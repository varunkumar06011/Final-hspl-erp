import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, PaymentStatus, hasPermission } from '@hospital-erp/shared';
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

const router = Router();
router.use(authMiddleware);

// GET / — list payment requests with workflow status
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listPaymentRequestsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, status, vendorId } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(vendorId ? { vendorId } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.paymentRequest.findMany({
          where,
          include: {
            vendor: { select: { id: true, name: true } },
            invoice: { select: { id: true, invoiceNumber: true, totalAmount: true } },
            createdByUser: { select: { id: true, name: true } },
            approvalWorkflow: {
              include: {
                steps: {
                  orderBy: { stepNumber: 'asc' },
                  include: { approverUser: { select: { id: true, name: true, role: true } } },
                },
              },
            },
            payments: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.paymentRequest.count({ where }),
      ]);

      res.json({
        data,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — single payment request with full workflow
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include: {
          vendor: { select: { id: true, name: true } },
          invoice: { select: { id: true, invoiceNumber: true, totalAmount: true } },
          createdByUser: { select: { id: true, name: true } },
          approvalWorkflow: {
            include: {
              steps: {
                orderBy: { stepNumber: 'asc' },
                include: { approverUser: { select: { id: true, name: true, role: true } } },
              },
            },
          },
          payments: true,
        },
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

// POST / — create payment request + initiate approval workflow
router.post(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(createPaymentRequestSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      // Verify invoice exists and is verified
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.body.invoiceId, projectId, deletedAt: null },
      });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }
      if (invoice.verificationStatus !== 'VERIFIED') {
        res.status(400).json({ error: 'Invoice must be verified before creating a payment request' });
        return;
      }

      // Check for duplicate payment request for same invoice
      const existingPR = await prisma.paymentRequest.findFirst({
        where: { invoiceId: req.body.invoiceId, projectId, deletedAt: null, status: { notIn: [PaymentStatus.REJECTED] } },
      });
      if (existingPR) {
        res.status(409).json({ error: 'A payment request already exists for this invoice' });
        return;
      }

      // Validate amount doesn't exceed invoice total
      if (Number(req.body.amount) > Number(invoice.totalAmount)) {
        res.status(400).json({ error: `Payment amount cannot exceed invoice total of ${invoice.totalAmount}` });
        return;
      }

      // Create payment request + initiate workflow in a transaction
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.paymentRequest.create({
          data: {
            projectId,
            invoiceId: req.body.invoiceId,
            vendorId: req.body.vendorId,
            requestNumber: req.body.requestNumber,
            amount: req.body.amount,
            paymentMode: req.body.paymentMode ?? null,
            notes: req.body.notes ?? null,
            createdBy: req.user!.id,
          },
        });

        const workflow = await approvalService.initiate({
          entityType: 'PAYMENT_REQUEST',
          entityId: created.id,
          projectId,
        });

        const record = await tx.paymentRequest.update({
          where: { id: created.id },
          data: { approvalWorkflowId: workflow.id },
          include: {
            vendor: { select: { id: true, name: true } },
            invoice: { select: { id: true, invoiceNumber: true } },
            approvalWorkflow: { include: { steps: true } },
          },
        });

        return record;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PAYMENT_REQUEST',
        entityId: result.id,
        projectId,
        newValue: { requestNumber: result.requestNumber, amount: result.amount.toString() },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /steps/:stepId/approve — approve a workflow step
router.post(
  '/steps/:stepId/approve',
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const canApprove = hasPermission(req.user.role, Permission.APPROVE_PAYMENT_STEP_1) ||
      hasPermission(req.user.role, Permission.APPROVE_PAYMENT_STEP_2);
    if (!canApprove) {
      res.status(403).json({ error: 'Insufficient permissions. Required: APPROVE_PAYMENT_STEP_1 or APPROVE_PAYMENT_STEP_2' });
      return;
    }
    next();
  },
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await approvalService.approve(
        req.params.stepId,
        req.user!.id,
        req.body.comments
      );

      // If fully approved, update payment request status
      if (result.isFullyApproved) {
        await prisma.paymentRequest.updateMany({
          where: { approvalWorkflowId: result.workflow.id },
          data: { status: PaymentStatus.APPROVED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'APPROVAL_STEP',
        entityId: req.params.stepId,
        projectId: req.user!.projectId,
        newValue: { workflowStatus: result.workflow.status },
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Approval failed';
      if (message.includes('not found') || message.includes('Only') || message.includes('cannot') || message.includes('already')) {
        res.status(400).json({ error: message });
        return;
      }
      next(error);
    }
  }
);

// POST /steps/:stepId/reject — reject a workflow step
router.post(
  '/steps/:stepId/reject',
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const canReject = hasPermission(req.user.role, Permission.APPROVE_PAYMENT_STEP_1) ||
      hasPermission(req.user.role, Permission.APPROVE_PAYMENT_STEP_2);
    if (!canReject) {
      res.status(403).json({ error: 'Insufficient permissions. Required: APPROVE_PAYMENT_STEP_1 or APPROVE_PAYMENT_STEP_2' });
      return;
    }
    next();
  },
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.body.comments) {
        res.status(400).json({ error: 'Rejection reason is required' });
        return;
      }

      const result = await approvalService.reject(
        req.params.stepId,
        req.user!.id,
        req.body.comments
      );

      await prisma.paymentRequest.updateMany({
        where: { approvalWorkflowId: result.workflow.id },
        data: { status: PaymentStatus.REJECTED },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'APPROVAL_STEP',
        entityId: req.params.stepId,
        projectId: req.user!.projectId,
        newValue: { reason: req.body.comments },
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Rejection failed';
      if (message.includes('not found') || message.includes('Only') || message.includes('already')) {
        res.status(400).json({ error: message });
        return;
      }
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
      const pr = await prisma.paymentRequest.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include: { payments: true },
      });
      if (!pr) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }
      if (pr.status !== PaymentStatus.APPROVED) {
        res.status(400).json({ error: `Payment request must be APPROVED before recording payment. Current status: ${pr.status}` });
        return;
      }

      // Prevent double payment
      if (pr.payments.length > 0) {
        res.status(409).json({ error: 'Payment has already been recorded for this request' });
        return;
      }

      // Validate payment amount matches request
      if (Number(req.body.amount) !== Number(pr.amount)) {
        res.status(400).json({ error: `Payment amount must match the approved request amount of ${pr.amount}` });
        return;
      }

      const [payment] = await prisma.$transaction([
        prisma.payment.create({
          data: {
            paymentRequestId: pr.id,
            amount: req.body.amount,
            mode: req.body.mode,
            reference: req.body.reference ?? null,
          },
        }),
        prisma.paymentRequest.update({
          where: { id: pr.id },
          data: { status: PaymentStatus.PAID },
        }),
      ]);

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PAYMENT_REQUEST',
        entityId: pr.id,
        projectId: req.user!.projectId,
        oldValue: { status: PaymentStatus.APPROVED },
        newValue: { status: PaymentStatus.PAID, paymentAmount: req.body.amount },
      });

      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
