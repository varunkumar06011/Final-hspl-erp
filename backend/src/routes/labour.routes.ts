import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import {
  createStaffSchema,
  updateStaffSchema,
  listStaffSchema,
  markAttendanceSchema,
  listAttendanceSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

// ═══ Staff CRUD ═══

// GET /staff — list staff
router.get(
  '/staff',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(listStaffSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 20, type, active } = req.query as Record<string, string>;
      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (type) where.type = type;
      if (active !== undefined) where.active = active === 'true';

      const [data, total] = await Promise.all([
        prisma.staff.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.staff.count({ where }),
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

// POST /staff — create staff
router.post(
  '/staff',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(createStaffSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.staff.create({
        data: { ...req.body, projectId },
      });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'STAFF',
        entityId: record.id,
        projectId,
        newValue: { name: record.name, type: record.type, baseSalary: record.baseSalary },
      });
      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /staff/:id — update staff
router.patch(
  '/staff/:id',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(updateStaffSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.staff.findFirst({ where: { id: req.params.id, projectId, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Staff not found' });
        return;
      }
      const updated = await prisma.staff.update({ where: { id: req.params.id }, data: req.body });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'STAFF',
        entityId: req.params.id,
        projectId,
        newValue: req.body,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /staff/:id — soft delete
router.delete(
  '/staff/:id',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.staff.findFirst({ where: { id: req.params.id, projectId, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Staff not found' });
        return;
      }
      await prisma.staff.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'STAFF',
        entityId: req.params.id,
        projectId,
      });
      res.json({ message: 'Staff deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// ═══ Attendance ═══

// POST /attendance — mark daily attendance (batch)
router.post(
  '/attendance',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(markAttendanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { date, records } = req.body;
      const dateObj = new Date(date);

      // Verify all staff belong to the project
      const staffIds = records.map((r: { staffId: string }) => r.staffId);
      const staffCount = await prisma.staff.count({
        where: { id: { in: staffIds }, projectId, deletedAt: null },
      });
      if (staffCount !== staffIds.length) {
        res.status(400).json({ error: 'One or more staff members not found in this project' });
        return;
      }

      // Upsert attendance records (unique on staffId + date)
      const results = [];
      for (const record of records) {
        const existing = await prisma.staffAttendance.findUnique({
          where: { staffId_date: { staffId: record.staffId, date: dateObj } },
        });
        if (existing) {
          const updated = await prisma.staffAttendance.update({
            where: { id: existing.id },
            data: { present: record.present, notes: record.notes ?? null, markedBy: req.user!.id },
          });
          results.push(updated);
        } else {
          const created = await prisma.staffAttendance.create({
            data: {
              staffId: record.staffId,
              date: dateObj,
              present: record.present,
              notes: record.notes ?? null,
              markedBy: req.user!.id,
            },
          });
          results.push(created);
        }
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'STAFF_ATTENDANCE',
        entityId: results[0]?.id ?? dateObj.toISOString(),
        projectId,
        newValue: { date: dateObj.toISOString().slice(0, 10), count: results.length },
      });

      res.status(201).json({ data: results, count: results.length });
    } catch (error) {
      next(error);
    }
  }
);

// GET /attendance — list attendance records
router.get(
  '/attendance',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  validateMiddleware(listAttendanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 50, staffId, type, startDate, endDate } = req.query as Record<string, string>;

      const where: Record<string, unknown> = { staff: { projectId, deletedAt: null } };
      if (staffId) where.staffId = staffId;
      if (type) where.staff = { projectId, deletedAt: null, type };
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        };
      }

      const [data, total] = await Promise.all([
        prisma.staffAttendance.findMany({
          where,
          include: {
            staff: { select: { id: true, name: true, type: true, role: true, baseSalary: true } },
            marker: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.staffAttendance.count({ where }),
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

// GET /attendance/summary — attendance summary for a date range
router.get(
  '/attendance/summary',
  rbacMiddleware(Permission.MANAGE_LABOUR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { startDate, endDate, type } = req.query as Record<string, string>;
      const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1));
      const end = endDate ? new Date(endDate) : new Date();

      const staffWhere: Record<string, unknown> = { projectId, deletedAt: null };
      if (type) staffWhere.type = type;

      const staff = await prisma.staff.findMany({
        where: staffWhere,
        include: {
          attendance: {
            where: { date: { gte: start, lte: end } },
            orderBy: { date: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      const summary = staff.map((s) => {
        const presentDays = s.attendance.filter((a) => a.present).length;
        const absentDays = s.attendance.filter((a) => !a.present).length;
        const totalDays = s.attendance.length;
        const salaryForPeriod = Number(s.baseSalary) * (totalDays > 0 ? presentDays / totalDays : 0);
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          role: s.role,
          baseSalary: Number(s.baseSalary),
          presentDays,
          absentDays,
          totalDays,
          salaryForPeriod,
        };
      });

      res.json({ data: summary, period: { start, end } });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
