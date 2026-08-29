import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, InvoiceVerificationStatus, PaymentStatus, StockStatus, UserRole, GoodsReceiptStatus, getRequiredApproverCount } from '@hospital-erp/shared';
import { createInvoiceSchema, listInvoicesSchema, approvalActionSchema, updateInvoiceSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { notifyApprovers } from '../services/push.service';
import { getStorageService, serveFile } from '../services/storage.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const allowedInvoiceFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

async function generateInvoiceCode(): Promise<string> {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { invoiceCode: { startsWith: 'VGH-IN' } },
    select: { invoiceCode: true },
  });
  const maxNum = invoices.reduce((max, inv) => {
    const match = inv.invoiceCode?.match(/^VGH-IN(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-IN${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Extract the 2-digit state code from a GSTIN (first 2 characters).
 * Returns null if the GSTIN is missing or malformed.
 */
function getGstStateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const match = gstin.match(/^(\d{2})[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/);
  return match ? match[1] : null;
}

/**
 * Split a GST amount into CGST/SGST/IGST based on the place-of-supply rule:
 * - Same state (vendor and hospital GSTIN share the same state code) → CGST + SGST (each = gstAmount / 2)
 * - Different states, or either GSTIN missing → IGST = full gstAmount
 */
function splitGst(gstAmount: number, vendorGstin: string | null, projectGstin: string | null): {
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
} {
  const vendorState = getGstStateCode(vendorGstin);
  const projectState = getGstStateCode(projectGstin);
  if (vendorState && projectState && vendorState === projectState) {
    const half = gstAmount / 2;
    return { cgstAmount: half, sgstAmount: half, igstAmount: 0 };
  }
  return { cgstAmount: 0, sgstAmount: 0, igstAmount: gstAmount };
}

/**
 * Compute the advance balance available to claim on an invoice for a given PO.
 *
 * available = (total PAID advance payment requests on the PO)
 *           - (sum of advancePaid already claimed by OTHER invoices on the same PO)
 *
 * This prevents double-claiming the same advance across multiple invoices.
 * Pass `excludeInvoiceId` when updating an invoice so its own current claim
 * is not counted against itself.
 */
async function getAvailableAdvanceForPo(poId: string, excludeInvoiceId?: string): Promise<number> {
  const [paidAdvances, claimedByInvoices] = await Promise.all([
    prisma.paymentRequest.aggregate({
      where: { poId, type: 'ADVANCE', status: PaymentStatus.PAID, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: {
        poId,
        deletedAt: null,
        ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}),
      },
      _sum: { advancePaid: true },
    }),
  ]);

  const totalPaidAdvance = Number(paidAdvances._sum.amount) || 0;
  const claimedByOthers = Number(claimedByInvoices._sum.advancePaid) || 0;
  return Math.max(0, totalPaidAdvance - claimedByOthers);
}

const invoiceInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      date: true,
      createdAt: true,
      quotation: { select: { id: true, quotationNumber: true, date: true } },
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

      // Validate advance does not exceed total
      if (Number(advancePaid) > Number(totalAmount)) {
        res.status(400).json({ error: `Advance paid (${advancePaid}) cannot exceed invoice total (${totalAmount})` });
        return;
      }

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
        if (!['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'].includes(po.status)) {
          res.status(400).json({ error: 'Invoice can only be created against an approved, partially delivered, or delivered purchase order' });
          return;
        }

        // Validate advancePaid does not exceed the available advance on this PO
        if (Number(advancePaid) > 0) {
          const availableAdvance = await getAvailableAdvanceForPo(poId);
          if (Number(advancePaid) > availableAdvance) {
            res.status(400).json({
              error: `Advance paid (${advancePaid}) exceeds the available advance balance (${availableAdvance}) on this PO. Available = paid advances minus advance already claimed by other invoices.`,
            });
            return;
          }
        }
      }

      // Fetch project GSTIN for CGST/SGST/IGST split
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { gstNumber: true },
      });

      // Auto-calculate CGST/SGST/IGST from the tax amount and state codes
      const taxAmt = Number(taxAmount) || 0;
      const split = splitGst(taxAmt, vendor.gstNumber, project?.gstNumber ?? null);

      const invoiceCode = await generateInvoiceCode();
      const finalInvoiceNumber = invoiceNumber || invoiceCode;

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        if (!allowedInvoiceFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Invoice file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `invoices/${subPath}/${invoiceCode}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      // Create invoice + approval workflow atomically so a rollback can't leave
      // an orphan workflow or an invoice without its workflow linkage.
      const { invoice, workflow } = await prisma.$transaction(async (tx) => {
        const invoice = await tx.vendorInvoice.create({
          data: {
            projectId,
            vendorId,
            poId: poId ?? null,
            invoiceCode,
            invoiceNumber: finalInvoiceNumber,
            amount: Number(amount),
            taxAmount: taxAmt,
            cgstAmount: split.cgstAmount,
            sgstAmount: split.sgstAmount,
            igstAmount: split.igstAmount,
            totalAmount: Number(totalAmount),
            advancePaid: Number(advancePaid) || 0,
            advanceType: advanceType ?? null,
            advanceOtherType: advanceOtherType ?? null,
            paymentStatus: (Number(advancePaid) || 0) > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.PENDING,
            stockStatus: StockStatus.PENDING,
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            filePath,
            fileName,
            fileMimeType,
            verificationStatus: InvoiceVerificationStatus.PENDING,
            createdBy: req.user!.id,
          },
          include: invoiceInclude,
        });

        // Initiate approval workflow — any 2 of 4 head roles
        const workflow = await tx.approvalWorkflow.create({
          data: {
            entityType: 'VENDOR_INVOICE',
            entityId: invoice.id,
            projectId,
            status: 'VERIFICATION',
            currentStep: 0,
            minApprovers: getRequiredApproverCount(Number(totalAmount)),
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

        await tx.vendorInvoice.update({
          where: { id: invoice.id },
          data: { approvalWorkflowId: workflow.id },
        });

        return { invoice, workflow };
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { invoiceCode, invoiceNumber: finalInvoiceNumber, vendorId, totalAmount, acknowledged: true },
      });

      // Notify all approvers via push notification
      notifyApprovers(projectId, HEAD_ROLES, {
        approvalId: workflow.id,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        title: 'New Approval Required',
        body: `Invoice ${finalInvoiceNumber} — ₹${totalAmount}`,
        url: `/invoices?approval=${workflow.id}`,
      }).catch((err) => console.error('[Push] Invoice notification error:', err));

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

// GET /:id/file — serve the invoice attachment file
router.get(
  '/:id/file',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
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

// PATCH /:id — update invoice (only if not approved)
router.patch(
  '/:id',
  rbacMiddleware(Permission.VERIFY_INVOICE),
  upload.single('file'),
  validateMiddleware(updateInvoiceSchema),
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

      const amount = req.body.amount !== undefined ? Number(req.body.amount) : Number(existing.amount);
      const taxAmount = req.body.taxAmount !== undefined ? Number(req.body.taxAmount) : Number(existing.taxAmount);
      const totalAmount = req.body.totalAmount !== undefined ? Number(req.body.totalAmount) : Number(existing.totalAmount);
      const advancePaid = req.body.advancePaid !== undefined ? Number(req.body.advancePaid) : Number(existing.advancePaid);
      if (Math.abs(totalAmount - (amount + taxAmount)) > 0.01) {
        res.status(400).json({ error: 'Total amount must equal invoice amount plus tax amount' });
        return;
      }
      if (advancePaid > totalAmount) {
        res.status(400).json({ error: 'Advance paid cannot exceed invoice total' });
        return;
      }

      // Validate advancePaid does not exceed the available advance on the linked PO
      if (existing.poId && advancePaid > 0) {
        const availableAdvance = await getAvailableAdvanceForPo(existing.poId, existing.id);
        if (advancePaid > availableAdvance) {
          res.status(400).json({
            error: `Advance paid (${advancePaid}) exceeds the available advance balance (${availableAdvance}) on this PO. Available = paid advances minus advance already claimed by other invoices.`,
          });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      for (const key of ['amount', 'taxAmount', 'totalAmount', 'advancePaid', 'advanceType', 'advanceOtherType']) {
        if (req.body[key] !== undefined) {
          updateData[key] = req.body[key];
        }
      }
      // Recalculate CGST/SGST/IGST split when taxAmount changes
      if (req.body.taxAmount !== undefined) {
        const vendor = await prisma.vendor.findFirst({
          where: { id: existing.vendorId },
          select: { gstNumber: true },
        });
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { gstNumber: true },
        });
        const split = splitGst(taxAmount, vendor?.gstNumber ?? null, project?.gstNumber ?? null);
        updateData.cgstAmount = split.cgstAmount;
        updateData.sgstAmount = split.sgstAmount;
        updateData.igstAmount = split.igstAmount;
      }
      if (req.body.deliveryDate !== undefined) {
        updateData.deliveryDate = req.body.deliveryDate ? new Date(req.body.deliveryDate) : null;
      }

      if (req.file) {
        if (!allowedInvoiceFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Invoice file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `invoices/${subPath}/${existing.invoiceCode}-${req.file.originalname}`;
        const storage = getStorageService();
        // Delete the previous file before uploading the replacement
        if (existing.filePath) {
          await storage.deleteFile(existing.filePath).catch(() => {});
        }
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

      const storage = getStorageService();
      if (existing.filePath) {
        await storage.deleteFile(existing.filePath).catch(() => {});
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

// POST /:id/approve — approve invoice after receipt matching
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

      if (invoice.poId) {
        const receipts = await prisma.goodsReceipt.findMany({
          where: { poId: invoice.poId, projectId, status: GoodsReceiptStatus.POSTED, deletedAt: null },
          select: { items: { select: { acceptedQty: true, poItem: { select: { unitPrice: true } } } } },
        });
        const acceptedValue = receipts.reduce(
          (total, receipt) => total + receipt.items.reduce((sum, item) => sum + Number(item.acceptedQty) * Number(item.poItem?.unitPrice ?? 0), 0),
          0,
        );
        const otherInvoiceAmount = await prisma.vendorInvoice.aggregate({
          where: {
            poId: invoice.poId,
            id: { not: invoice.id },
            projectId,
            deletedAt: null,
            verificationStatus: { not: InvoiceVerificationStatus.REJECTED },
          },
          _sum: { amount: true },
        });
        const availableValue = acceptedValue - Number(otherInvoiceAmount._sum.amount ?? 0);
        if (receipts.length === 0) {
          res.status(400).json({ error: 'A posted goods receipt is required before approving a PO invoice' });
          return;
        }
        if (Number(invoice.amount) > availableValue + 0.01) {
          res.status(400).json({ error: `Invoice amount exceeds the available accepted goods value of ₹${Math.max(0, availableValue).toLocaleString('en-IN')}` });
          return;
        }
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
        newValue: { comments: req.body.comments, acknowledged: true },
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
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.vendorInvoice.update({
          where: { id: invoice.id },
          data: { verificationStatus: InvoiceVerificationStatus.REJECTED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'VENDOR_INVOICE',
        entityId: invoice.id,
        projectId,
        newValue: { reason, acknowledged: true },
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

// GET /:id/payments — payment history for an invoice (advance + installments)
router.get(
  '/:id/payments',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: {
          id: true,
          invoiceCode: true,
          invoiceNumber: true,
          totalAmount: true,
          advancePaid: true,
          advanceType: true,
          advanceOtherType: true,
          paymentStatus: true,
          createdAt: true,
          poId: true,
        },
      });
      if (!invoice) {
        res.status(404).json({ error: 'Invoice not found' });
        return;
      }

      const paymentRequests = await prisma.paymentRequest.findMany({
        where: { invoiceId: invoice.id, deletedAt: null },
        include: {
          payments: true,
          createdByUser: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const advancePaid = Number(invoice.advancePaid) || 0;
      const totalAmount = Number(invoice.totalAmount) || 0;

      // Build ledger entries
      const ledger: Array<{
        type: string;
        date: string;
        amount: number;
        mode: string | null;
        reference: string | null;
        status: string;
        requestNumber: string | null;
      }> = [];

      if (advancePaid > 0) {
        ledger.push({
          type: 'Advance',
          date: invoice.createdAt.toISOString(),
          amount: advancePaid,
          mode: invoice.advanceType ?? null,
          reference: invoice.advanceOtherType ?? null,
          status: 'PAID',
          requestNumber: null,
        });
      }

      for (const pr of paymentRequests) {
        if (pr.payments.length === 0) {
          // Request created but not yet paid
          ledger.push({
            type: 'Installment',
            date: pr.createdAt.toISOString(),
            amount: Number(pr.amount),
            mode: pr.paymentMode,
            reference: null,
            status: pr.status,
            requestNumber: pr.requestNumber,
          });
        } else {
          for (const p of pr.payments) {
            ledger.push({
              type: 'Installment',
              date: p.date.toISOString(),
              amount: Number(p.amount),
              mode: p.mode,
              reference: p.reference,
              status: 'PAID',
              requestNumber: pr.requestNumber,
            });
          }
        }
      }

      const installmentsPaid = paymentRequests
        .filter((pr) => pr.status === PaymentStatus.PAID)
        .reduce((sum, pr) => sum + Number(pr.amount), 0);

      // Cross-reference with actual paid advances on the linked PO for transparency.
      // Exposes divergence between the invoice's claimed advance and the actual
      // advance paid on the PO, preventing a "parallel financial reality".
      let poAdvancePaid = 0;
      let unclaimedAdvance = 0;
      if (invoice.poId) {
        const [paidAdvancesOnPo, claimedByInvoices] = await Promise.all([
          prisma.paymentRequest.aggregate({
            where: { poId: invoice.poId, type: 'ADVANCE', status: PaymentStatus.PAID, deletedAt: null },
            _sum: { amount: true },
          }),
          prisma.vendorInvoice.aggregate({
            where: { poId: invoice.poId, deletedAt: null },
            _sum: { advancePaid: true },
          }),
        ]);
        poAdvancePaid = Number(paidAdvancesOnPo._sum.amount) || 0;
        const totalClaimed = Number(claimedByInvoices._sum.advancePaid) || 0;
        unclaimedAdvance = Math.max(0, poAdvancePaid - totalClaimed);
      }

      // Use the higher of manual advancePaid and actual PO advance paid, capped at
      // invoice total, to prevent double-payment while preserving backward compat.
      const effectiveAdvance = Math.min(totalAmount, Math.max(advancePaid, poAdvancePaid));
      const paidToDate = effectiveAdvance + installmentsPaid;
      const outstanding = totalAmount - paidToDate;

      res.json({
        invoice: {
          id: invoice.id,
          invoiceCode: invoice.invoiceCode,
          invoiceNumber: invoice.invoiceNumber,
          totalAmount,
          advancePaid,
          poAdvancePaid,
          effectiveAdvance,
          unclaimedAdvance,
          installmentsPaid,
          paidToDate,
          outstanding,
          paymentStatus: invoice.paymentStatus,
        },
        ledger,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
