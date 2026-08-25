import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { listDocumentsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService, serveFile } from '../services/storage.service';
import { notifyAllHeads } from '../services/push.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

router.get(
  '/',
  validateMiddleware(listDocumentsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20 } = req.query as Record<string, unknown>;
      const where = { projectId: requireProjectId(req), deletedAt: null };

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

// POST /upload — multipart file upload with name, description, resolveTo
router.post(
  '/upload',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      const allowedMimeTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/tiff',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'Unsupported document file type' });
        return;
      }
      if (!String(req.body.name ?? '').trim()) {
        res.status(400).json({ error: 'Document name is required' });
        return;
      }
      const resolveTo = req.body.resolveTo ? JSON.parse(String(req.body.resolveTo)) : [];
      if (!Array.isArray(resolveTo) || resolveTo.length === 0) {
        res.status(400).json({ error: 'Select at least one person to resolve to' });
        return;
      }

      const storage = getStorageService();
      const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'documents');
      const filePath = uploadResult.filePath;

      const record = await prisma.document.create({
        data: {
          projectId,
          name: String(req.body.name),
          description: req.body.description ? String(req.body.description) : null,
          resolveTo,
          fileName: req.file.originalname,
          filePath,
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
        newValue: { name: record.name, fileName: record.fileName },
      });

      notifyAllHeads(projectId, {
        entityType: 'DOCUMENT',
        entityId: record.id,
        title: 'New Document Uploaded',
        body: `"${record.name}" — ${record.fileName}`,
        url: '/documents',
      }).catch((err) => console.error('[Push] Document notification error:', err));

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/file — serve the document file
router.get(
  '/:id/file',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.document.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      if (!existing.filePath) {
        res.status(404).json({ error: 'No file attached' });
        return;
      }
      await serveFile(res, existing.filePath, existing.mimeType);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete
router.delete(
  '/:id',
  rbacMiddleware(Permission.MANAGE_DOCUMENTS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.document.findFirst({ where: { id: req.params.id, projectId, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const storage = getStorageService();
      await storage.deleteFile(existing.filePath).catch(() => {});

      await prisma.document.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'DOCUMENT',
        entityId: req.params.id,
        projectId,
      });
      res.json({ message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
