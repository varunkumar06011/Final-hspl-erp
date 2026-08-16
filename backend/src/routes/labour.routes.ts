import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import { createLabourAttendanceSchema, listLabourSchema, updateLabourSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

router.get(
  '/',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(listLabourSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, phaseId, category, startDate, endDate } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        ...(phaseId ? { phaseId } : {}),
        ...(category ? { category } : {}),
      };
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: new Date(String(startDate)) } : {}),
          ...(endDate ? { lte: new Date(String(endDate)) } : {}),
        };
      }

      const [data, total] = await Promise.all([
        prisma.labourAttendance.findMany({
          where,
          include: {
            phase: { select: { id: true, name: true } },
            activity: { select: { id: true, name: true } },
            supervisor: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.labourAttendance.count({ where }),
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
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(createLabourAttendanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      const record = await prisma.labourAttendance.create({
        data: { ...req.body, projectId, supervisorId: req.user!.id },
        include: {
          phase: { select: { id: true, name: true } },
          supervisor: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'LABOUR_ATTENDANCE',
        entityId: record.id,
        projectId,
        newValue: { date: record.date, headcount: record.headcount, category: record.category },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(updateLabourSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.labourAttendance.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Labour attendance record not found' });
        return;
      }

      const updated = await prisma.labourAttendance.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'LABOUR_ATTENDANCE',
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
  rbacMiddleware(Permission.MANAGE_LABOUR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.labourAttendance.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Labour attendance record not found' });
        return;
      }

      await prisma.labourAttendance.delete({ where: { id: req.params.id } });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'LABOUR_ATTENDANCE',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { date: existing.date, headcount: existing.headcount },
      });

      res.json({ message: 'Labour attendance record deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
