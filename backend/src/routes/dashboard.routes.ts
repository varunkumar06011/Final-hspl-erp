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

      const [project, committedAgg, paidAgg, pendingPayments, openIssues, inventoryItems, _activePhases, pendingQuotations, pendingQuotationValue, recentQuotations, pendingPOs, recentPOs, pendingInvoices, recentInvoices, totalExpenseAmount, recentPayments] =
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
            _sum: { grandTotal: true },
          }),
          prisma.payment.aggregate({
            where: {
              paymentRequest: { projectId, deletedAt: null },
              status: 'PAID',
            },
            _sum: { amount: true },
          }),
          prisma.paymentRequest.count({
            where: { projectId, deletedAt: null, status: 'PENDING' },
          }),
          prisma.issue.count({
            where: { projectId, deletedAt: null, status: { not: 'CLOSED' } },
          }),
          prisma.inventoryItem.findMany({
            where: { projectId, deletedAt: null },
            select: { currentStock: true, minStockLevel: true },
          }),
          prisma.phase.count({
            where: { projectId, deletedAt: null, status: 'IN_PROGRESS' },
          }),
          prisma.quotation.count({
            where: { projectId, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
          }),
          prisma.quotation.aggregate({
            where: { projectId, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
            _sum: { totalAmount: true },
          }),
          prisma.quotation.findMany({
            where: { projectId, deletedAt: null },
            include: {
              vendor: { select: { id: true, name: true, vendorCode: true } },
              createdByUser: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
          prisma.purchaseOrder.count({
            where: { projectId, deletedAt: null, status: 'PENDING_APPROVAL' },
          }),
          prisma.purchaseOrder.findMany({
            where: { projectId, deletedAt: null },
            include: {
              vendor: { select: { id: true, name: true, vendorCode: true } },
              createdByUser: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
          prisma.vendorInvoice.count({
            where: { projectId, deletedAt: null, verificationStatus: 'PENDING' },
          }),
          prisma.vendorInvoice.findMany({
            where: { projectId, deletedAt: null },
            include: {
              vendor: { select: { id: true, name: true, vendorCode: true } },
              createdByUser: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
          prisma.paymentRequest.aggregate({
            where: { projectId, deletedAt: null, type: 'EXPENSE', status: 'PAID' },
            _sum: { amount: true },
          }),
          prisma.paymentRequest.findMany({
            where: { projectId, deletedAt: null },
            include: {
              vendor: { select: { id: true, name: true, vendorCode: true } },
              invoice: { select: { id: true, invoiceCode: true } },
              createdByUser: { select: { id: true, name: true } },
              payments: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
        ]);

      const lowStock = inventoryItems.filter(
        (i) => Number(i.currentStock) <= Number(i.minStockLevel)
      ).length;

      const totalBudget = Number(project?.totalBudget ?? 0);
      const committed = Number(committedAgg._sum.grandTotal ?? 0);
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
        pendingQuotations,
        pendingQuotationValue: Number(pendingQuotationValue._sum.totalAmount ?? 0),
        recentQuotations: recentQuotations.map((q) => ({
          id: q.id,
          quotationNumber: q.quotationNumber,
          vendorName: q.vendor?.name ?? '—',
          vendorCode: q.vendor?.vendorCode ?? '',
          grandTotal: Number(q.grandTotal),
          status: q.status,
          createdBy: q.createdByUser?.name ?? '—',
          createdAt: q.createdAt,
        })),
        pendingPOs,
        recentPOs: recentPOs.map((p) => ({
          id: p.id,
          poNumber: p.poNumber,
          vendorName: p.vendor?.name ?? '—',
          vendorCode: p.vendor?.vendorCode ?? '',
          grandTotal: Number(p.grandTotal),
          status: p.status,
          createdBy: p.createdByUser?.name ?? '—',
          createdAt: p.createdAt,
        })),
        pendingInvoices,
        recentInvoices: recentInvoices.map((i) => ({
          id: i.id,
          invoiceCode: i.invoiceCode ?? null,
          invoiceNumber: i.invoiceNumber,
          vendorName: i.vendor?.name ?? '—',
          vendorCode: i.vendor?.vendorCode ?? '',
          totalAmount: Number(i.totalAmount),
          verificationStatus: i.verificationStatus,
          paymentStatus: i.paymentStatus,
          stockStatus: i.stockStatus,
          createdBy: i.createdByUser?.name ?? '—',
          createdAt: i.createdAt,
        })),
        totalExpenseAmount: Number(totalExpenseAmount._sum.amount ?? 0),
        recentPayments: recentPayments.map((p) => ({
          id: p.id,
          paymentCode: p.paymentCode,
          type: p.type,
          description: p.description,
          category: p.category,
          vendorName: p.vendor?.name ?? '—',
          invoiceCode: p.invoice?.invoiceCode ?? null,
          amount: Number(p.amount),
          status: p.status,
          isPaid: p.payments.length > 0,
          createdBy: p.createdByUser?.name ?? '—',
          createdAt: p.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;

// ── Cash Flow Forecast ──────────────────────────────────────────────
// Projects the next 90 days of cash position based on:
//   - Current bank balances
//   - Pending/approved payment requests (outflows)
//   - Pending invoices that will need payment (expected outflows)
router.get(
  '/cash-flow-forecast',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const [bankAccounts, pendingPayments, pendingInvoices] = await Promise.all([
        prisma.bankAccount.findMany({
          where: { projectId, deletedAt: null, isActive: true },
          select: { currentBalance: true },
        }),
        prisma.paymentRequest.findMany({
          where: {
            projectId,
            deletedAt: null,
            status: { in: ['PENDING', 'APPROVED'] },
          },
          select: { amount: true, status: true, type: true, createdAt: true },
        }),
        prisma.vendorInvoice.findMany({
          where: {
            projectId,
            deletedAt: null,
            paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
            verificationStatus: 'VERIFIED',
          },
          select: { totalAmount: true, advancePaid: true, createdAt: true },
        }),
      ]);

      const currentBalance = bankAccounts.reduce(
        (sum, acc) => sum + Number(acc.currentBalance),
        0
      );

      // Build daily projection for 90 days
      const days: { date: string; balance: number; inflow: number; outflow: number }[] = [];
      let runningBalance = currentBalance;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Distribute pending payments over next 30 days (assume even distribution)
      const totalPendingPayments = pendingPayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const dailyPaymentOutflow = totalPendingPayments / 30;

      // Distribute pending invoice payments over next 45 days
      const totalPendingInvoices = pendingInvoices.reduce(
        (sum, inv) => sum + Number(inv.totalAmount) - Number(inv.advancePaid ?? 0),
        0
      );
      const dailyInvoiceOutflow = totalPendingInvoices / 45;

      let minBalance = runningBalance;
      let minBalanceDate = today.toISOString().split('T')[0];

      for (let i = 0; i < 90; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        const paymentOutflow = i < 30 ? dailyPaymentOutflow : 0;
        const invoiceOutflow = i < 45 ? dailyInvoiceOutflow : 0;
        const totalOutflow = paymentOutflow + invoiceOutflow;

        runningBalance -= totalOutflow;

        if (runningBalance < minBalance) {
          minBalance = runningBalance;
          minBalanceDate = dateStr;
        }

        days.push({
          date: dateStr,
          balance: Math.round(runningBalance),
          inflow: 0,
          outflow: Math.round(totalOutflow),
        });
      }

      res.json({
        currentBalance,
        totalPendingPayments,
        totalPendingInvoices,
        minBalance,
        minBalanceDate,
        projection: days,
      });
    } catch (error) {
      next(error);
    }
  }
);
