import { Router, Response, NextFunction } from 'express';
import { AuditAction } from '@hospital-erp/shared';
import { listAttachmentsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService } from '../services/storage.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

// GET / — list attachments for a specific entity
router.get(
  '/',
  validateMiddleware(listAttachmentsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { entityType, entityId, fileType } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(fileType ? { fileType } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.attachment.findMany({
          where,
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.attachment.count({ where }),
      ]);

      res.json({ data, total });
    } catch (error) {
      next(error);
    }
  }
);

// POST /upload — multipart file upload linked to any entity
router.post(
  '/upload',
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      if (!req.body.entityType || !req.body.entityId) {
        res.status(400).json({ error: 'entityType and entityId are required' });
        return;
      }

      const isImage = req.file.mimetype.startsWith('image/');
      const bucket = isImage ? 'attachments/images' : 'attachments/documents';

      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, bucket);

      const record = await prisma.attachment.create({
        data: {
          projectId,
          entityType: req.body.entityType,
          entityId: req.body.entityId,
          fileName: req.file.originalname,
          filePath: uploadResult.filePath,
          mimeType: req.file.mimetype,
          fileType: isImage ? 'IMAGE' : 'DOCUMENT',
          description: req.body.description || null,
          uploadedBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'ATTACHMENT',
        entityId: record.id,
        projectId,
        newValue: { fileName: record.fileName, entityType: record.entityType, entityId: record.entityId },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — delete attachment
router.delete(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.attachment.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }

      const storage = getStorageService();
      await storage.deleteFile(existing.filePath).catch(() => {});

      await prisma.attachment.delete({ where: { id: req.params.id } });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'ATTACHMENT',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { fileName: existing.fileName },
      });

      res.json({ message: 'Attachment deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
