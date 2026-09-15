import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, PaymentStatus, POStatus } from '@hospital-erp/shared';
import { createPaymentSheetSchema, listPaymentSheetsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { streamPaymentSheetPdf } from '../services/payment-sheet-pdf.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

// Include for list/detail — joins the full PO (with items + vendor) so the
// printable sheet carries all PO details without duplicating them.
const sheetInclude = {
  purchaseOrder: {
    include: {
      vendor: { select: { id: true, name: true, vendorCode: true, phone: true, address: true, contactPersonName: true, contactPersonPhone: true } },
      items: true,
      budgetHead: { select: { id: true, particulars: true } },
      createdByUser: { select: { id: true, name: true } },
    },
  },
  createdByUser: { select: { id: true, name: true } },
};

// GET / — list payment sheet entries for a date (defaults to today)
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listPaymentSheetsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { date, startDate, endDate, poId, status, page, pageSize } = req.query as Record<string, string | undefined>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 100;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (poId) where.poId = poId;
      if (status) where.status = status;

      if (startDate || endDate) {
        const range: Record<string, Date> = {};
        if (startDate) range.gte = new Date(String(startDate));
        if (endDate) {
          const e = new Date(String(endDate));
          e.setHours(23, 59, 59, 999);
          range.lte = e;
        }
        where.date = range;
      } else if (date) {
        const start = new Date(String(date));
        start.setHours(0, 0, 0, 0);
        const end = new Date(String(date));
        end.setHours(23, 59, 59, 999);
        where.date = { gte: start, lte: end };
      } else {
        // Default to today
        const now = new Date();
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        where.date = { gte: start, lte: end };
      }

      const [data, total] = await Promise.all([
        prisma.paymentSheet.findMany({
          where,
          include: sheetInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.paymentSheet.count({ where }),
      ]);

      const totalAmount = data.reduce((sum, e) => sum + Number(e.amount), 0);

      res.json({
        data,
        totalAmount,
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /pos — list approved POs for the picker (PO-first entry flow)
router.get(
  '/pos',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { search } = req.query as Record<string, string | undefined>;

      const where: Record<string, unknown> = {
        projectId,
        deletedAt: null,
        status: POStatus.APPROVED,
      };
      if (search) {
        where.OR = [
          { poNumber: { contains: String(search), mode: 'insensitive' } },
          { vendor: { name: { contains: String(search), mode: 'insensitive' } } },
        ];
      }

      const pos = await prisma.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          poNumber: true,
          date: true,
          grandTotal: true,
          netPayable: true,
          paymentType: true,
          status: true,
          vendor: { select: { id: true, name: true, vendorCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({ data: pos });
    } catch (error) {
      next(error);
    }
  }
);

// GET /pdf — download the day's payment sheet as a branded PDF (must precede /:id)
router.get(
  '/pdf',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { date } = req.query as Record<string, string | undefined>;

      const day = date ? new Date(String(date)) : new Date();
      const start = new Date(day);
      start.setHours(0, 0, 0, 0);
      const end = new Date(day);
      end.setHours(23, 59, 59, 999);

      const [entries, project] = await Promise.all([
        prisma.paymentSheet.findMany({
          where: { projectId, deletedAt: null, date: { gte: start, lte: end } },
          include: {
            ...sheetInclude,
            purchaseOrder: {
              include: {
                ...sheetInclude.purchaseOrder.include,
                project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true },
        }),
      ]);

      const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payment-sheet-${dateStr}.pdf"`);
      await streamPaymentSheetPdf(res as unknown as NodeJS.WritableStream, day, entries, project);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — single payment sheet entry (with full PO details for printing)
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.paymentSheet.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: sheetInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Payment sheet entry not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/file — serve the attached bill/receipt
router.get(
  '/:id/file',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.paymentSheet.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Payment sheet entry not found' });
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

// GET /:id/pdf — download a single entry's payment sheet PDF
router.get(
  '/:id/pdf',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const entry = await prisma.paymentSheet.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          ...sheetInclude,
          purchaseOrder: {
            include: {
              ...sheetInclude.purchaseOrder.include,
              project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
            },
          },
        },
      });
      if (!entry) {
        res.status(404).json({ error: 'Payment sheet entry not found' });
        return;
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="payment-sheet-${entry.purchaseOrder.poNumber}-${entry.id.slice(0, 8)}.pdf"`);
      await streamPaymentSheetPdf(res as unknown as NodeJS.WritableStream, new Date(entry.date), [entry], project);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create a payment sheet entry (PO must be approved)
router.post(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  upload.single('file'),
  validateMiddleware(createPaymentSheetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { poId, date, amount, paymentMode, reference, notes } = req.body;

      const po = await prisma.purchaseOrder.findFirst({
        where: { id: poId, projectId, deletedAt: null },
      });
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.status !== POStatus.APPROVED) {
        res.status(400).json({ error: 'Only approved purchase orders can be added to a payment sheet' });
        return;
      }

      // Handle file upload (bill / receipt)
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `payment-sheets/${subPath}/${po.poNumber}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const created = await prisma.paymentSheet.create({
        data: {
          projectId,
          poId,
          date: date ? new Date(date) : new Date(),
          amount: Number(amount),
          paymentMode,
          reference: reference ?? null,
          notes: notes ?? null,
          filePath,
          fileName,
          fileMimeType,
          status: PaymentStatus.PENDING,
          createdBy: req.user!.id,
        },
        include: sheetInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PAYMENT_SHEET',
        entityId: created.id,
        projectId,
        newValue: { poId, amount: String(amount), paymentMode, date: String(created.date) },
      });

      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id/approve — creator marks the entry as done (APPROVED)
router.patch(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.paymentSheet.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Payment sheet entry not found' });
        return;
      }
      if (existing.createdBy !== req.user!.id) {
        res.status(403).json({ error: 'Only the creator can mark this entry as done' });
        return;
      }
      if (existing.status === PaymentStatus.APPROVED) {
        res.status(400).json({ error: 'Entry is already marked done' });
        return;
      }

      const oldValue = { status: existing.status };
      const updated = await prisma.paymentSheet.update({
        where: { id: existing.id },
        data: { status: PaymentStatus.APPROVED },
        include: sheetInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'PAYMENT_SHEET',
        entityId: existing.id,
        projectId,
        oldValue,
        newValue: { status: PaymentStatus.APPROVED },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (only by creator, only if not yet approved)
router.delete(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.paymentSheet.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Payment sheet entry not found' });
        return;
      }
      if (existing.createdBy !== req.user!.id) {
        res.status(403).json({ error: 'Only the creator can delete this entry' });
        return;
      }
      if (existing.status === PaymentStatus.APPROVED) {
        res.status(400).json({ error: 'Cannot delete an entry that has been marked done' });
        return;
      }

      await prisma.paymentSheet.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'PAYMENT_SHEET',
        entityId: existing.id,
        projectId,
        oldValue: { amount: String(existing.amount), poId: existing.poId },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
