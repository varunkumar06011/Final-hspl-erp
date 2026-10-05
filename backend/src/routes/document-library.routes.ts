import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { Permission, AuditAction, listDocumentLibrarySchema, searchLibraryTargetsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService } from '../services/storage.service';
import { isAllowedUpload, ALLOWED_UPLOAD_MESSAGE } from '../utils/uploadFileTypes';
import {
  LIBRARY_CATEGORIES,
  UPLOAD_TARGETS,
  LibraryCategory,
  attachmentTypeFor,
  linkTargetExists,
  listLibrary,
  searchLinkTargets,
} from '../services/document-library.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);
router.use(rbacMiddleware(Permission.MANAGE_DOCUMENTS));

// GET / — every uploaded file in the project, with the record it belongs to
router.get(
  '/',
  validateMiddleware(listDocumentLibrarySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const page = Number(q.page ?? 1);
      const pageSize = Number(q.pageSize ?? 20);
      const to = q.to ? new Date(q.to) : undefined;
      if (to) to.setHours(23, 59, 59, 999);

      const items = await listLibrary(requireProjectId(req), req.user!.role, {
        category: q.category,
        fileType: q.fileType,
        uploadedBy: q.uploadedBy,
        search: q.search,
        from: q.from ? new Date(q.from) : undefined,
        to,
      });

      res.json({
        data: items.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: items.length, totalPages: Math.ceil(items.length / pageSize) },
        categories: LIBRARY_CATEGORIES,
        uploadTargets: UPLOAD_TARGETS,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /targets — records a file can be attached to (picker in the upload dialog)
router.get(
  '/targets',
  validateMiddleware(searchLibraryTargetsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { category, q } = req.query as { category: string; q?: string };
      const data = await searchLinkTargets(requireProjectId(req), req.user!.role, category, q ?? '');
      if (!data) {
        res.status(400).json({ error: 'Unsupported record type' });
        return;
      }
      res.json({ data });
    } catch (error) {
      next(error);
    }
  }
);

/** Cleaned display name; keeps the original extension when the new name has none. */
function cleanFileName(input: unknown, original: string): string | null {
  const name = String(input ?? '')
    .replace(/[\\/\x00-\x1f]/g, ' ')
    .trim()
    .slice(0, 200);
  if (!name) return null;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(original)?.[0] ?? '';
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name;
}

// PATCH /rename — change the name shown for an uploaded file (not the stored copy)
router.patch('/rename', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const { source, id } = req.body as { source?: string; id?: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || (source !== 'ATTACHMENT' && source !== 'DOCUMENT')) {
      res.status(400).json({ error: 'Invalid file' });
      return;
    }

    if (source === 'ATTACHMENT') {
      const existing = await prisma.attachment.findFirst({ where: { id, projectId } });
      const fileName = existing && cleanFileName(req.body.fileName, existing.fileName);
      if (!existing) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      if (!fileName) {
        res.status(400).json({ error: 'File name is required' });
        return;
      }
      await prisma.attachment.update({ where: { id }, data: { fileName } });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ATTACHMENT',
        entityId: id,
        projectId,
        oldValue: { fileName: existing.fileName },
        newValue: { fileName },
      });
      res.json({ fileName });
      return;
    }

    const existing = await prisma.document.findFirst({ where: { id, projectId, deletedAt: null } });
    const fileName = existing && cleanFileName(req.body.fileName, existing.fileName);
    if (!existing) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    if (!fileName) {
      res.status(400).json({ error: 'File name is required' });
      return;
    }
    await prisma.document.update({ where: { id }, data: { fileName, name: fileName } });
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'DOCUMENT',
      entityId: id,
      projectId,
      oldValue: { fileName: existing.fileName },
      newValue: { fileName },
    });
    res.json({ fileName });
  } catch (error) {
    next(error);
  }
});

// POST /upload — upload a file, optionally linked to a record
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
      if (!isAllowedUpload(req.file)) {
        res.status(400).json({ error: ALLOWED_UPLOAD_MESSAGE });
        return;
      }
      const category = String(req.body.category ?? '');
      const entityId = String(req.body.entityId ?? '');
      const description = req.body.description ? String(req.body.description).slice(0, 500) : null;
      const displayName = cleanFileName(req.body.fileName, req.file.originalname) ?? req.file.originalname;

      // No record picked: keep it as a general document (floor plans, drawings, ...).
      if (!entityId) {
        const storage = getStorageService();
        const uploaded = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'documents');
        const doc = await prisma.document.create({
          data: {
            projectId,
            name: displayName,
            description,
            resolveTo: [],
            fileName: displayName,
            filePath: uploaded.filePath,
            mimeType: req.file.mimetype,
            uploadedBy: req.user!.id,
          },
        });
        await logAudit({
          userId: req.user!.id,
          action: AuditAction.CREATE,
          entityType: 'DOCUMENT',
          entityId: doc.id,
          projectId,
          newValue: { fileName: doc.fileName },
        });
        res.status(201).json(doc);
        return;
      }

      const entityType = UPLOAD_TARGETS.includes(category as LibraryCategory)
        ? attachmentTypeFor(category as LibraryCategory)
        : undefined;
      if (!entityType || !/^[0-9a-f-]{36}$/i.test(entityId)) {
        res.status(400).json({ error: 'Invalid record' });
        return;
      }
      if (!(await linkTargetExists(projectId, req.user!.role, category, entityId))) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }

      const isImage = req.file.mimetype.startsWith('image/');
      const storage = getStorageService();
      const uploadResult = await storage.upload(
        req.file.buffer,
        `${isImage ? 'images' : 'documents'}/${req.file.originalname}`,
        req.file.mimetype,
        'attachments'
      );

      const record = await prisma.attachment.create({
        data: {
          projectId,
          entityType,
          entityId,
          fileName: displayName,
          filePath: uploadResult.filePath,
          mimeType: req.file.mimetype,
          fileType: isImage ? 'IMAGE' : 'DOCUMENT',
          description,
          uploadedBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'ATTACHMENT',
        entityId: record.id,
        projectId,
        newValue: { fileName: record.fileName, entityType, entityId },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
