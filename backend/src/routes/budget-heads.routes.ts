import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction } from '@hospital-erp/shared';
import {
  createBudgetHeadSchema,
  updateBudgetHeadSchema,
  listBudgetHeadsSchema,
  importBudgetSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

// ── Base CRUD via factory ──
const crudRouter = createCrudRouter({
  entityType: 'BUDGET_HEAD',
  model: 'budgetHead',
  createPermission: Permission.MANAGE_FINANCE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createBudgetHeadSchema,
  updateSchema: updateBudgetHeadSchema,
  listSchema: listBudgetHeadsSchema,
  searchFields: ['particulars'],
  defaultSort: { slNo: 'asc' },
  transformCreate: async (body, _userId, projectId) => ({
    projectId,
    slNo: body.slNo as number,
    particulars: body.particulars as string,
    allocatedAmount: body.allocatedAmount as number,
  }),
  transformUpdate: async (body) => {
    const data: Record<string, unknown> = {};
    for (const key of ['slNo', 'particulars', 'allocatedAmount', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    return data;
  },
});

const router = Router();
router.use(authMiddleware);
router.use(crudRouter);

// ── Import budget from JSON (draft budget format) ──
// Body: { items: [{ sl_no, particulars, amount }] }
router.post(
  '/import',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(importBudgetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const items = req.body.items as Array<{ sl_no: number; particulars: string; amount: number }>;

      // Replace existing budget heads for this project (within a transaction)
      const result = await prisma.$transaction(async (tx) => {
        // Soft-delete existing heads
        await tx.budgetHead.updateMany({
          where: { projectId, deletedAt: null },
          data: { deletedAt: new Date() },
        });

        // Create new heads
        const created = await Promise.all(
          items.map((item) =>
            tx.budgetHead.create({
              data: {
                projectId,
                slNo: item.sl_no,
                particulars: item.particulars,
                allocatedAmount: item.amount,
              },
            }),
          ),
        );

        return created;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BUDGET_HEAD',
        entityId: projectId, // project-level import
        projectId,
        newValue: { importedCount: result.length },
      });

      res.status(201).json({ imported: result.length, budgetHeads: result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Budget summary: total allocated, committed, actual, paid, available ──
router.get(
  '/summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const heads = await prisma.budgetHead.findMany({
        where: { projectId, deletedAt: null },
        select: {
          allocatedAmount: true,
          committedAmount: true,
          actualAmount: true,
          paidAmount: true,
        },
      });

      const sum = (field: 'allocatedAmount' | 'committedAmount' | 'actualAmount' | 'paidAmount') =>
        heads.reduce((acc, h) => acc + Number(h[field]), 0);

      const totalAllocated = sum('allocatedAmount');
      const totalCommitted = sum('committedAmount');
      const totalActual = sum('actualAmount');
      const totalPaid = sum('paidAmount');

      res.json({
        totalAllocated,
        totalCommitted,
        totalActual,
        totalPaid,
        totalAvailable: totalAllocated - totalActual,
        headCount: heads.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Budget head breakdown: what transactions make up spent amounts ──
router.get(
  '/:id/breakdown',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const head = await prisma.budgetHead.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!head) {
        res.status(404).json({ error: 'Budget head not found' });
        return;
      }

      // Phase 3 will populate this with PO/invoice/payment/JV breakdowns.
      // For now, return the cached amounts and a placeholder.
      res.json({
        budgetHead: {
          id: head.id,
          particulars: head.particulars,
          allocatedAmount: Number(head.allocatedAmount),
          committedAmount: Number(head.committedAmount),
          actualAmount: Number(head.actualAmount),
          paidAmount: Number(head.paidAmount),
          available: Number(head.allocatedAmount) - Number(head.actualAmount),
        },
        transactions: [],
        message: 'Detailed breakdown available after Phase 3 cost tagging',
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
