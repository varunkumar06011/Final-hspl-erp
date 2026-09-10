import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';

const router = Router();
router.use(authMiddleware);

router.get(
  '/summary',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
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
            where: { projectId, deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'PAID'] } },
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
            where: {
              projectId,
              deletedAt: null,
              status: { notIn: ['APPROVED', 'REJECTED', 'CONVERTED_TO_PO'] },
              approvalWorkflow: { steps: { none: { status: 'REJECTED' } } },
            },
          }),
          prisma.quotation.aggregate({
            where: {
              projectId,
              deletedAt: null,
              status: { notIn: ['APPROVED', 'REJECTED', 'CONVERTED_TO_PO'] },
              approvalWorkflow: { steps: { none: { status: 'REJECTED' } } },
            },
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
            where: { projectId, deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED'] } },
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
            where: { projectId, deletedAt: null, verificationStatus: { notIn: ['VERIFIED', 'REJECTED'] } },
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
  rbacMiddleware(Permission.VIEW_DASHBOARD),
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
  rbacMiddleware(Permission.VIEW_DASHBOARD),
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
  rbacMiddleware(Permission.VIEW_DASHBOARD),
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
  rbacMiddleware(Permission.VIEW_DASHBOARD),
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

// ── Admin Dashboard Summary (additive, read-only) ───────────────────
// Returns the accounting-first summary for the Admin dashboard:
//   Balance = (Inward − Bank Expenditure) + (Short Advance − Cash Expenditure)
//           = Inward + Short Advance − Total Expenditure
//
// Source mapping (per business rule — never mix cash and bank sources):
//   Bank expenditures (WITHDRAWAL + PAYMENT − REVERSAL_IN) → from Inward
//   Cash expenditures  (OUT − REVERSAL_IN)                 → from Short Advance
//
// Calculated from posted bank/cash transactions and loan ledger entries
// (no date filter). Inter-account transfers are excluded from pure inward
// funds, while cash loan receipts are added separately as short advances.
// Reversals are netted so cancelled vouchers do not inflate the figures:
//
// Pure Bank Inward = (DEPOSIT + MANUAL_DEPOSIT) - reversed bank receipts
// Bank Expenditure = (WITHDRAWAL + PAYMENT) - REVERSAL_IN (refunds)
// Cash Expenditure = (OUT) - REVERSAL_IN (refunds)
// Total Expenditure = Bank Expenditure + Cash Expenditure
// Balance          = Pure Bank Inward + Short Advance/Loan - Total Expenditure
//
// This gives true net figures while keeping the balance unchanged.
// For example, a cancelled receipt (DEPOSIT + REVERSAL_OUT) contributes
// 0 to Inward. A cancelled payment (WITHDRAWAL + REVERSAL_IN) contributes
// 0 to Expenditure.
//
// Also returns budget heads (top by allocated), bank/cash balances,
// and pending counts — all from existing data, no new fields.
router.get(
  '/admin-summary',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      // ── 1. Inward funds + expenditure from ALL posted transactions ──
      // No date filter — includes future-dated transactions so the
      // balance always matches actual account balances.
      //
      // Base flows are real inflows/outflows. Reversal flows are separate
      // and subtracted from the corresponding base total to get net figures.
      // Pure bank inward funds exclude inter-account transfers: a transfer
      // moves existing money and is not new project income.
      const bankInflowTypes = ['DEPOSIT', 'MANUAL_DEPOSIT'];
      const bankOutflowTypes = ['WITHDRAWAL', 'PAYMENT'];
      const cashOutflowTypes = ['OUT'];
      const bankReversalInTypes = ['REVERSAL_IN'];      // refunds of expenses
      const bankReversalOutTypes = ['REVERSAL_OUT'];    // reversed receipts
      const cashReversalInTypes = ['REVERSAL_IN'];
      const cashReversalOutTypes = ['REVERSAL_OUT'];

      const [
        bankBaseInflowAgg,
        bankBaseOutflowAgg,
        cashBaseOutflowAgg,
        bankReversalInAgg,
        bankReversalOutAgg,
        cashReversalInAgg,
        cashReversalOutAgg,
        bankBalanceAgg,
        cashBalanceAgg,
        budgetHeads,
        pendingPayments,
        pendingQuotations,
        pendingPOs,
        pendingInvoices,
        recentBankTxns,
        recentCashTxns,
        todayBankBaseOutflowAgg,
        todayBankReversalInAgg,
        todayCashBaseOutflowAgg,
        todayCashReversalInAgg,
        todayBankOutTxns,
        todayCashOutTxns,
        recentQuotations,
        recentPOs,
        recentInvoices,
        totalQuotations,
        totalPurchaseOrders,
        totalInvoices,
        phases,
        project,
      ] = await Promise.all([
        // Bank base inflow (all time, no date filter)
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankInflowTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Bank base outflow (all time, no date filter)
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Cash base outflow (all time, no date filter)
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Bank reversals of expenses (refunds) — subtract from expenditure
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankReversalInTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Bank reversals of receipts — subtract from inward
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankReversalOutTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Cash reversals of expenses (refunds) — subtract from expenditure
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashReversalInTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Cash reversals of receipts — subtract from inward
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashReversalOutTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
        }),
        // Bank balances
        prisma.bankAccount.aggregate({
          where: { projectId, deletedAt: null },
          _sum: { currentBalance: true, openingBalance: true },
        }),
        // Cash balances
        prisma.cashAccount.aggregate({
          where: { projectId, deletedAt: null },
          _sum: { currentBalance: true, openingBalance: true },
        }),
        // Budget heads (all, sorted by slNo; used-first reordering applied below)
        prisma.budgetHead.findMany({
          where: { projectId, deletedAt: null },
          orderBy: { slNo: 'asc' },
          select: {
            id: true,
            slNo: true,
            particulars: true,
            allocatedAmount: true,
            committedAmount: true,
            actualAmount: true,
            paidAmount: true,
          },
        }),
        // Pending counts — all records not yet approved/verified/rejected/cancelled
        prisma.paymentRequest.count({ where: { projectId, status: { notIn: ['APPROVED', 'REJECTED', 'PAID'] }, deletedAt: null } }),
        prisma.quotation.count({ where: { projectId, status: { notIn: ['APPROVED', 'REJECTED', 'CONVERTED_TO_PO'] }, deletedAt: null, approvalWorkflow: { steps: { none: { status: 'REJECTED' } } } } }),
        prisma.purchaseOrder.count({ where: { projectId, status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED'] }, deletedAt: null } }),
        prisma.vendorInvoice.count({ where: { projectId, verificationStatus: { notIn: ['VERIFIED', 'REJECTED'] }, deletedAt: null } }),
        // Recent bank transactions (last 15 — enough for the scrollable dashboard list)
        prisma.bankTransaction.findMany({
          where: { status: 'POSTED', bankAccount: { projectId, deletedAt: null } },
          include: { bankAccount: { select: { accountName: true } } },
          orderBy: { date: 'desc' },
          take: 15,
        }),
        // Recent cash transactions (last 15)
        prisma.cashTransaction.findMany({
          where: { status: 'POSTED', cashAccount: { projectId, deletedAt: null } },
          include: { cashAccount: { select: { name: true } } },
          orderBy: { date: 'desc' },
          take: 15,
        }),
        // Today's bank base outflow
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Today's bank reversals of expenses (refunds)
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankReversalInTypes },
            bankAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Today's cash base outflow
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Today's cash reversals of expenses (refunds)
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashReversalInTypes },
            cashAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Today's outflow transactions (for the detail list) — base outflows only
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          include: {
            bankAccount: { select: { accountName: true } },
            budgetHead: { select: { id: true, particulars: true } },
          },
          orderBy: { date: 'desc' },
          take: 10,
        }),
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
            date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
          include: {
            cashAccount: { select: { name: true } },
            budgetHead: { select: { id: true, particulars: true } },
          },
          orderBy: { date: 'desc' },
          take: 10,
        }),
        // Recent quotations (last 5)
        prisma.quotation.findMany({
          where: { projectId, deletedAt: null },
          include: { vendor: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        // Recent purchase orders (last 5) — same pattern as recentQuotations
        prisma.purchaseOrder.findMany({
          where: { projectId, deletedAt: null },
          include: { vendor: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        // Recent vendor invoices (last 5) — same pattern as recentQuotations
        prisma.vendorInvoice.findMany({
          where: { projectId, deletedAt: null },
          include: { vendor: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        // Procurement totals — simple count() against existing tables
        prisma.quotation.count({ where: { projectId, deletedAt: null } }),
        prisma.purchaseOrder.count({ where: { projectId, deletedAt: null } }),
        prisma.vendorInvoice.count({ where: { projectId, deletedAt: null } }),
        // Project phases with progress — read-only, surfaces existing Phase.progressPercent
        prisma.phase.findMany({
          where: { projectId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            progressPercent: true,
            plannedStart: true,
            plannedEnd: true,
          },
        }),
        // Project info — now includes startDate and endDate for timeline
        prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true, status: true, startDate: true, endDate: true, totalBudget: true },
        }),
      ]);

      // Short Advance / Loan is a cash receipt whose counter-entry is a
      // liability ledger in the LOAN group. It is separate from pure bank
      // inward funds and is included only once in the available balance.
      const cashReceiptTransactions = await prisma.cashTransaction.findMany({
        where: {
          status: 'POSTED',
          type: { in: ['IN', 'REVERSAL_OUT'] },
          cashAccount: { projectId, deletedAt: null },
          referenceId: { not: null },
        },
        select: { type: true, referenceId: true, amount: true },
      });
      const cashReceiptVoucherIds = cashReceiptTransactions
        .map((t) => t.referenceId)
        .filter((id): id is string => !!id);
      const loanEntries = cashReceiptVoucherIds.length > 0
        ? await prisma.ledgerEntry.findMany({
            where: {
              journalVoucherId: { in: cashReceiptVoucherIds },
              credit: { gt: 0 },
              // Match any ledger group containing "loan" (case-insensitive).
              // The database uses "Unsecured Loan" as the group name, not "LOAN".
              ledger: { group: { contains: 'loan', mode: 'insensitive' }, projectId, deletedAt: null },
              journalVoucher: { status: 'POSTED', deletedAt: null },
            },
            select: { journalVoucherId: true, credit: true },
          })
        : [];
      const loanVoucherIds = new Set(loanEntries.map((entry) => entry.journalVoucherId));
      const shortAdvance = cashReceiptTransactions.reduce(
        (sum, transaction) => {
          if (!loanVoucherIds.has(transaction.referenceId ?? '')) return sum;
          const amount = Number(transaction.amount);
          return sum + (transaction.type === 'REVERSAL_OUT' ? -amount : amount);
        },
        0,
      );

      // Action Required items — all recent records that are NOT yet approved/verified,
      // NOT rejected, and NOT cancelled. This includes DRAFT, SUBMITTED, UNDER_REVIEW
      // quotations and DRAFT, PENDING_APPROVAL POs, so the admin sees everything
      // that still needs action. Sorted most-recent first.
      const [actionQuotations, actionPOs, actionInvoices, actionPayments] = await Promise.all([
        prisma.quotation.findMany({
          where: {
            projectId,
            deletedAt: null,
            status: { notIn: ['APPROVED', 'REJECTED', 'CONVERTED_TO_PO'] },
            // Also exclude quotations where any approval step has been rejected —
            // the top-level status may not have been updated for older records.
            approvalWorkflow: {
              steps: { none: { status: 'REJECTED' } },
            },
          },
          select: { id: true, quotationNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.purchaseOrder.findMany({
          where: { projectId, deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED'] } },
          select: { id: true, poNumber: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.vendorInvoice.findMany({
          where: { projectId, deletedAt: null, verificationStatus: { notIn: ['VERIFIED', 'REJECTED'] } },
          select: { id: true, invoiceCode: true, invoiceNumber: true, verificationStatus: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.paymentRequest.findMany({
          where: { projectId, deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'PAID'] } },
          select: { id: true, paymentCode: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);
      const actionItems = [
        ...actionQuotations.map((item) => ({ id: item.id, type: 'quotation' as const, code: item.quotationNumber, status: item.status, createdAt: item.createdAt.toISOString(), path: `/quotations?id=${item.id}` })),
        ...actionPOs.map((item) => ({ id: item.id, type: 'purchase-order' as const, code: item.poNumber, status: item.status, createdAt: item.createdAt.toISOString(), path: `/pos?id=${item.id}` })),
        ...actionInvoices.map((item) => ({ id: item.id, type: 'invoice' as const, code: item.invoiceCode ?? item.invoiceNumber, status: item.verificationStatus, createdAt: item.createdAt.toISOString(), path: `/invoices?id=${item.id}` })),
        ...actionPayments.map((item) => ({ id: item.id, type: 'payment' as const, code: item.paymentCode, status: item.status, createdAt: item.createdAt.toISOString(), path: `/payments?id=${item.id}` })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);

      // ── Calculate summary values (net of reversals) ──
      // Pure bank inward is net of reversed bank receipts. Cash receipts are
      // intentionally excluded; qualifying cash LOAN receipts are reported
      // separately as shortAdvance.
      //
      // Source mapping (per business rule):
      //   Bank expenditures (WITHDRAWAL + PAYMENT − REVERSAL_IN) are deducted
      //   from Inward Amount (bank receipts).
      //   Cash expenditures (OUT − REVERSAL_IN) are deducted from
      //   Short Advance / Loan.
      //   Balance = (Inward − Bank Expenditure) + (Short Advance − Cash Expenditure)
      //           = Inward + Short Advance − Total Expenditure
      const pureBankInward =
        Number(bankBaseInflowAgg._sum.amount ?? 0) - Number(bankReversalOutAgg._sum.amount ?? 0);
      void cashReversalOutAgg;

      // Expenditure broken down by payment source (bank vs cash), net of reversals.
      const bankExpenditure =
        Number(bankBaseOutflowAgg._sum.amount ?? 0) - Number(bankReversalInAgg._sum.amount ?? 0);
      const cashExpenditure =
        Number(cashBaseOutflowAgg._sum.amount ?? 0) - Number(cashReversalInAgg._sum.amount ?? 0);

      const totalInwardFunds = pureBankInward;
      const totalExpenditure = bankExpenditure + cashExpenditure;
      const balance = totalInwardFunds + shortAdvance - totalExpenditure;

      const bankBalance = Number(bankBalanceAgg._sum.currentBalance ?? 0);
      const cashBalance = Number(cashBalanceAgg._sum.currentBalance ?? 0);
      const totalLiquidity = bankBalance + cashBalance;

      // Budget heads with computed fields
      const budgetHeadRows = budgetHeads.map((h) => {
        const allocated = Number(h.allocatedAmount);
        const committed = Number(h.committedAmount);
        const actual = Number(h.actualAmount);
        const paid = Number(h.paidAmount);
        const available = allocated - actual;
        const utilizationPct = allocated > 0 ? (actual / allocated) * 100 : 0;
        return {
          id: h.id,
          slNo: h.slNo,
          particulars: h.particulars,
          allocated,
          committed,
          actual,
          paid,
          available,
          utilizationPct: Math.round(utilizationPct * 100) / 100,
        };
      });
      // Reorder so used heads (committed/actual/paid > 0) appear first, then by slNo
      budgetHeadRows.sort((a, b) => {
        const aUsed = a.committed > 0 || a.actual > 0 || a.paid > 0 ? 0 : 1;
        const bUsed = b.committed > 0 || b.actual > 0 || b.paid > 0 ? 0 : 1;
        if (aUsed !== bUsed) return aUsed - bUsed;
        return Number(a.slNo) - Number(b.slNo);
      });

      // ── Today's outflow (Amount Used Today) — net of refunds ──
      const todayBaseOutflow =
        Number(todayBankBaseOutflowAgg._sum.amount ?? 0) + Number(todayCashBaseOutflowAgg._sum.amount ?? 0);
      const todayReversalIn =
        Number(todayBankReversalInAgg._sum.amount ?? 0) + Number(todayCashReversalInAgg._sum.amount ?? 0);
      const todayOutflowAmount = todayBaseOutflow - todayReversalIn;
      const todayOutflowCount =
        (todayBankBaseOutflowAgg._count ?? 0) + (todayCashBaseOutflowAgg._count ?? 0);

      // Resolve budget head for today's outflow transactions (same logic as outflow-by-range)
      const todayJvIds = [
        ...todayBankOutTxns.filter((t) => !t.budgetHeadId).map((t) => t.referenceId),
        ...todayCashOutTxns.filter((t) => !t.budgetHeadId).map((t) => t.referenceId),
      ].filter((id): id is string => !!id);

      const todayPayments = todayJvIds.length > 0
        ? await prisma.payment.findMany({
            where: { journalVoucherId: { in: todayJvIds } },
            select: {
              journalVoucherId: true,
              budgetHead: { select: { id: true, particulars: true } },
            },
          })
        : [];

      const todayJvToBudgetHead = new Map<string, { id: string; particulars: string } | null>();
      for (const p of todayPayments) {
        if (p.journalVoucherId) {
          todayJvToBudgetHead.set(p.journalVoucherId, p.budgetHead);
        }
      }

      const todayOutflowTransactions = [
        ...todayBankOutTxns.map((t) => ({
          id: t.id,
          account: t.bankAccount?.accountName ?? 'Bank',
          accountType: 'BANK' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          time: t.date.toISOString(),
          budgetHead: t.budgetHead ?? (t.referenceId ? (todayJvToBudgetHead.get(t.referenceId) ?? null) : null),
        })),
        ...todayCashOutTxns.map((t) => ({
          id: t.id,
          account: t.cashAccount?.name ?? 'Cash',
          accountType: 'CASH' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          time: t.date.toISOString(),
          budgetHead: t.budgetHead ?? (t.referenceId ? (todayJvToBudgetHead.get(t.referenceId) ?? null) : null),
        })),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      res.json({
        project: project ? { name: project.name, status: project.status } : null,
        // Accounting-first summary
        pureBankInward,
        shortAdvance,
        totalInwardFunds,
        totalExpenditure,
        bankExpenditure,
        cashExpenditure,
        balance,
        // Bank & cash
        bankBalance,
        cashBalance,
        totalLiquidity,
        // Budget heads
        budgetHeads: budgetHeadRows,
        budgetTotals: (() => {
          const totalAllocated = budgetHeadRows.reduce((s, h) => s + h.allocated, 0);
          const totalActual = budgetHeadRows.reduce((s, h) => s + h.actual, 0);
          return {
            totalAllocated,
            totalActual,
            totalCommitted: budgetHeadRows.reduce((s, h) => s + h.committed, 0),
            totalRemaining: totalAllocated - totalActual,
            utilizationPct: totalAllocated > 0 ? (totalActual / totalAllocated) * 100 : 0,
          };
        })(),
        // Today's outflow (Amount Used Today)
        todayOutflow: {
          amount: todayOutflowAmount,
          count: todayOutflowCount,
          transactions: todayOutflowTransactions,
        },
        // Pending approvals
        pendingPayments,
        pendingQuotations,
        pendingPOs,
        pendingInvoices,
        actionItems,
        // Recent activity — merged bank + cash transactions, sorted by date desc
        recentTransactions: [
          ...recentBankTxns.map((t) => ({
            id: t.id,
            account: t.bankAccount?.accountName ?? 'Bank',
            accountType: 'BANK' as const,
            type: t.type,
            isInflow: ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type),
            amount: Number(t.amount),
            description: t.description ?? '',
            date: t.date.toISOString(),
          })),
          ...recentCashTxns.map((t) => ({
            id: t.id,
            account: t.cashAccount?.name ?? 'Cash',
            accountType: 'CASH' as const,
            type: t.type,
            isInflow: ['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type),
            amount: Number(t.amount),
            description: t.description ?? '',
            date: t.date.toISOString(),
          })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 30),
        recentQuotations: recentQuotations.map((q) => ({
          id: q.id,
          quotationNumber: q.quotationNumber,
          vendorName: q.vendor?.name ?? '—',
          grandTotal: Number(q.grandTotal),
          status: q.status,
          createdAt: q.createdAt.toISOString(),
        })),
        // Recent POs — same pattern as recentQuotations
        recentPOs: recentPOs.map((p) => ({
          id: p.id,
          poNumber: p.poNumber,
          vendorName: p.vendor?.name ?? '—',
          grandTotal: Number(p.grandTotal),
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
        // Recent invoices — same pattern as recentQuotations
        recentInvoices: recentInvoices.map((i) => ({
          id: i.id,
          invoiceCode: i.invoiceCode,
          vendorName: i.vendor?.name ?? '—',
          totalAmount: Number(i.totalAmount),
          verificationStatus: i.verificationStatus,
          createdAt: i.createdAt.toISOString(),
        })),
        // Procurement totals — simple counts
        procurement: {
          totalQuotations,
          totalPurchaseOrders,
          totalInvoices,
          pendingQuotations,
          pendingPOs,
          pendingInvoices,
        },
        // Project phases — surfaces existing Phase.progressPercent (read-only)
        phases: phases.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          progressPercent: Number(p.progressPercent),
          plannedStart: p.plannedStart?.toISOString() ?? null,
          plannedEnd: p.plannedEnd?.toISOString() ?? null,
        })),
        // Project timeline — startDate and endDate for progress bar
        projectTimeline: project ? {
          startDate: project.startDate.toISOString(),
          endDate: project.endDate?.toISOString() ?? null,
          totalBudget: Number(project.totalBudget),
        } : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Outflow by date range (additive, read-only) ─────────────────────
// Returns total expenditure (bank + cash outflow) for a given date range.
// Used by the Admin Dashboard "Amount Used Today" card when the user
// selects a custom date range. Defaults to today if no range is provided.
//
// Reversals of expenses (REVERSAL_IN) are subtracted so cancelled payments
// do not inflate the total. Reversals of receipts (REVERSAL_OUT) are not
// included in outflow at all.
//
// Query params:
//   startDate — ISO date string (default: today 00:00)
//   endDate   — ISO date string (default: today 23:59:59)
//
// All data is live from posted BankTransaction + CashTransaction rows.
// No hardcoded values — everything is computed from real transactions.
router.get(
  '/outflow-by-range',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      // Parse date range — default to today. The dashboard detail popup can
      // explicitly request all historical posted expenditures.
      const allTime = String(req.query.allTime).toLowerCase() === 'true';
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

      const startDate = req.query.startDate
        ? new Date(String(req.query.startDate))
        : startOfDay;
      const endDate = req.query.endDate
        ? new Date(String(req.query.endDate))
        : endOfDay;

      // If endDate is a date-only string (no time), set it to end of that day
      if (req.query.endDate && endDate.getHours() === 0) {
        endDate.setHours(23, 59, 59, 999);
      }

      const bankOutflowTypes = ['WITHDRAWAL', 'PAYMENT'];
      const cashOutflowTypes = ['OUT'];
      const bankReversalInTypes = ['REVERSAL_IN']; // refunds of expenses
      const cashReversalInTypes = ['REVERSAL_IN'];

      // Optional limit parameter — defaults to 20 (for the Amount Used Today card).
      // The dashboard expenditure detail popup requests all posted outflows explicitly.
      const fetchAll = String(req.query.all).toLowerCase() === 'true';
      const limit = fetchAll ? undefined : (req.query.limit ? Math.min(Number(req.query.limit), 5000) : 20);
      const dateFilter = allTime ? {} : { date: { gte: startDate, lte: endDate } };

      const [bankOutflowAgg, bankReversalInAgg, cashOutflowAgg, cashReversalInAgg, bankOutTxns, cashOutTxns] = await Promise.all([
        // Bank base outflow in range
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Bank reversals of expenses in range (refunds)
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankReversalInTypes },
            bankAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Cash base outflow in range
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Cash reversals of expenses in range (refunds)
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashReversalInTypes },
            cashAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Bank outflow transactions in range (base outflows only)
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          include: {
            bankAccount: { select: { accountName: true } },
            budgetHead: { select: { id: true, particulars: true } },
          },
          orderBy: { date: 'desc' },
          take: limit,
        }),
        // Cash outflow transactions in range (base outflows only)
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
            ...dateFilter,
          },
          include: {
            cashAccount: { select: { name: true } },
            budgetHead: { select: { id: true, particulars: true } },
          },
          orderBy: { date: 'desc' },
          take: limit,
        }),
      ]);

      // ── Resolve Budget Head for each outflow transaction ──
      // Priority 1: budgetHeadId directly on the transaction (manual cash flow entries)
      // Priority 2: resolve via Payment → JournalVoucher chain (payment-created transactions)
      const jvIds = [
        ...bankOutTxns.filter((t) => !t.budgetHeadId).map((t) => t.referenceId),
        ...cashOutTxns.filter((t) => !t.budgetHeadId).map((t) => t.referenceId),
      ].filter((id): id is string => !!id);

      const payments = jvIds.length > 0
        ? await prisma.payment.findMany({
            where: { journalVoucherId: { in: jvIds } },
            select: {
              journalVoucherId: true,
              budgetHead: { select: { id: true, particulars: true } },
            },
          })
        : [];

      // Map: JV id → { id, particulars }
      const jvToBudgetHead = new Map<string, { id: string; particulars: string } | null>();
      for (const p of payments) {
        if (p.journalVoucherId) {
          jvToBudgetHead.set(p.journalVoucherId, p.budgetHead);
        }
      }

      const baseOutflow =
        Number(bankOutflowAgg._sum.amount ?? 0) + Number(cashOutflowAgg._sum.amount ?? 0);
      const reversalIn =
        Number(bankReversalInAgg._sum.amount ?? 0) + Number(cashReversalInAgg._sum.amount ?? 0);
      const totalAmount = baseOutflow - reversalIn;
      const totalCount = (bankOutflowAgg._count ?? 0) + (cashOutflowAgg._count ?? 0);

      const transactions = [
        ...bankOutTxns.map((t) => ({
          id: t.id,
          account: t.bankAccount?.accountName ?? 'Bank',
          accountType: 'BANK' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          date: t.date.toISOString(),
          budgetHead: t.budgetHead ?? (t.referenceId ? (jvToBudgetHead.get(t.referenceId) ?? null) : null),
        })),
        ...cashOutTxns.map((t) => ({
          id: t.id,
          account: t.cashAccount?.name ?? 'Cash',
          accountType: 'CASH' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          date: t.date.toISOString(),
          budgetHead: t.budgetHead ?? (t.referenceId ? (jvToBudgetHead.get(t.referenceId) ?? null) : null),
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalAmount,
        totalCount,
        transactions,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ── Expenditure trend (additive, read-only) ─────────────────────────
// Returns daily outflow totals for the last N days (default 30).
// Used by the Admin Dashboard "Expenditure Trend" chart.
// Groups posted bank + cash outflow transactions by date.
// Reversals of expenses (REVERSAL_IN) are subtracted so cancelled
// payments do not inflate daily outflow.
router.get(
  '/admin-outflow-trend',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);

      const bankOutflowTypes = ['WITHDRAWAL', 'PAYMENT'];
      const cashOutflowTypes = ['OUT'];
      const bankReversalInTypes = ['REVERSAL_IN']; // refunds of expenses
      const cashReversalInTypes = ['REVERSAL_IN'];

      const [bankTxns, cashTxns, bankReversalInTxns, cashReversalInTxns] = await Promise.all([
        // Base bank outflows
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankOutflowTypes },
            bankAccount: { projectId, deletedAt: null },
            date: { gte: startDate },
          },
          select: { date: true, amount: true },
        }),
        // Base cash outflows
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashOutflowTypes },
            cashAccount: { projectId, deletedAt: null },
            date: { gte: startDate },
          },
          select: { date: true, amount: true },
        }),
        // Bank reversals of expenses (refunds) — subtract from outflow
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankReversalInTypes },
            bankAccount: { projectId, deletedAt: null },
            date: { gte: startDate },
          },
          select: { date: true, amount: true },
        }),
        // Cash reversals of expenses (refunds) — subtract from outflow
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashReversalInTypes },
            cashAccount: { projectId, deletedAt: null },
            date: { gte: startDate },
          },
          select: { date: true, amount: true },
        }),
      ]);

      // Group by date (YYYY-MM-DD). Base outflows add, reversals subtract.
      const byDate = new Map<string, number>();
      for (const t of bankTxns) {
        const key = t.date.toISOString().split('T')[0];
        byDate.set(key, (byDate.get(key) ?? 0) + Number(t.amount));
      }
      for (const t of cashTxns) {
        const key = t.date.toISOString().split('T')[0];
        byDate.set(key, (byDate.get(key) ?? 0) + Number(t.amount));
      }
      for (const t of bankReversalInTxns) {
        const key = t.date.toISOString().split('T')[0];
        byDate.set(key, (byDate.get(key) ?? 0) - Number(t.amount));
      }
      for (const t of cashReversalInTxns) {
        const key = t.date.toISOString().split('T')[0];
        byDate.set(key, (byDate.get(key) ?? 0) - Number(t.amount));
      }

      // Build a complete series with zero-fill for days with no spend
      const trend: Array<{ date: string; amount: number }> = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
        const key = d.toISOString().split('T')[0];
        trend.push({ date: key, amount: byDate.get(key) ?? 0 });
      }

      const total = trend.reduce((s, d) => s + d.amount, 0);

      res.json({ trend, total, days });
    } catch (error) {
      next(error);
    }
  }
);

// ── Inward Funds detail (additive, read-only) ───────────────────────
// Returns all inflow transactions (bank + cash) for the Admin Dashboard
// "Inward Funds" click-through page. All data is live from posted
// BankTransaction + CashTransaction rows. No hardcoded values.
//
// Reversals of receipts (REVERSAL_OUT) are subtracted so cancelled
// receipts do not inflate the total. They are still returned in the
// transaction list so the audit trail is preserved.
router.get(
  '/admin-inflow-detail',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '5000'), 10) || 5000, 1), 5000);

      const bankInflowTypes = ['DEPOSIT', 'TRANSFER_IN', 'MANUAL_DEPOSIT'];
      const cashInflowTypes = ['IN', 'TRANSFER_IN'];
      const bankReversalOutTypes = ['REVERSAL_OUT']; // reversed receipts
      const cashReversalOutTypes = ['REVERSAL_OUT'];

      const [bankBaseInflowAgg, bankReversalOutAgg, cashBaseInflowAgg, cashReversalOutAgg, bankBaseInTxns, bankReversalOutTxns, cashBaseInTxns, cashReversalOutTxns] = await Promise.all([
        // Bank base inflows
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankInflowTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Bank reversals of receipts — subtract from inward
        prisma.bankTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: bankReversalOutTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Cash base inflows
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashInflowTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Cash reversals of receipts — subtract from inward
        prisma.cashTransaction.aggregate({
          where: {
            status: 'POSTED',
            type: { in: cashReversalOutTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          _sum: { amount: true },
          _count: true,
        }),
        // Bank base inflow transactions
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankInflowTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          include: { bankAccount: { select: { accountName: true } } },
          orderBy: { date: 'desc' },
          take: limit,
        }),
        // Bank reversal of receipt transactions
        prisma.bankTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: bankReversalOutTypes },
            bankAccount: { projectId, deletedAt: null },
          },
          include: { bankAccount: { select: { accountName: true } } },
          orderBy: { date: 'desc' },
          take: limit,
        }),
        // Cash base inflow transactions
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashInflowTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          include: { cashAccount: { select: { name: true } } },
          orderBy: { date: 'desc' },
          take: limit,
        }),
        // Cash reversal of receipt transactions
        prisma.cashTransaction.findMany({
          where: {
            status: 'POSTED',
            type: { in: cashReversalOutTypes },
            cashAccount: { projectId, deletedAt: null },
          },
          include: { cashAccount: { select: { name: true } } },
          orderBy: { date: 'desc' },
          take: limit,
        }),
      ]);

      const baseInflow =
        Number(bankBaseInflowAgg._sum.amount ?? 0) + Number(cashBaseInflowAgg._sum.amount ?? 0);
      const reversalOut =
        Number(bankReversalOutAgg._sum.amount ?? 0) + Number(cashReversalOutAgg._sum.amount ?? 0);
      const totalAmount = baseInflow - reversalOut;
      const totalCount =
        (bankBaseInflowAgg._count ?? 0) + (cashBaseInflowAgg._count ?? 0) +
        (bankReversalOutAgg._count ?? 0) + (cashReversalOutAgg._count ?? 0);

      const transactions = [
        ...bankBaseInTxns.map((t) => ({
          id: t.id,
          account: t.bankAccount?.accountName ?? 'Bank',
          accountType: 'BANK' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          type: t.type,
          date: t.date.toISOString(),
        })),
        ...bankReversalOutTxns.map((t) => ({
          id: t.id,
          account: t.bankAccount?.accountName ?? 'Bank',
          accountType: 'BANK' as const,
          amount: -Number(t.amount),
          description: t.description ?? '',
          type: t.type,
          date: t.date.toISOString(),
        })),
        ...cashBaseInTxns.map((t) => ({
          id: t.id,
          account: t.cashAccount?.name ?? 'Cash',
          accountType: 'CASH' as const,
          amount: Number(t.amount),
          description: t.description ?? '',
          type: t.type,
          date: t.date.toISOString(),
        })),
        ...cashReversalOutTxns.map((t) => ({
          id: t.id,
          account: t.cashAccount?.name ?? 'Cash',
          accountType: 'CASH' as const,
          amount: -Number(t.amount),
          description: t.description ?? '',
          type: t.type,
          date: t.date.toISOString(),
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ totalAmount, totalCount, transactions });
    } catch (error) {
      next(error);
    }
  }
);

// ── Short Advance / Loan detail ──────────────────────────────────────
// Returns the individual cash loan receipt transactions that make up the
// shortAdvance figure shown on the dashboard.  A short advance is a cash
// receipt (IN / REVERSAL_OUT) whose journal voucher has a credit entry in
// a ledger whose group contains "loan" (case-insensitive).
router.get(
  '/admin-short-advance-detail',
  rbacMiddleware(Permission.VIEW_DASHBOARD),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '5000'), 10) || 5000, 1), 5000);

      // 1. Fetch all posted cash receipt transactions linked to a voucher.
      const cashReceipts = await prisma.cashTransaction.findMany({
        where: {
          status: 'POSTED',
          type: { in: ['IN', 'REVERSAL_OUT'] },
          cashAccount: { projectId, deletedAt: null },
          referenceId: { not: null },
        },
        include: { cashAccount: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: limit,
      });

      const voucherIds = cashReceipts
        .map((t) => t.referenceId)
        .filter((id): id is string => !!id);

      if (voucherIds.length === 0) {
        res.json({ totalAmount: 0, totalCount: 0, transactions: [] });
        return;
      }

      // 2. Find which vouchers have a loan-group credit ledger entry.
      const loanEntries = await prisma.ledgerEntry.findMany({
        where: {
          journalVoucherId: { in: voucherIds },
          credit: { gt: 0 },
          ledger: { group: { contains: 'loan', mode: 'insensitive' }, projectId, deletedAt: null },
          journalVoucher: { status: 'POSTED', deletedAt: null },
        },
        select: { journalVoucherId: true, ledger: { select: { name: true } } },
      });
      const loanVoucherIds = new Set(loanEntries.map((e) => e.journalVoucherId));
      const loanLedgerByVoucher = new Map(loanEntries.map((e) => [e.journalVoucherId, e.ledger.name]));

      // 3. Keep only the cash receipts whose voucher is a loan receipt.
      const loanTxns = cashReceipts.filter((t) => loanVoucherIds.has(t.referenceId ?? ''));

      const totalAmount = loanTxns.reduce(
        (sum, t) => sum + (t.type === 'REVERSAL_OUT' ? -Number(t.amount) : Number(t.amount)),
        0,
      );

      const transactions = loanTxns.map((t) => ({
        id: t.id,
        account: t.cashAccount?.name ?? 'Cash',
        amount: t.type === 'REVERSAL_OUT' ? -Number(t.amount) : Number(t.amount),
        description: t.description ?? '',
        type: t.type,
        ledger: loanLedgerByVoucher.get(t.referenceId ?? '') ?? 'Loan',
        date: t.date.toISOString(),
      })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({ totalAmount, totalCount: transactions.length, transactions });
    } catch (error) {
      next(error);
    }
  }
);
