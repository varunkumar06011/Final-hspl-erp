import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';

const router = Router();
router.use(authMiddleware);

// GET / — payment report with filters + summary totals
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const {
        page = '1',
        pageSize = '50',
        startDate,
        endDate,
        vendorId,
        budgetHeadId,
        type,
        status,
        paymentMode,
        minAmount,
        maxAmount,
        search,
      } = req.query as Record<string, string>;

      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 50;

      const where: Record<string, unknown> = { projectId, deletedAt: null };

      if (status) where.status = status;
      if (vendorId) where.vendorId = vendorId;
      if (budgetHeadId) where.budgetHeadId = budgetHeadId;
      if (type) where.type = type;

      // Date range — uses expenseDate if available, falls back to createdAt
      if (startDate || endDate) {
        const dateFilter: Record<string, Date> = {};
        if (startDate) dateFilter.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          dateFilter.lte = end;
        }
        where.OR = [
          { expenseDate: dateFilter },
          { expenseDate: null, createdAt: dateFilter },
        ];
      }

      // Amount range
      if (minAmount || maxAmount) {
        const range: Record<string, number> = {};
        if (minAmount) range.gte = Number(minAmount);
        if (maxAmount) range.lte = Number(maxAmount);
        where.amount = range;
      }

      // Search
      if (search) {
        where.OR = [
          { paymentCode: { contains: search, mode: 'insensitive' } },
          { requestNumber: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { vendor: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      // Payment mode filter — check the payments relation
      if (paymentMode) {
        where.payments = { some: { mode: paymentMode } };
      }

      const include = {
        vendor: { select: { id: true, name: true, vendorCode: true } },
        invoice: { select: { id: true, invoiceCode: true, invoiceNumber: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        budgetHead: { select: { id: true, particulars: true } },
        createdByUser: { select: { id: true, name: true } },
        payments: {
          select: {
            id: true,
            amount: true,
            mode: true,
            reference: true,
            date: true,
            bankAccount: { select: { id: true, accountName: true } },
            cashAccount: { select: { id: true, name: true } },
          },
        },
        approvalWorkflow: {
          select: {
            id: true,
            status: true,
            steps: {
              where: { status: 'APPROVED' },
              select: { approverUser: { select: { name: true } } },
            },
          },
        },
      };

      const [data, total] = await Promise.all([
        prisma.paymentRequest.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.paymentRequest.count({ where }),
      ]);

      // ── Summary totals (computed on the full filtered set, not just the page) ──
      const allRecords = await prisma.paymentRequest.findMany({
        where,
        select: {
          amount: true,
          status: true,
          type: true,
          budgetHeadId: true,
          vendorId: true,
          budgetHead: { select: { particulars: true } },
          vendor: { select: { name: true } },
        },
      });

      const totalPaid = allRecords
        .filter((r) => r.status === 'PAID')
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const totalPending = allRecords
        .filter((r) => r.status === 'PENDING')
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const totalApproved = allRecords
        .filter((r) => r.status === 'APPROVED')
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const totalAdvance = allRecords
        .filter((r) => r.type === 'ADVANCE')
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const totalInvoice = allRecords
        .filter((r) => r.type === 'INVOICE')
        .reduce((sum, r) => sum + Number(r.amount), 0);
      const totalExpense = allRecords
        .filter((r) => r.type === 'EXPENSE')
        .reduce((sum, r) => sum + Number(r.amount), 0);

      // By budget head
      const byBudgetHead = new Map<string, number>();
      for (const r of allRecords) {
        if (r.status === 'PAID') {
          const key = r.budgetHead?.particulars ?? 'Unassigned';
          byBudgetHead.set(key, (byBudgetHead.get(key) ?? 0) + Number(r.amount));
        }
      }

      // By vendor
      const byVendor = new Map<string, number>();
      for (const r of allRecords) {
        if (r.status === 'PAID' && r.vendor) {
          byVendor.set(r.vendor.name, (byVendor.get(r.vendor.name) ?? 0) + Number(r.amount));
        }
      }

      res.json({
        data,
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
        summary: {
          totalPaid,
          totalPending,
          totalApproved,
          totalAdvance,
          totalInvoice,
          totalExpense,
          count: allRecords.length,
          pendingCount: allRecords.filter((r) => r.status === 'PENDING').length,
          byBudgetHead: Array.from(byBudgetHead.entries()).map(([head, amount]) => ({ head, amount })),
          byVendor: Array.from(byVendor.entries()).map(([vendor, amount]) => ({ vendor, amount })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
