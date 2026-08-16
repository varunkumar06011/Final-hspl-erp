import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';

const router = Router();
router.use(authMiddleware);

router.get(
  '/summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const [project, committedAgg, paidAgg, pendingPayments, openIssues, inventoryItems, activePhases] =
        await Promise.all([
          prisma.project.findUnique({
            where: { id: projectId },
            select: { totalBudget: true, name: true, status: true },
          }),
          prisma.purchaseOrder.aggregate({
            where: {
              projectId,
              deletedAt: null,
              status: { in: ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'] },
            },
            _sum: { totalAmount: true },
          }),
          prisma.payment.aggregate({
            where: { paymentRequest: { projectId, deletedAt: null } },
            _sum: { amount: true },
          }),
          prisma.paymentRequest.count({
            where: { projectId, deletedAt: null, status: 'PENDING' },
          }),
          prisma.issue.count({
            where: { projectId, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          }),
          prisma.inventoryItem.findMany({
            where: { projectId, deletedAt: null },
            select: { currentStock: true, minStockLevel: true },
          }),
          prisma.phase.count({
            where: { projectId, deletedAt: null, status: 'IN_PROGRESS' },
          }),
        ]);

      const lowStock = inventoryItems.filter(
        (i) => Number(i.currentStock) <= Number(i.minStockLevel)
      ).length;

      const totalBudget = Number(project?.totalBudget ?? 0);
      const committed = Number(committedAgg._sum.totalAmount ?? 0);
      const paid = Number(paidAgg._sum.amount ?? 0);

      res.json({
        project: project ?? null,
        totalBudget,
        committed,
        paid,
        remaining: totalBudget - committed,
        pendingPayments,
        openIssues,
        lowStockItems: lowStock,
        activePhases,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
