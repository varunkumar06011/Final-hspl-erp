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

      const [project, committedAgg, paidAgg, pendingPayments, openIssues, inventoryItems, _activePhases, pendingQuotations, pendingQuotationValue, recentQuotations, pendingPOs, recentPOs, pendingInvoices, recentInvoices, pendingPaymentRequests, totalExpenseAmount, recentPayments] =
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
            where: { projectId, deletedAt: null },
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
            _sum: { grandTotal: true },
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
          prisma.paymentRequest.count({
            where: { projectId, deletedAt: null, status: 'PENDING' },
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
        pendingQuotations,
        pendingQuotationValue: Number(pendingQuotationValue._sum.grandTotal ?? 0),
        recentQuotations: recentQuotations.map((q) => ({
          id: q.id,
          quotationNumber: q.quotationNumber,
          vendorName: q.vendor?.name ?? '—',
          vendorCode: q.vendor?.vendorCode ?? '',
          totalAmount: Number(q.totalAmount),
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
          invoiceCode: i.invoiceCode,
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
        pendingPaymentRequests,
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
