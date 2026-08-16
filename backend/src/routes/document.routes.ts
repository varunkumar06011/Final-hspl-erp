import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { createDocumentSchema, updateDocumentSchema, listDocumentsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService } from '../services/storage.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

router.get(
  '/',
  validateMiddleware(listDocumentsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, entityType, entityId, fileType } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(fileType ? { fileType } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.document.findMany({
          where,
          include: { uploadedByUser: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.document.count({ where }),
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

// POST /upload — multipart file upload
router.post(
  '/upload',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      if (!req.body.entityId) {
        res.status(400).json({ error: 'entityId is required' });
        return;
      }

      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'documents');
      const filePath = uploadResult.filePath;

      const record = await prisma.document.create({
        data: {
          projectId,
          entityType: req.body.entityType || 'MISC',
          entityId: req.body.entityId,
          fileName: req.file.originalname,
          filePath,
          fileType: req.body.fileType || 'MISC',
          mimeType: req.file.mimetype,
          uploadedBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'DOCUMENT',
        entityId: record.id,
        projectId,
        newValue: { fileName: record.fileName, fileType: record.fileType },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — register document with existing path
router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  validateMiddleware(createDocumentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      const record = await prisma.document.create({
        data: { ...req.body, projectId, uploadedBy: req.user!.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'DOCUMENT',
        entityId: record.id,
        projectId,
        newValue: { fileName: record.fileName },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  validateMiddleware(updateDocumentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.document.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      const updated = await prisma.document.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'DOCUMENT',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        newValue: req.body,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
