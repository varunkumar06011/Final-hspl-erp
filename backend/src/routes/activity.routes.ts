import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { createActivitySchema, updateActivitySchema, listActivitiesSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

router.get(
  '/',
  validateMiddleware(listActivitiesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        deletedAt: null,
        phase: { projectId: req.user!.projectId },
      };
      if (search) {
        where.OR = [
          { name: { contains: String(search), mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.activity.findMany({
          where,
          include: {
            phase: { select: { id: true, name: true } },
            assignedVendor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.activity.count({ where }),
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
  rbacMiddleware(Permission.MANAGE_ACTIVITIES),
  validateMiddleware(createActivitySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const phase = await prisma.phase.findFirst({
        where: { id: req.body.phaseId, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!phase) {
        res.status(404).json({ error: 'Phase not found in your project' });
        return;
      }

      const record = await prisma.activity.create({
        data: { ...req.body, createdBy: req.user!.id },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'ACTIVITY',
        entityId: record.id,
        projectId: req.user!.projectId,
        newValue: { name: record.name, phaseId: record.phaseId },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_ACTIVITIES),
  validateMiddleware(updateActivitySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.activity.findFirst({
        where: { id: req.params.id, deletedAt: null, phase: { projectId: requireProjectId(req) } },
      });
      if (!existing) {
        res.status(404).json({ error: 'Activity not found' });
        return;
      }

      const updated = await prisma.activity.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ACTIVITY',
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
  rbacMiddleware(Permission.MANAGE_ACTIVITIES),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.activity.findFirst({
        where: { id: req.params.id, deletedAt: null, phase: { projectId: requireProjectId(req) } },
      });
      if (!existing) {
        res.status(404).json({ error: 'Activity not found' });
        return;
      }

      await prisma.activity.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'ACTIVITY',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { name: existing.name },
      });

      res.json({ message: 'Activity deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
