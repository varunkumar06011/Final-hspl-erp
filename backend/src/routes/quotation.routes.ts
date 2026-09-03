import { Router, Response, NextFunction } from 'express';
import { APPROVER_ROLES, Permission, QuotationStatus, AuditAction } from '@hospital-erp/shared';
import { createQuotationSchema, listQuotationsSchema, approvalActionSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { getStorageService, serveFile } from '../services/storage.service';
import {
  createQuotation,
  generateQuotationNumber,
  quotationInclude,
  type QuotationLineItem,
} from '../services/quotation.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const allowedQuotationFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

const router = Router();
router.use(authMiddleware);

// GET / — list quotations
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listQuotationsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, vendorId, status, search } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (vendorId) where.vendorId = vendorId;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { quotationNumber: { contains: String(search), mode: 'insensitive' } },
          { vendor: { name: { contains: String(search), mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.quotation.findMany({
          where,
          include: quotationInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.quotation.count({ where }),
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

// GET /:id — get single quotation
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: quotationInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create quotation (with optional file upload)
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  upload.single('file'),
  validateMiddleware(createQuotationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendorId = req.body.vendorId;
      const items = typeof req.body.items === 'string'
        ? JSON.parse(req.body.items || '[]') as QuotationLineItem[]
        : (req.body.items || []) as QuotationLineItem[];

      // Generate the quotation number up front so it can be used for the file
      // prefix; it is passed into createQuotation to avoid regenerating it.
      const quotationNumber = await generateQuotationNumber(projectId);

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        if (!allowedQuotationFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Quotation file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `quotations/${subPath}/${quotationNumber}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      const result = await createQuotation({
        projectId,
        vendorId,
        items,
        createdBy: req.user!.id,
        quotationNumber,
        workTaskId: req.body.workTaskId,
        filePath,
        fileName,
        fileMimeType,
      });

      res.status(201).json(result);
    } catch (error) {
      // Surface known validation errors (e.g. "Vendor not found") as 400s
      if (error instanceof Error && error.message === 'Vendor not found') {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

// GET /:id/file — serve the quotation attachment file
router.get(
  '/:id/file',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
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

// PATCH /:id — update quotation (only if not yet approved)
router.patch(
  '/:id',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      if (existing.status === QuotationStatus.APPROVED || existing.status === QuotationStatus.CONVERTED_TO_PO) {
        res.status(400).json({ error: 'Cannot edit an approved quotation' });
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (req.body.items) {
        const items = typeof req.body.items === 'string'
          ? JSON.parse(req.body.items) as QuotationLineItem[]
          : req.body.items as QuotationLineItem[];
        const vendor = await prisma.vendor.findFirst({
          where: { id: existing.vendorId, projectId },
          include: { materials: true },
        });
        // Auto-register any new materials from the quotation to the vendor
        const vendorMaterialNames = vendor?.materials.map((m) => m.name.toLowerCase()) ?? [];
        const newMaterials = items
          .filter((item) => !vendorMaterialNames.includes(item.materialName.toLowerCase()))
          .map((item) => ({ name: item.materialName, unit: item.unit || null }));
        if (newMaterials.length > 0 && vendor) {
          await prisma.vendorMaterial.createMany({
            data: newMaterials.map((m) => ({
              vendorId: vendor.id,
              name: m.name,
              unit: m.unit,
            })),
          });
          console.log(`[Quotation] Auto-registered ${newMaterials.length} new material(s) for vendor "${vendor.name}"`);
        }
        const itemsWithAmounts = items.map((item) => {
          const amount = item.quantity * item.unitPrice;
          const rate = Number(item.gstRate) || 0;
          return {
            materialName: item.materialName,
            quantity: item.quantity,
            unit: item.unit || null,
            unitPrice: item.unitPrice,
            amount,
            gstRate: rate,
          };
        });
        const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
        const gstAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount) * Number(i.gstRate) / 100, 0);
        updateData.totalAmount = totalAmount;
        updateData.gstAmount = gstAmount;
        updateData.grandTotal = totalAmount + gstAmount;
        await prisma.quotationItem.deleteMany({ where: { quotationId: existing.id } });
        updateData.items = { create: itemsWithAmounts };
      }

      // Handle file upload
      if (req.file) {
        if (!allowedQuotationFileTypes.includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Quotation file must be a PDF or supported image' });
          return;
        }
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `quotations/${subPath}/${existing.quotationNumber}-${req.file.originalname}`;
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

      const updated = await prisma.quotation.update({
        where: { id: existing.id },
        data: updateData,
        include: quotationInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'QUOTATION',
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
  rbacMiddleware(Permission.CREATE_QUOTATION),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
      }
      if (existing.status === QuotationStatus.APPROVED || existing.status === QuotationStatus.CONVERTED_TO_PO) {
        res.status(400).json({ error: 'Cannot delete an approved quotation or one that has been converted to a purchase order' });
        return;
      }

      const storage = getStorageService();
      if (existing.filePath) {
        await storage.deleteFile(existing.filePath).catch(() => {});
      }

      await prisma.quotation.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'QUOTATION',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Quotation deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/approve — approve a quotation (any of 4 heads, in any order)
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotation = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!quotation || !quotation.approvalWorkflow) {
        res.status(404).json({ error: 'Quotation or approval workflow not found' });
        return;
      }

      // Check user is one of the approver roles
      if (!APPROVER_ROLES.some((role) => role === req.user!.role)) {
        res.status(403).json({ error: 'Only heads can approve quotations' });
        return;
      }

      // Find the pending step for this user's role
      const step = quotation.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already approved' });
        return;
      }

      // Check same person hasn't already approved
      const alreadyApproved = quotation.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && s.status === 'APPROVED'
      );
      if (alreadyApproved) {
        res.status(400).json({ error: 'You have already approved this quotation' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      if (result.isFullyApproved) {
        await prisma.quotation.update({
          where: { id: quotation.id },
          data: { status: QuotationStatus.APPROVED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        newValue: { stepId: step.id, comments: req.body.comments, acknowledged: true },
      });

      const updated = await prisma.quotation.findUnique({
        where: { id: quotation.id },
        include: quotationInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/reject — reject a quotation (any of 4 heads, in any order)
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(approvalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotation = await prisma.quotation.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!quotation || !quotation.approvalWorkflow) {
        res.status(404).json({ error: 'Quotation or approval workflow not found' });
        return;
      }

      // Check user is one of the approver roles
      if (!APPROVER_ROLES.some((role) => role === req.user!.role)) {
        res.status(403).json({ error: 'Only heads can reject quotations' });
        return;
      }

      // Find the pending step for this user's role
      const step = quotation.approvalWorkflow.steps.find(
        (s) => s.approverRole === req.user!.role && s.status === 'PENDING'
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role, or you may have already decided' });
        return;
      }

      // Check same person hasn't already decided
      const alreadyDecided = quotation.approvalWorkflow.steps.find(
        (s) => s.approverUserId === req.user!.id && (s.status === 'APPROVED' || s.status === 'REJECTED')
      );
      if (alreadyDecided) {
        res.status(400).json({ error: 'You have already decided on this quotation' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.quotation.update({
          where: { id: quotation.id },
          data: { status: QuotationStatus.REJECTED },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        newValue: { stepId: step.id, reason, acknowledged: true },
      });

      const updated = await prisma.quotation.findUnique({
        where: { id: quotation.id },
        include: quotationInclude,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
