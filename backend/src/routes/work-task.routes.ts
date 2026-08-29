import { Router, Response, NextFunction } from 'express';
import { Permission, WorkTaskStatus, AuditAction } from '@hospital-erp/shared';
import {
  createWorkTaskSchema,
  updateWorkTaskSchema,
  listWorkTasksSchema,
  calendarWorkTasksSchema,
  generateWorkTaskQuotationSchema,
} from '@hospital-erp/shared';
import { createCrudRouter } from '../utils/crudFactory';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { createQuotation, type QuotationLineItem } from '../services/quotation.service';

const router = Router();

const WORK_TASK_INCLUDE = {
  createdByUser: { select: { id: true, name: true } },
  assignedToUser: { select: { id: true, name: true, role: true } },
  linkedQuotation: {
    select: { id: true, quotationNumber: true, status: true, vendor: { select: { id: true, name: true } } },
  },
  linkedPo: {
    select: { id: true, poNumber: true, vendor: { select: { id: true, name: true } } },
  },
  quotations: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      quotation: {
        select: {
          id: true,
          quotationNumber: true,
          status: true,
          grandTotal: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
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

// POST /:id/generate-quotation — create a quotation from a work task and link
// it. A work task may accumulate multiple quotations over time (e.g. re-quote
// with a different vendor); the latest one is also mirrored onto
// linkedQuotationId so the Work Calendar view keeps working unchanged.
router.post(
  '/:id/generate-quotation',
  rbacMiddleware(Permission.CREATE_QUOTATION),
  validateMiddleware(generateWorkTaskQuotationSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const workTask = await prisma.workTask.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!workTask) {
        res.status(404).json({ error: 'Work task not found' });
        return;
      }

      const items = req.body.items as QuotationLineItem[];
      const quotation = await createQuotation({
        projectId,
        vendorId: req.body.vendorId,
        items,
        createdBy: req.user!.id,
      });

      // Link the quotation to the work task (join row + latest pointer) and
      // advance the work task into IN_PROGRESS if it was still only planned.
      await prisma.workTaskQuotation.create({
        data: {
          workTaskId: workTask.id,
          quotationId: quotation.id,
          createdBy: req.user!.id,
        },
      });
      const statusPatch =
        workTask.status === WorkTaskStatus.PLANNED ? { status: WorkTaskStatus.IN_PROGRESS } : {};
      await prisma.workTask.update({
        where: { id: workTask.id },
        data: { linkedQuotationId: quotation.id, ...statusPatch },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'WORK_TASK',
        entityId: workTask.id,
        projectId,
        newValue: { generatedQuotationId: quotation.id, quotationNumber: quotation.quotationNumber },
      });

      res.status(201).json(quotation);
    } catch (error) {
      if (error instanceof Error && error.message === 'Vendor not found') {
        res.status(400).json({ error: error.message });
        return;
      }
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
