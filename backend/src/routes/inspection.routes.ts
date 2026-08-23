import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { createInspectionSchema, updateInspectionSchema, listInspectionsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { notifyAllHeads } from '../services/push.service';

const router = Router();
router.use(authMiddleware);

router.get(
  '/',
  validateMiddleware(listInspectionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, status } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        deletedAt: null,
        ...(status ? { status } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.inspection.findMany({
          where,
          include: {
            inspector: { select: { id: true, name: true } },
            createdByUser: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.inspection.count({ where }),
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

router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_INSPECTIONS),
  validateMiddleware(createInspectionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      const record = await prisma.inspection.create({
        data: {
          ...req.body,
          projectId,
          inspectorId: req.user!.id,
          createdBy: req.user!.id,
          date: req.body.date ? new Date(req.body.date) : new Date(),
          scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : null,
        },
        include: {
          inspector: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'INSPECTION',
        entityId: record.id,
        projectId,
        newValue: { name: record.name, status: record.status },
      });

      notifyAllHeads(projectId, {
        entityType: 'INSPECTION',
        entityId: record.id,
        title: 'New Inspection Created',
        body: `Inspection "${record.name}" — Status: ${record.status}`,
        url: '/inspections',
      }).catch((err) => console.error('[Push] Inspection notification error:', err));

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_INSPECTIONS),
  validateMiddleware(updateInspectionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.inspection.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Inspection not found' });
        return;
      }

      const updated = await prisma.inspection.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'INSPECTION',
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

router.delete(
  '/:id',
  rbacMiddleware(Permission.MANAGE_INSPECTIONS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.inspection.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Inspection not found' });
        return;
      }

      await prisma.inspection.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'INSPECTION',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { status: existing.status },
      });

      res.json({ message: 'Inspection deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
