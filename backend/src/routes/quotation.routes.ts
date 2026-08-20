import { Router, Response, NextFunction } from 'express';
import { APPROVAL_CONFIG, Permission, QuotationStatus, AuditAction } from '@hospital-erp/shared';
import { createQuotationSchema, listQuotationsSchema, approvalActionSchema } from '@hospital-erp/shared';
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

interface QuotationLineItem {
  materialName: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
}

async function generateQuotationNumber(projectId: string): Promise<string> {
  const quotations = await prisma.quotation.findMany({
    where: { projectId, quotationNumber: { startsWith: 'VGH-Q' } },
    select: { quotationNumber: true },
  });
  const maxNum = quotations.reduce((max, q) => {
    const match = q.quotationNumber?.match(/^VGH-Q(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-Q${String(maxNum + 1).padStart(3, '0')}`;
}

const quotationInclude = {
  vendor: { select: { id: true, name: true, vendorCode: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  approvalWorkflow: { include: { steps: { orderBy: { stepNumber: 'asc' as const }, include: { approverUser: { select: { id: true, name: true, role: true } } } } } },
};

// GET / — list quotations
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listQuotationsSchema),
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
      const gstAmount = Number(req.body.gstAmount) || 0;

      // Validate vendor exists and belongs to project
      const vendor = await prisma.vendor.findFirst({
        where: { id: vendorId, projectId, deletedAt: null },
        include: { materials: true },
      });
      if (!vendor) {
        res.status(400).json({ error: 'Vendor not found' });
        return;
      }

      // Validate each material exists in vendor's materials
      const vendorMaterialNames = vendor.materials.map((m) => m.name.toLowerCase());
      for (const item of items) {
        if (!vendorMaterialNames.includes(item.materialName.toLowerCase())) {
          res.status(400).json({
            error: `Material "${item.materialName}" is not supplied by vendor "${vendor.name}". Only materials registered for this vendor can be added.`,
          });
          return;
        }
      }

      // Calculate totals
      const itemsWithAmounts = items.map((item) => ({
        materialName: item.materialName,
        quantity: item.quantity,
        unit: item.unit || null,
        unitPrice: item.unitPrice,
        amount: item.quantity * item.unitPrice,
      }));
      const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
      const grandTotal = totalAmount + gstAmount;

      const quotationNumber = await generateQuotationNumber(projectId);

      // Handle file upload
      let filePath: string | null = null;
      let fileName: string | null = null;
      let fileMimeType: string | null = null;
      if (req.file) {
        const isImage = req.file.mimetype.startsWith('image/');
        const subPath = isImage ? 'images' : 'documents';
        const prefixedFileName = `quotations/${subPath}/${quotationNumber}-${req.file.originalname}`;
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, prefixedFileName, req.file.mimetype, 'documents');
        filePath = uploadResult.filePath;
        fileName = req.file.originalname;
        fileMimeType = req.file.mimetype;
      }

      // Create quotation
      const quotation = await prisma.quotation.create({
        data: {
          projectId,
          vendorId,
          quotationNumber,
          status: QuotationStatus.SUBMITTED,
          totalAmount,
          gstAmount,
          grandTotal,
          filePath,
          fileName,
          fileMimeType,
          createdBy: req.user!.id,
          items: { create: itemsWithAmounts },
        },
        include: quotationInclude,
      });

      // Initiate approval workflow
      const workflow = await approvalService.initiate({
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        minApprovers: APPROVAL_CONFIG.MIN_APPROVERS,
      });

      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { approvalWorkflowId: workflow.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'QUOTATION',
        entityId: quotation.id,
        projectId,
        newValue: { quotationNumber, vendorId, totalAmount, grandTotal, acknowledged: true },
      });

      const result = await prisma.quotation.findUnique({
        where: { id: quotation.id },
        include: quotationInclude,
      });

      res.status(201).json(result);
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
        const vendorMaterialNames = vendor?.materials.map((m) => m.name.toLowerCase()) ?? [];
        for (const item of items) {
          if (!vendorMaterialNames.includes(item.materialName.toLowerCase())) {
            res.status(400).json({ error: `Material "${item.materialName}" is not supplied by this vendor.` });
            return;
          }
        }
        const itemsWithAmounts = items.map((item) => ({
          materialName: item.materialName,
          quantity: item.quantity,
          unit: item.unit || null,
          unitPrice: item.unitPrice,
          amount: item.quantity * item.unitPrice,
        }));
        const totalAmount = itemsWithAmounts.reduce((sum, i) => sum + Number(i.amount), 0);
        const gstAmount = req.body.gstAmount ? Number(req.body.gstAmount) : Number(existing.gstAmount);
        updateData.totalAmount = totalAmount;
        updateData.gstAmount = gstAmount;
        updateData.grandTotal = totalAmount + gstAmount;
        await prisma.quotationItem.deleteMany({ where: { quotationId: existing.id } });
        updateData.items = { create: itemsWithAmounts };
      } else if (req.body.gstAmount !== undefined) {
        const gstAmount = Number(req.body.gstAmount);
        updateData.gstAmount = gstAmount;
        updateData.grandTotal = Number(existing.totalAmount) + gstAmount;
      }

      // Handle file upload
      if (req.file) {
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

// POST /:id/approve/:stepId — approve a step
router.post(
  '/:id/approve/:stepId',
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

      const step = quotation.approvalWorkflow.steps.find((candidate) => candidate.id === req.params.stepId);
      if (!step || step.approverRole !== req.user!.role) {
        res.status(403).json({ error: 'This approval step is not assigned to you' });
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
        newValue: { stepId: req.params.stepId, comments: req.body.comments, acknowledged: true },
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

// POST /:id/reject/:stepId — reject a step
router.post(
  '/:id/reject/:stepId',
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

      const step = quotation.approvalWorkflow.steps.find((candidate) => candidate.id === req.params.stepId);
      if (!step || step.approverRole !== req.user!.role) {
        res.status(403).json({ error: 'This rejection step is not assigned to you' });
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
        newValue: { stepId: req.params.stepId, reason, acknowledged: true },
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
