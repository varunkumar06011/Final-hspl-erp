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

// ── Material Rate Tracker (read-only add-on) ────────────────────────
// Surfaces the "previous cost vs latest cost" of every material that has
// appeared on a Quotation or Purchase Order for the current project.
//
// This endpoint is purely additive: it reads existing QuotationItem and
// POItem rows (which already carry `materialName` + `unitPrice`) and
// aggregates them in memory. No schema changes, no writes, no changes to
// any existing quotation/PO logic.
//
// For each material (grouped by a case-insensitive, trimmed name) we sort
// every recorded rate by document date and pick:
//   - latestRate   = the most recent rate entry
//   - previousRate = the rate entry immediately before the latest
// Only materials that have at least two distinct rate entries are
// returned (a single entry has nothing to compare against).
//
// Query params:
//   ?limit=N   (default 50, max 200) — top N materials by % increase
//   ?sort=inc  (default) | name      — sort by % increase desc, or by name
router.get(
  '/rate-tracker',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
      const sort = String(req.query.sort ?? 'inc') === 'name' ? 'name' : 'inc';

      // Pull every quotation line item with its parent doc context.
      // Quotations and POs are scoped to the project and soft-delete aware.
      const [quotationItems, poItems] = await Promise.all([
        prisma.quotationItem.findMany({
          where: {
            quotation: { projectId, deletedAt: null },
          },
          select: {
            materialName: true,
            unitPrice: true,
            unit: true,
            createdAt: true,
            quotation: {
              select: {
                id: true,
                quotationNumber: true,
                date: true,
                status: true,
                vendor: { select: { id: true, name: true } },
              },
            },
          },
        }),
        prisma.pOItem.findMany({
          where: {
            purchaseOrder: { projectId, deletedAt: null },
          },
          select: {
            materialName: true,
            unitPrice: true,
            unit: true,
            createdAt: true,
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
                date: true,
                status: true,
                vendor: { select: { id: true, name: true } },
              },
            },
          },
        }),
      ]);

      // Build a unified list of rate entries.
      type RateEntry = {
        materialName: string;
        date: Date;
        rate: number;
        unit: string | null;
        vendorName: string;
        docType: 'QUOTATION' | 'PO';
        docNumber: string;
        docId: string;
        status: string;
      };

      const entries: RateEntry[] = [
        ...quotationItems.map((qi) => ({
          materialName: qi.materialName,
          date: qi.quotation.date,
          rate: Number(qi.unitPrice),
          unit: qi.unit,
          vendorName: qi.quotation.vendor?.name ?? '—',
          docType: 'QUOTATION' as const,
          docNumber: qi.quotation.quotationNumber,
          docId: qi.quotation.id,
          status: qi.quotation.status,
        })),
        ...poItems.map((pi) => ({
          materialName: pi.materialName,
          date: pi.purchaseOrder.date,
          rate: Number(pi.unitPrice),
          unit: pi.unit,
          vendorName: pi.purchaseOrder.vendor?.name ?? '—',
          docType: 'PO' as const,
          docNumber: pi.purchaseOrder.poNumber,
          docId: pi.purchaseOrder.id,
          status: pi.purchaseOrder.status,
        })),
      ];

      // Group by normalized material name (trim + lowercase) so that
      // "Taps", "taps", "CP Taps" with the same core name collapse together.
      // The display name keeps the most common original spelling.
      const groups = new Map<
        string,
        { displayName: string; nameCounts: Map<string, number>; entries: RateEntry[] }
      >();

      for (const entry of entries) {
        const key = entry.materialName.trim().toLowerCase();
        if (!key) continue;
        const group = groups.get(key) ?? {
          displayName: entry.materialName.trim(),
          nameCounts: new Map<string, number>(),
          entries: [],
        };
        groups.set(key, group);
        group.entries.push(entry);
        const original = entry.materialName.trim();
        group.nameCounts.set(original, (group.nameCounts.get(original) ?? 0) + 1);
      }

      const materials: Array<{
        materialName: string;
        unit: string | null;
        previousRate: number;
        latestRate: number;
        difference: number;
        percentChange: number;
        previousDate: string;
        latestDate: string;
        previousVendor: string;
        latestVendor: string;
        previousDocType: string;
        latestDocType: string;
        previousDocNumber: string;
        latestDocNumber: string;
        entryCount: number;
      }> = [];

      for (const group of groups.values()) {
        // Need at least two entries to compare previous vs latest.
        if (group.entries.length < 2) continue;

        // Sort ascending by date so the last two entries are previous + latest.
        const sorted = [...group.entries].sort((a, b) => {
          const aTime = a.date.getTime();
          const bTime = b.date.getTime();
          return aTime - bTime;
        });

        const latest = sorted[sorted.length - 1];
        const previous = sorted[sorted.length - 2];

        // Pick the most common original spelling as the display name.
        let displayName = group.displayName;
        let bestCount = 0;
        for (const [name, count] of group.nameCounts) {
          if (count > bestCount) {
            bestCount = count;
            displayName = name;
          }
        }

        const previousRate = previous.rate;
        const latestRate = latest.rate;
        const difference = latestRate - previousRate;
        const percentChange = previousRate > 0 ? (difference / previousRate) * 100 : 0;

        materials.push({
          materialName: displayName,
          unit: latest.unit ?? previous.unit ?? null,
          previousRate,
          latestRate,
          difference,
          percentChange,
          previousDate: previous.date.toISOString(),
          latestDate: latest.date.toISOString(),
          previousVendor: previous.vendorName,
          latestVendor: latest.vendorName,
          previousDocType: previous.docType,
          latestDocType: latest.docType,
          previousDocNumber: previous.docNumber,
          latestDocNumber: latest.docNumber,
          entryCount: sorted.length,
        });
      }

      materials.sort((a, b) => {
        if (sort === 'name') return a.materialName.localeCompare(b.materialName);
        // Default: biggest % increase first.
        if (b.percentChange !== a.percentChange) return b.percentChange - a.percentChange;
        return b.difference - a.difference;
      });

      const totalMaterialsTracked = groups.size;
      const totalWithChange = materials.length;
      const increased = materials.filter((m) => m.difference > 0).length;
      const decreased = materials.filter((m) => m.difference < 0).length;

      res.json({
        summary: {
          totalMaterialsTracked,
          totalWithChange,
          increased,
          decreased,
        },
        materials: materials.slice(0, limit),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Amount Used Today (read-only add-on) ────────────────────────────
// Returns the total of all PAID payments made *today* (calendar day,
// server local time) for the current project, plus a list of those
// payments. No carry-forward — only payments with `Payment.date` falling
// inside today's 00:00:00 → 23:59:59 window are included.
//
// Purely additive: reads existing Payment rows (which already carry
// `date`, `amount`, `status` and link to a project-scoped
// PaymentRequest). No schema changes, no writes, no changes to any
// existing payment logic.
router.get(
  '/payments-today',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      // Today's calendar window (server local time).
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const payments = await prisma.payment.findMany({
        where: {
          status: 'PAID',
          date: { gte: start, lte: end },
          paymentRequest: { projectId, deletedAt: null },
        },
        select: {
          id: true,
          amount: true,
          date: true,
          mode: true,
          reference: true,
          status: true,
          createdAt: true,
          paymentRequest: {
            select: {
              id: true,
              requestNumber: true,
              type: true,
              description: true,
              category: true,
              vendor: { select: { id: true, name: true } },
              invoice: { select: { id: true, invoiceCode: true } },
              createdByUser: { select: { id: true, name: true } },
            },
          },
          bankAccount: { select: { id: true, accountName: true } },
          cashAccount: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
      });

      const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const count = payments.length;

      res.json({
        date: start.toISOString().split('T')[0],
        totalAmount,
        count,
        payments: payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          date: p.date.toISOString(),
          mode: p.mode,
          reference: p.reference,
          status: p.status,
          requestNumber: p.paymentRequest?.requestNumber ?? '—',
          type: p.paymentRequest?.type ?? '—',
          description: p.paymentRequest?.description ?? '',
          category: p.paymentRequest?.category ?? '',
          vendorName: p.paymentRequest?.vendor?.name ?? '—',
          invoiceCode: p.paymentRequest?.invoice?.invoiceCode ?? null,
          createdBy: p.paymentRequest?.createdByUser?.name ?? '—',
          bankAccountName: p.bankAccount?.accountName ?? null,
          cashAccountName: p.cashAccount?.name ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Document Summary (read-only add-on) ─────────────────────────────
// Returns total counts of Quotations, Purchase Orders, and Invoices for
// the current project, plus the total invoice value (sum of
// VendorInvoice.totalAmount). Purely additive — reads existing tables
// only, no changes to any existing logic.
router.get(
  '/document-summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const [totalQuotations, totalPurchaseOrders, totalInvoices, invoiceValueAgg] = await Promise.all([
        prisma.quotation.count({ where: { projectId, deletedAt: null } }),
        prisma.purchaseOrder.count({ where: { projectId, deletedAt: null } }),
        prisma.vendorInvoice.count({ where: { projectId, deletedAt: null } }),
        prisma.vendorInvoice.aggregate({
          where: { projectId, deletedAt: null },
          _sum: { totalAmount: true },
        }),
      ]);

      const totalInvoiceValue = Number(invoiceValueAgg._sum.totalAmount ?? 0);

      res.json({
        totalQuotations,
        totalPurchaseOrders,
        totalInvoices,
        totalInvoiceValue,
      });
    } catch (error) {
      next(error);
    }
  }
);
