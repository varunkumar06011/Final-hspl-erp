import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, PaymentStatus, UserRole, InvoiceVerificationStatus, getRequiredApproverCount, VoucherType } from '@hospital-erp/shared';
import {
  createPaymentRequestSchema,
  listPaymentRequestsSchema,
  recordPaymentSchema,
  createExpenseSchema,
  createAdvancePaymentSchema,
  approvalActionSchema,
  POPaymentType,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateSequenceNumber } from '../services/sequence.service';
import * as approvalService from '../services/approval.service';
import { notifyApprovers } from '../services/push.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { postVoucher, generateVoucherNumber } from './voucher.routes';
import { ensureVendorLedger, ensureBankLedger, ensureCashLedger, findLedgerByName } from './ledger.routes';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

/**
 * Calculate paid-to-date for an invoice: advance + sum of all PAID payment request amounts.
 * Returns { paidToDate, outstanding, totalAmount, advancePaid, installmentsPaid,
 *           poAdvancePaid, unclaimedAdvance }.
 *
 * poAdvancePaid: total actual PAID advance payment requests on the linked PO.
 * unclaimedAdvance: paid on PO but not yet claimed by any invoice (poAdvancePaid - sum of all invoice advancePaid on that PO).
 *
 * These cross-reference fields expose the connection between actual PO advances and
 * the invoice's claimed advance, preventing a parallel financial reality where the
 * invoice says "advancePaid = ₹2L" while ₹3L was actually paid on the PO.
 *
 * Accepts optional transaction client for use inside transactions.
 */
async function getInvoicePaymentSummary(invoiceId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const invoice = await client.vendorInvoice.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true, advancePaid: true, poId: true },
  });
  if (!invoice) throw new Error('Invoice not found');

  const paidRequests = await client.paymentRequest.findMany({
    where: { invoiceId, status: PaymentStatus.PAID, deletedAt: null },
    select: { amount: true },
  });

  const installmentsPaid = paidRequests.reduce((sum, pr) => sum + Number(pr.amount), 0);

  const advancePaid = Number(invoice.advancePaid) || 0;
  const totalAmount = Number(invoice.totalAmount) || 0;

  // Cross-reference with actual paid advances on the linked PO.
  // The unclaimed portion of PO advances (paid but not yet claimed on any
  // invoice) is allocated to invoices in date order so the SAME advance is
  // never counted against multiple invoices — preventing double-payment.
  let poAdvancePaid = 0;
  let unclaimedAdvance = 0;
  let allocatedUnclaimed = 0;
  if (invoice.poId) {
    const [paidAdvancesOnPo, claimedByInvoices] = await Promise.all([
      client.paymentRequest.aggregate({
        where: { poId: invoice.poId, type: 'ADVANCE', status: PaymentStatus.PAID, deletedAt: null },
        _sum: { amount: true },
      }),
      client.vendorInvoice.aggregate({
        where: { poId: invoice.poId, deletedAt: null },
        _sum: { advancePaid: true },
      }),
    ]);
    poAdvancePaid = Number(paidAdvancesOnPo._sum.amount) || 0;
    const totalClaimed = Number(claimedByInvoices._sum.advancePaid) || 0;
    unclaimedAdvance = Math.max(0, poAdvancePaid - totalClaimed);

    // Allocate unclaimed advance to invoices in date order, each capped at its
    // remaining (totalAmount - its own advancePaid), until exhausted.
    if (unclaimedAdvance > 0) {
      const poInvoices = await client.vendorInvoice.findMany({
        where: { poId: invoice.poId, deletedAt: null },
        select: { id: true, totalAmount: true, advancePaid: true, date: true },
        orderBy: { date: 'asc' },
      });
      let remainingPool = unclaimedAdvance;
      for (const inv of poInvoices) {
        if (remainingPool <= 0) break;
        const cap = Math.max(0, Number(inv.totalAmount) - Number(inv.advancePaid));
        const share = Math.min(remainingPool, cap);
        if (inv.id === invoiceId) {
          allocatedUnclaimed = share;
          break;
        }
        remainingPool -= share;
      }
    }
  }

  // This invoice's effective advance = its own claimed advance + its allocated
  // share of unclaimed PO advances, capped at the invoice total.
  const effectiveAdvance = Math.min(totalAmount, advancePaid + allocatedUnclaimed);
  const paidToDate = effectiveAdvance + installmentsPaid;
  const outstanding = totalAmount - paidToDate;

  return { totalAmount, advancePaid, installmentsPaid, paidToDate, outstanding, poAdvancePaid, unclaimedAdvance };
}

/**
 * Recalculate and update invoice payment status based on outstanding balance.
 * - outstanding <= 0 → PAID
 * - paidToDate > 0 but outstanding > 0 → PARTIALLY_PAID
 * - paidToDate === 0 → PENDING
 * Accepts optional transaction client for use inside transactions.
 */
async function recalcInvoicePaymentStatus(invoiceId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const { paidToDate, outstanding } = await getInvoicePaymentSummary(invoiceId, tx);
  let status: PaymentStatus;
  if (outstanding <= 0) {
    status = PaymentStatus.PAID;
  } else if (paidToDate > 0) {
    status = PaymentStatus.PARTIALLY_PAID;
  } else {
    status = PaymentStatus.PENDING;
  }
  const client = tx ?? prisma;
  await client.vendorInvoice.update({
    where: { id: invoiceId },
    data: { paymentStatus: status },
  });
}

async function generatePaymentCode(): Promise<string> {
  return generateSequenceNumber('paymentRequest', 'paymentCode', 'VGH-PAY', 3);
}

const prInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  invoice: { select: { id: true, invoiceCode: true, invoiceNumber: true, totalAmount: true } },
  purchaseOrder: { select: { id: true, poNumber: true, grandTotal: true, paymentType: true } },
  createdByUser: { select: { id: true, name: true } },
  payments: {
    select: {
      id: true,
      amount: true,
      mode: true,
      reference: true,
      date: true,
      bankAccountId: true,
      cashAccountId: true,
      bankAccount: { select: { id: true, accountName: true } },
      cashAccount: { select: { id: true, name: true } },
      journalVoucherId: true,
      journalVoucher: { select: { jvNumber: true } },
    },
  },
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

// GET /pending-invoices — list verified invoices eligible for a new payment request
router.get(
  '/pending-invoices',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      // Get all verified invoices that are not fully paid
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
          paymentRequests: {
            where: { deletedAt: null },
            select: { id: true, status: true, amount: true, requestNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Keep invoices visible while an installment request is pending so the remaining balance is not hidden.
      const result = await Promise.all(
        verifiedInvoices.map(async (inv) => {
          const activeRequest = inv.paymentRequests.find(
            (pr) => pr.status === PaymentStatus.PENDING || pr.status === PaymentStatus.APPROVED
          );
          const summary = await getInvoicePaymentSummary(inv.id);
          return {
            id: inv.id,
            invoiceCode: inv.invoiceCode,
            invoiceNumber: inv.invoiceNumber,
            vendorId: inv.vendorId,
            vendor: inv.vendor,
            totalAmount: summary.totalAmount,
            advancePaid: summary.advancePaid,
            installmentsPaid: summary.installmentsPaid,
            paidToDate: summary.paidToDate,
            outstanding: summary.outstanding,
            poAdvancePaid: summary.poAdvancePaid,
            unclaimedAdvance: summary.unclaimedAdvance,
            activePaymentRequest: activeRequest
              ? {
                  id: activeRequest.id,
                  status: activeRequest.status,
                  amount: Number(activeRequest.amount),
                  requestNumber: activeRequest.requestNumber,
                }
              : null,
            createdBy: inv.createdByUser?.name ?? '—',
            createdAt: inv.createdAt,
          };
        })
      );

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET /pending-pos — list approved POs with ADVANCE or FULL_PAYMENT type that don't have an active advance payment request
router.get(
  '/pending-pos',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const pos = await prisma.purchaseOrder.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: { in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'] },
          paymentType: { in: [POPaymentType.ADVANCE, POPaymentType.FULL_PAYMENT] },
        },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          advancePaymentRequests: {
            where: { deletedAt: null, status: { in: [PaymentStatus.PENDING, PaymentStatus.APPROVED, PaymentStatus.PAID] } },
            select: { id: true, status: true, amount: true, requestNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const result = pos.map((po) => {
        const activeRequest = po.advancePaymentRequests.find(
          (pr) => pr.status === PaymentStatus.PENDING || pr.status === PaymentStatus.APPROVED
        );
        const paidAdvances = po.advancePaymentRequests
          .filter((pr) => pr.status === PaymentStatus.PAID)
          .reduce((sum, pr) => sum + Number(pr.amount), 0);
        return {
          id: po.id,
          poNumber: po.poNumber,
          paymentType: po.paymentType,
          grandTotal: Number(po.grandTotal),
          vendor: po.vendor,
          advancePaidToDate: paidAdvances,
          outstanding: Math.max(0, Number(po.grandTotal) - paidAdvances),
          activePaymentRequest: activeRequest
            ? { id: activeRequest.id, status: activeRequest.status, amount: Number(activeRequest.amount), requestNumber: activeRequest.requestNumber }
            : null,
        };
      });

      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// POST /po-advance — create advance payment request against a PO (with file upload + approval workflow)
router.post(
  '/po-advance',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  upload.single('file'),
  validateMiddleware(createAdvancePaymentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { poId, vendorId, requestNumber, amount, paymentMode, notes } = req.body;

      // Validate PO exists, belongs to project, is approved, and has the right payment type
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: poId, projectId, deletedAt: null },
        include: {
          advancePaymentRequests: {
            where: { deletedAt: null, status: { in: [PaymentStatus.PENDING, PaymentStatus.APPROVED] } },
          },
        },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (!['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(po.status)) {
        res.status(400).json({ error: 'Purchase order must be approved first' });
        return;
      }
      if (po.paymentType !== POPaymentType.ADVANCE && po.paymentType !== POPaymentType.FULL_PAYMENT) {
        res.status(400).json({ error: 'Advance payments can only be created for POs with payment type ADVANCE or FULL_PAYMENT' });
        return;
      }
      if (po.vendorId !== vendorId) {
        res.status(400).json({ error: 'Vendor does not match the purchase order vendor' });
        return;
      }

      // Check for existing active advance payment request
      if (po.advancePaymentRequests.length > 0) {
        res.status(409).json({ error: 'An active advance payment request already exists for this PO. Complete or reject it before creating another.' });
        return;
      }

      // Check amount doesn't exceed PO grand total
      const paidAdvances = await prisma.paymentRequest.aggregate({
        where: { poId, status: PaymentStatus.PAID, deletedAt: null, type: 'ADVANCE' },
        _sum: { amount: true },
      });
      const alreadyPaid = Number(paidAdvances._sum.amount) || 0;
      const outstanding = Number(po.grandTotal) - alreadyPaid;
      if (Number(amount) > outstanding) {
        res.status(400).json({ error: `Advance amount cannot exceed outstanding balance of ${outstanding}` });
        return;
      }
      if (Number(amount) <= 0) {
        res.status(400).json({ error: 'Advance amount must be greater than zero' });
        return;
      }

      // Handle file upload (proof of advance payment — e.g. bank transfer receipt)
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const paymentCode = await generatePaymentCode();
        const prefixedFileName = `advance-payments/${subPath}/${paymentCode}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const paymentCode = await generatePaymentCode();

      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.paymentRequest.create({
          data: {
            projectId,
            poId,
            vendorId,
            paymentCode,
            requestNumber,
            type: 'ADVANCE',
            amount: Number(amount),
            paymentMode: paymentMode ?? null,
            notes: notes ?? null,
            filePath,
            fileName,
            fileMimeType,
            // ── C26: Inherit budgetHeadId from the PO if not explicitly provided ──
            budgetHeadId: req.body.budgetHeadId ?? po.budgetHeadId ?? null,
            createdBy: req.user!.id,
          },
        });

        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PAYMENT_REQUEST',
            entityId: created.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: getRequiredApproverCount(Number(amount)),
            approvalPolicy: 'HEAD_GROUPS',
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
        newValue: { paymentCode, requestNumber, amount: String(amount), type: 'ADVANCE', poId },
      });

      const record = await prisma.paymentRequest.findUnique({
        where: { id: result.id },
        include: prInclude,
      });

      // Notify all approvers via push notification
      if (record?.approvalWorkflow) {
        notifyApprovers(projectId, HEAD_ROLES, {
          approvalId: record.approvalWorkflow.id,
          entityType: 'PAYMENT_REQUEST',
          entityId: result.id,
          title: 'New Approval Required',
          body: `Advance payment ${paymentCode} — ₹${amount}`,
          url: `/payments?approval=${record.approvalWorkflow.id}`,
        }).catch((err) => console.error('[Push] Advance payment notification error:', err));
      }

      res.status(201).json(record);
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
        include: { purchaseOrder: { select: { budgetHeadId: true } } },
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
        where: {
          invoiceId,
          projectId,
          deletedAt: null,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.APPROVED] },
        },
      });
      if (existingPR) {
        res.status(409).json({ error: 'An active payment request already exists for this invoice. Complete or reject it before creating another.' });
        return;
      }

      const { outstanding } = await getInvoicePaymentSummary(invoiceId);
      if (Number(amount) > outstanding) {
        res.status(400).json({ error: `Payment amount cannot exceed outstanding balance of ${outstanding}` });
        return;
      }
      if (Number(amount) <= 0) {
        res.status(400).json({ error: 'Payment amount must be greater than zero' });
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
            // ── C26: Inherit budgetHeadId from the invoice's PO if not provided ──
            budgetHeadId: req.body.budgetHeadId ?? invoice.purchaseOrder?.budgetHeadId ?? null,
            createdBy: req.user!.id,
          },
        });

        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PAYMENT_REQUEST',
            entityId: created.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: getRequiredApproverCount(Number(amount)),
            approvalPolicy: 'HEAD_GROUPS',
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

      // Notify all approvers via push notification
      if (record?.approvalWorkflow) {
        notifyApprovers(projectId, HEAD_ROLES, {
          approvalId: record.approvalWorkflow.id,
          entityType: 'PAYMENT_REQUEST',
          entityId: result.id,
          title: 'New Approval Required',
          body: `Payment request ${paymentCode} — ₹${amount}`,
          url: `/payments?approval=${record.approvalWorkflow.id}`,
        }).catch((err) => console.error('[Push] Payment notification error:', err));
      }

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
  validateMiddleware(createExpenseSchema),
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
            budgetHeadId: req.body.budgetHeadId ?? null,
            createdBy: req.user!.id,
          },
        });

        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'PAYMENT_REQUEST',
            entityId: created.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: getRequiredApproverCount(Number(amount)),
            approvalPolicy: 'HEAD_GROUPS',
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

      // Notify all approvers via push notification
      if (record?.approvalWorkflow) {
        notifyApprovers(projectId, HEAD_ROLES, {
          approvalId: record.approvalWorkflow.id,
          entityType: 'PAYMENT_REQUEST',
          entityId: result.id,
          title: 'New Approval Required',
          body: `Expense: ${description} — ₹${amount}`,
          url: `/payments?approval=${record.approvalWorkflow.id}`,
        }).catch((err) => console.error('[Push] Expense notification error:', err));
      }

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

// GET /:id/file — serve the expense attachment file
router.get(
  '/:id/file',
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
      if (!existing.filePath) {
        res.status(404).json({ error: 'No file attached' });
        return;
      }
      await serveFile(res, existing.filePath, existing.fileMimeType);
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
        include: { payments: true, invoice: true, purchaseOrder: true },
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

      const payment = await prisma.$transaction(async (tx) => {
        const paymentAmount = Number(req.body.amount);
        const bankAccountId = (req.body.bankAccountId as string) ?? null;
        const cashAccountId = (req.body.cashAccountId as string) ?? null;

        // ── C20: Guard against overpaying beyond the current outstanding ──
        // Check the invoice outstanding BEFORE marking this request as PAID.
        // If we mark it first, getInvoicePaymentSummary would count this very
        // request as an already-paid installment, making outstanding=0 and
        // falsely rejecting the payment as "already fully paid".
        //
        // ── C30: Serialize concurrent payments on the same invoice ──
        // Two different APPROVED payment requests for the same invoice can both
        // compute the same outstanding balance and pay, because the read and the
        // claim are separate. SELECT ... FOR UPDATE on the invoice row forces
        // them to run one-at-a-time, so the outstanding check is always based on
        // the latest recorded payments.
        if (pr.invoiceId) {
          await tx.$queryRaw`SELECT id FROM "vendor_invoices" WHERE id = ${pr.invoiceId}::uuid FOR UPDATE`;
          const { outstanding } = await getInvoicePaymentSummary(pr.invoiceId, tx);
          if (outstanding <= 0.01) {
            throw new Error('Invoice is already fully paid; cannot record this payment');
          }
          if (paymentAmount > outstanding + 0.01) {
            throw new Error(`Payment amount ${paymentAmount} exceeds current outstanding ${outstanding.toFixed(2)}`);
          }
        }

        // ── A15: Atomically claim the payment request to prevent double payment ──
        // Two concurrent /pay calls can both pass the pre-transaction check
        // (pr.payments.length === 0). This atomic updateMany ensures only one
        // call can transition the request from APPROVED → PAID; the other gets
        // count=0 and aborts. The `status: APPROVED` filter is the lock.
        const claimed = await tx.paymentRequest.updateMany({
          where: { id: pr.id, status: PaymentStatus.APPROVED },
          data: { status: PaymentStatus.PAID },
        });
        if (claimed.count !== 1) {
          throw new Error('Payment has already been recorded by another request');
        }

        // ── Enforce exactly one funding account ──
        // A payment must debit either a bank account or a cash account, never both
        // and never neither. Without this, a payment with no funding account would
        // mark the request as PAID and increase budget paidAmount without actually
        // decreasing any bank or cash balance — a phantom payment.
        if (!bankAccountId && !cashAccountId) {
          const err = new Error('A funding account (bankAccountId or cashAccountId) is required to record a payment');
          (err as Error & { status: number }).status = 400;
          throw err;
        }
        if (bankAccountId && cashAccountId) {
          const err = new Error('Specify either a bank account or a cash account, not both');
          (err as Error & { status: number }).status = 400;
          throw err;
        }

        // ── Tally-style double-entry: post a PAYMENT voucher ──
        // Dr Vendor ledger (reduces payable) or Dr Expense ledger (for EXPENSE type)
        // Cr Bank or Cash ledger (reduces asset)
        // postVoucher also handles bank/cash balance update + bank/cash transaction record.

        // 1. Determine the debit ledger (vendor for INVOICE/ADVANCE, expense for EXPENSE)
        let debitLedgerId: string;
        if (pr.vendorId) {
          debitLedgerId = await ensureVendorLedger(pr.vendorId, projectId);
        } else {
          // EXPENSE with no vendor: find an expense ledger by category, fall back to Miscellaneous Expense
          const expenseName = pr.category || pr.description || 'Miscellaneous Expense';
          debitLedgerId = (await findLedgerByName(expenseName, projectId))
            ?? (await findLedgerByName('Miscellaneous Expense', projectId))!;
          if (!debitLedgerId) {
            throw new Error('No expense ledger found. Run ledger sync to seed default expense ledgers.');
          }
        }

        // 2. Determine the credit ledger (bank or cash)
        let creditLedgerId: string;
        if (bankAccountId) {
          creditLedgerId = await ensureBankLedger(bankAccountId, projectId);
        } else if (cashAccountId) {
          creditLedgerId = await ensureCashLedger(cashAccountId!, projectId);
        } else {
          throw new Error('A funding account (bankAccountId or cashAccountId) is required');
        }

        // 3. Fetch both ledgers for the ledgerMap
        const debitLedger = await tx.ledger.findUnique({ where: { id: debitLedgerId } });
        const creditLedger = await tx.ledger.findUnique({ where: { id: creditLedgerId } });
        if (!debitLedger || !creditLedger) {
          throw new Error('Failed to load debit or credit ledger');
        }

        const ledgerMap = new Map([
          [debitLedger.id, { id: debitLedger.id, name: debitLedger.name, group: debitLedger.group, linkedEntityType: debitLedger.linkedEntityType, linkedEntityId: debitLedger.linkedEntityId }],
          [creditLedger.id, { id: creditLedger.id, name: creditLedger.name, group: creditLedger.group, linkedEntityType: creditLedger.linkedEntityType, linkedEntityId: creditLedger.linkedEntityId }],
        ]);

        // 4. Pre-check insufficient balance (postVoucher also checks, but we want a clear error before claiming)
        if (bankAccountId) {
          const bankAccount = await tx.bankAccount.findFirst({ where: { id: bankAccountId, projectId, deletedAt: null } });
          if (!bankAccount) throw new Error('Bank account not found in this project');
          if (!bankAccount.isActive) throw new Error('Bank account is inactive');
          if (Number(bankAccount.currentBalance) < paymentAmount) {
            throw new Error(`Insufficient balance in bank account ${bankAccount.accountName}`);
          }
        } else if (cashAccountId) {
          const cashAccount = await tx.cashAccount.findFirst({ where: { id: cashAccountId, projectId, deletedAt: null } });
          if (!cashAccount) throw new Error('Cash account not found in this project');
          if (!cashAccount.isActive) throw new Error('Cash account is inactive');
          if (Number(cashAccount.currentBalance) < paymentAmount) {
            throw new Error(`Insufficient balance in cash account ${cashAccount.name}`);
          }
        }

        // 5. Generate voucher number and post
        const jvNumber = await generateVoucherNumber(VoucherType.PAYMENT);
        const voucherResult = await postVoucher({
          projectId,
          jvNumber,
          voucherType: VoucherType.PAYMENT,
          voucherDate: new Date(),
          description: `Payment: ${pr.paymentCode} (${pr.type})`,
          totalDebit: paymentAmount,
          totalCredit: paymentAmount,
          entries: [
            { ledgerId: debitLedgerId, debit: paymentAmount, credit: 0, description: `Payment: ${pr.paymentCode}` },
            { ledgerId: creditLedgerId, debit: 0, credit: paymentAmount, description: `Payment: ${pr.paymentCode}` },
          ],
          ledgerMap,
          budgetHeadMap: new Map(),
          sourceInvoiceId: null,
          billSettlements: [],
          userId: req.user!.id,
          tx,
        });

        // ── Create Payment record with finance links ──
        const created = await tx.payment.create({
          data: {
            paymentRequestId: pr.id,
            amount: paymentAmount,
            mode: req.body.mode,
            reference: req.body.reference ?? null,
            bankAccountId,
            cashAccountId,
            budgetHeadId: pr.budgetHeadId ?? null,
            journalVoucherId: voucherResult.voucherId,
            postedAt: new Date(),
          },
        });

        // ── Update budget head paidAmount (and actualAmount for EXPENSE type) ──
        // For EXPENSE payments, the payment itself is the actual expense event
        // (there is no separate accrual step), so both actualAmount and paidAmount
        // increase. For INVOICE/ADVANCE payments, actualAmount was already posted
        // at GRN time, so only paidAmount increases here.
        if (pr.budgetHeadId) {
          const head = await tx.budgetHead.findFirst({
            where: { id: pr.budgetHeadId, projectId, deletedAt: null },
          });
          if (head) {
            // ── C27: Prevent overspend beyond allocated budget ──
            // For EXPENSE payments, actualAmount increases. If the new actual
            // would exceed allocatedAmount, block the payment rather than
            // silently driving available budget negative.
            if (pr.type === 'EXPENSE') {
              const projectedActual = Number(head.actualAmount) + paymentAmount;
              if (projectedActual > Number(head.allocatedAmount) + 0.01) {
                throw new Error(
                  `Payment of ₹${paymentAmount.toFixed(2)} would exceed the allocated budget for "${head.particulars}" ` +
                  `(allocated: ₹${Number(head.allocatedAmount).toFixed(2)}, current actual: ₹${Number(head.actualAmount).toFixed(2)})`
                );
              }
            }
            // Atomic increment — DB applies the delta, preventing lost updates
            // when multiple payments hit the same budget head concurrently.
            const budgetData: { paidAmount: { increment: number }; actualAmount?: { increment: number } } = {
              paidAmount: { increment: paymentAmount },
            };
            if (pr.type === 'EXPENSE') {
              budgetData.actualAmount = { increment: paymentAmount };
            }
            await tx.budgetHead.update({
              where: { id: pr.budgetHeadId },
              data: budgetData,
            });
          }
        }

        // Recalculate invoice payment status inside the transaction
        if (pr.invoiceId) {
          await recalcInvoicePaymentStatus(pr.invoiceId, tx);
        }

        return created;
      });

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
