import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { createPhotoSchema, listPhotosSchema } from '@hospital-erp/shared';
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
  validateMiddleware(listPhotosSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, phaseId, tag } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        ...(phaseId ? { phaseId } : {}),
        ...(tag ? { tag } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.sitePhoto.findMany({
          where,
          include: {
            phase: { select: { id: true, name: true } },
            activity: { select: { id: true, name: true } },
            uploadedByUser: { select: { id: true, name: true } },
          },
          orderBy: { takenAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.sitePhoto.count({ where }),
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

// POST /upload — multipart upload with file
router.post(
  '/upload',
  rbacMiddleware(Permission.UPLOAD_PHOTOS),
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

      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'photos');
      const filePath = uploadResult.filePath;

      const record = await prisma.sitePhoto.create({
        data: {
          projectId,
          phaseId: req.body.phaseId || null,
          activityId: req.body.activityId || null,
          zone: req.body.zone || null,
          imageUrl: filePath,
          caption: req.body.caption || null,
          takenAt: req.body.takenAt ? new Date(req.body.takenAt) : new Date(),
          tag: req.body.tag || 'DURING',
          uploadedBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'SITE_PHOTO',
        entityId: record.id,
        projectId,
        newValue: { fileName: req.file.originalname, tag: record.tag },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create with existing URL (no file upload)
router.post(
  '/',
  rbacMiddleware(Permission.UPLOAD_PHOTOS),
  validateMiddleware(createPhotoSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      const record = await prisma.sitePhoto.create({
        data: { ...req.body, projectId, uploadedBy: req.user!.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'SITE_PHOTO',
        entityId: record.id,
        projectId,
        newValue: { tag: record.tag },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/:id',
  rbacMiddleware(Permission.UPLOAD_PHOTOS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.sitePhoto.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Photo not found' });
        return;
      }

      const storage = getStorageService();
      await storage.deleteFile(existing.imageUrl).catch(() => {});

      await prisma.sitePhoto.delete({ where: { id: req.params.id } });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'SITE_PHOTO',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { imageUrl: existing.imageUrl },
      });

      res.json({ message: 'Photo deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
