import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import {
  createWorkTaskSchema,
  updateWorkTaskSchema,
  listWorkTasksSchema,
  calendarWorkTasksSchema,
} from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';

const router = Router();

const WORK_TASK_INCLUDE = {
  createdByUser: { select: { id: true, name: true } },
  assignedToUser: { select: { id: true, name: true, role: true } },
  linkedQuotation: {
    select: { id: true, quotationNumber: true, vendor: { select: { id: true, name: true } } },
  },
  linkedPo: {
    select: { id: true, poNumber: true, vendor: { select: { id: true, name: true } } },
  },
};

// GET /calendar — all tasks in [startDate, endDate] for the month grid (no pagination)
router.get(
  '/calendar',
  authMiddleware,
  validateMiddleware(calendarWorkTasksSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { startDate, endDate } = req.query as { startDate: string; endDate: string };
      const tasks = await prisma.workTask.findMany({
        where: {
          projectId,
          deletedAt: null,
          scheduledDate: { gte: new Date(startDate), lte: new Date(endDate) },
        },
        include: WORK_TASK_INCLUDE,
        orderBy: [{ scheduledDate: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      });
      res.json({ data: tasks });
    } catch (error) {
      next(error);
    }
  }
);

// GET /assignable-users — active users for the assign-to dropdown (viewing is open)
router.get(
  '/assignable-users',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const users = await prisma.user.findMany({
        where: { projectId, isActive: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      });
      res.json({ data: users });
    } catch (error) {
      next(error);
    }
  }
);

// GET /linkable-quotations — minimal list for the quotation link dropdown
router.get(
  '/linkable-quotations',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const quotations = await prisma.quotation.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          vendor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      res.json({ data: quotations });
    } catch (error) {
      next(error);
    }
  }
);

// GET /linkable-pos — minimal list for the PO link dropdown
router.get(
  '/linkable-pos',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const purchaseOrders = await prisma.purchaseOrder.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          poNumber: true,
          status: true,
          vendor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      res.json({ data: purchaseOrders });
    } catch (error) {
      next(error);
    }
  }
);

// CRUD (list/get/create/update/delete) — mounted after literal routes so /:id
// does not shadow /calendar, /assignable-users, etc.
router.use(
  '/',
  createCrudRouter({
    entityType: 'WORK_TASK',
    model: 'workTask',
    createPermission: Permission.MANAGE_WORK_TASKS,
    createSchema: createWorkTaskSchema,
    updateSchema: updateWorkTaskSchema,
    listSchema: listWorkTasksSchema,
    searchFields: ['title', 'description'],
    include: WORK_TASK_INCLUDE,
    defaultSort: { scheduledDate: 'asc' },
  })
);

export default router;
