import { Response, NextFunction } from 'express';
import { Permission, AuditAction, IssueStatus } from '@hospital-erp/shared';
import { createIssueSchema, updateIssueSchema, listIssuesSchema } from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { notifyAllHeads } from '../services/push.service';
import { prisma } from '../config/prisma';
import { AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { logAudit } from '../services/audit.service';
import { getStorageService, serveFile } from '../services/storage.service';
import multer from 'multer';

const router = createCrudRouter({
  entityType: 'ISSUE',
  model: 'issue',
  createPermission: Permission.MANAGE_ISSUES,
  createSchema: createIssueSchema,
  updateSchema: updateIssueSchema,
  listSchema: listIssuesSchema,
  searchFields: ['title', 'description'],
  include: {
    createdByUser: { select: { id: true, name: true } },
    closedByUser: { select: { id: true, name: true } },
  },
  afterCreate: async (record, _userId, projectId) => {
    await notifyAllHeads(projectId, {
      entityType: 'ISSUE',
      entityId: record.id as string,
      title: 'New Issue Reported',
      body: `${record.title}${record.priority ? ` — Priority: ${record.priority}` : ''}`,
      url: '/issues',
    });
  },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /:id/close — close an issue with optional photo proof
router.post(
  '/:id/close',
  rbacMiddleware(Permission.MANAGE_ISSUES),
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.issue.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      if (existing.status === IssueStatus.CLOSED) {
        res.status(400).json({ error: 'Issue is already closed' });
        return;
      }

      // Validate body manually (multipart form-data bypasses JSON schema middleware)
      const closureNotes = req.body.closureNotes
        ? String(req.body.closureNotes).trim().slice(0, 2000)
        : null;

      let closurePhotoUrl: string | null = null;
      if (req.file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
          res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed' });
          return;
        }
        const storage = getStorageService();
        const uploadResult = await storage.upload(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
          'issues'
        );
        closurePhotoUrl = uploadResult.filePath;
      }

      const updated = await prisma.issue.update({
        where: { id: req.params.id },
        data: {
          status: IssueStatus.CLOSED,
          closedAt: new Date(),
          closedBy: req.user!.id,
          closurePhotoUrl,
          closureNotes,
        },
        include: {
          createdByUser: { select: { id: true, name: true } },
          closedByUser: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ISSUE',
        entityId: req.params.id,
        projectId,
        oldValue: { status: existing.status },
        newValue: { status: updated.status, closedBy: req.user!.id },
      });

      notifyAllHeads(projectId, {
        entityType: 'ISSUE',
        entityId: updated.id,
        title: 'Issue Closed',
        body: `${updated.title}${closurePhotoUrl ? ' — with photo proof' : ''}`,
        url: '/issues',
      }).catch((err) => console.error('[Push] Issue close notification error:', err));

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/closure-photo — serve the closure photo file
router.get(
  '/:id/closure-photo',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.issue.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      if (!existing.closurePhotoUrl) {
        res.status(404).json({ error: 'No closure photo attached' });
        return;
      }
      await serveFile(res, existing.closurePhotoUrl, 'image/jpeg');
    } catch (error) {
      next(error);
    }
  }
);

export default router;
