import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  LedgerGroup,
  isDebitNatureGroup,
  isBalanceSheetGroup,
  VoucherType,
} from '@hospital-erp/shared';
import {
  ledgerStatementSchema,
  dayBookSchema,
  trialBalanceSchema,
  profitLossSchema,
  balanceSheetSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';

const router = Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════
// Ledger Statement — running balance for a single ledger
// Tally's most-used report: Display → Account Books → Ledger
// ═══════════════════════════════════════════════════════════
router.get(
  '/ledger-statement/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(ledgerStatementSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 100, startDate, endDate } = req.query as Record<string, unknown>;

      const ledger = await prisma.ledger.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!ledger) {
        res.status(404).json({ error: 'Ledger not found' });
        return;
      }

      // Build date filter
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) dateFilter.gte = new Date(String(startDate));
      if (endDate) dateFilter.lte = new Date(String(endDate));

      // Compute opening balance as of startDate (sum of all entries before startDate)
      let openingBalance = Number(ledger.openingBalance);
      if (startDate) {
        const beforeEntries = await prisma.ledgerEntry.aggregate({
          where: {
            ledgerId: ledger.id,
            voucherDate: { lt: new Date(String(startDate)) },
          },
          _sum: { debit: true, credit: true },
        });
        // For debit-nature: opening = opening + debits - credits
        // For credit-nature: opening = opening - debits + credits (but we store credit-nature as negative)
        // Since we store debit - credit as the balance delta, opening + sum(debit - credit) works for both
        openingBalance = Number(ledger.openingBalance) + (Number(beforeEntries._sum.debit) - Number(beforeEntries._sum.credit));
      }

      // Fetch entries in date range
      const where = {
        ledgerId: ledger.id,
        ...(Object.keys(dateFilter).length > 0 ? { voucherDate: dateFilter } : {}),
      };

      const [entries, total] = await Promise.all([
        prisma.ledgerEntry.findMany({
          where,
          orderBy: [{ voucherDate: 'asc' }, { createdAt: 'asc' }],
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.ledgerEntry.count({ where }),
      ]);

      // Compute running balance
      let runningBalance = openingBalance;
      const statement = entries.map((e) => {
        runningBalance += Number(e.debit) - Number(e.credit);
        return {
          id: e.id,
          voucherNumber: e.voucherNumber,
          voucherType: e.voucherType,
          voucherDate: e.voucherDate.toISOString(),
          debit: Number(e.debit),
          credit: Number(e.credit),
          description: e.description,
          balance: runningBalance,
        };
      });

      // Closing balance = opening + all entries in range
      const closingBalance = runningBalance;

      res.json({
        ledger: {
          id: ledger.id,
          name: ledger.name,
          group: ledger.group,
          linkedEntityType: ledger.linkedEntityType,
          openingBalance: Number(ledger.openingBalance),
          currentBalance: Number(ledger.currentBalance),
          isDebitNature: isDebitNatureGroup(ledger.group as LedgerGroup),
        },
        openingBalance,
        closingBalance,
        data: statement,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Day Book — all vouchers on a given date (or date range)
// Tally's default opening view
// ═══════════════════════════════════════════════════════════
router.get(
  '/day-book',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(dayBookSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 100, date, startDate, endDate, voucherType } = req.query as Record<string, unknown>;

      const where: any = {
        projectId,
        deletedAt: null,
        status: 'POSTED',
        voucherType: { not: VoucherType.JOURNAL }, // exclude legacy JVs
        ...(voucherType ? { voucherType: String(voucherType) } : {}),
      };

      if (date) {
        const dayStart = new Date(String(date));
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(String(date));
        dayEnd.setHours(23, 59, 59, 999);
        where.date = { gte: dayStart, lte: dayEnd };
      } else if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: new Date(String(startDate)) } : {}),
          ...(endDate ? { lte: new Date(String(endDate)) } : {}),
        };
      }

      const [vouchers, total] = await Promise.all([
        prisma.journalVoucher.findMany({
          where,
          include: {
            ledgerEntries: {
              include: { ledger: { select: { name: true, group: true } } },
              orderBy: { createdAt: 'asc' },
            },
            createdByUser: { select: { name: true } },
          },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.journalVoucher.count({ where }),
      ]);

      const totalDebit = vouchers.reduce((s, v) => s + Number(v.totalDebit), 0);
      const totalCredit = vouchers.reduce((s, v) => s + Number(v.totalCredit), 0);

      res.json({
        data: vouchers.map((v) => ({
          id: v.id,
          jvNumber: v.jvNumber,
          voucherType: v.voucherType,
          date: v.date.toISOString(),
          description: v.description,
          totalDebit: Number(v.totalDebit),
          totalCredit: Number(v.totalCredit),
          createdBy: v.createdByUser?.name,
          entries: v.ledgerEntries.map((e) => ({
            ledgerName: e.ledger.name,
            ledgerGroup: e.ledger.group,
            debit: Number(e.debit),
            credit: Number(e.credit),
            description: e.description,
          })),
        })),
        summary: { count: total, totalDebit, totalCredit },
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Trial Balance — all ledgers grouped, debit or credit closing
// ═══════════════════════════════════════════════════════════
router.get(
  '/trial-balance',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(trialBalanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asOfDate = req.query.asOfDate ? new Date(String(req.query.asOfDate)) : new Date();

      const ledgers = await prisma.ledger.findMany({
        where: { projectId, deletedAt: null, isActive: true },
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
      });

      // For each ledger, compute balance as of asOfDate
      const rows = await Promise.all(
        ledgers.map(async (l) => {
          const entries = await prisma.ledgerEntry.aggregate({
            where: {
              ledgerId: l.id,
              voucherDate: { lte: asOfDate },
            },
            _sum: { debit: true, credit: true },
          });
          // Balance = opening + (debit - credit)
          // For debit-nature: positive = debit balance; negative = credit balance
          // For credit-nature: negative = credit balance; positive = debit balance
          const balance = Number(l.openingBalance) + (Number(entries._sum.debit) - Number(entries._sum.credit));
          const isDebit = isDebitNatureGroup(l.group as LedgerGroup);
          // Trial balance shows: debit-nature positive → debit column; negative → credit column
          // credit-nature negative → credit column; positive → debit column
          const isDebitBalance = isDebit ? balance >= 0 : balance > 0;
          return {
            id: l.id,
            name: l.name,
            group: l.group,
            isDebitNature: isDebit,
            balance,
            debit: isDebitBalance ? Math.abs(balance) : 0,
            credit: !isDebitBalance ? Math.abs(balance) : 0,
          };
        }),
      );

      // Group by ledger group
      const grouped: Record<string, { debit: number; credit: number; ledgers: typeof rows }> = {};
      for (const row of rows) {
        if (!grouped[row.group]) grouped[row.group] = { debit: 0, credit: 0, ledgers: [] };
        grouped[row.group].debit += row.debit;
        grouped[row.group].credit += row.credit;
        grouped[row.group].ledgers.push(row);
      }

      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

      res.json({
        asOfDate: asOfDate.toISOString(),
        groups: Object.entries(grouped).map(([group, data]) => ({
          group,
          debit: data.debit,
          credit: data.credit,
          ledgers: data.ledgers,
        })),
        totals: { debit: totalDebit, credit: totalCredit, difference: totalDebit - totalCredit },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Profit & Loss — Direct + Indirect Expenses vs Incomes
// ═══════════════════════════════════════════════════════════
router.get(
  '/profit-loss',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(profitLossSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : new Date();

      const ledgers = await prisma.ledger.findMany({
        where: { projectId, deletedAt: null, isActive: true },
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
      });

      const expenseGroups = [LedgerGroup.DIRECT_EXPENSE, LedgerGroup.INDIRECT_EXPENSE, LedgerGroup.PURCHASE];
      const incomeGroups = [LedgerGroup.DIRECT_INCOME, LedgerGroup.INDIRECT_INCOME, LedgerGroup.SALES];

      const rows = await Promise.all(
        ledgers.map(async (l) => {
          const entries = await prisma.ledgerEntry.aggregate({
            where: {
              ledgerId: l.id,
              voucherDate: { gte: startDate, lte: endDate },
            },
            _sum: { debit: true, credit: true },
          });
          const balance = Number(l.openingBalance) + (Number(entries._sum.debit) - Number(entries._sum.credit));
          return {
            id: l.id,
            name: l.name,
            group: l.group,
            balance,
            // Expenses: debit balance = expense amount
            // Income: credit balance = income amount (stored as negative)
            amount: expenseGroups.includes(l.group as LedgerGroup)
              ? Math.abs(balance)
              : incomeGroups.includes(l.group as LedgerGroup)
                ? Math.abs(balance)
                : 0,
          };
        }),
      );

      const directExpenses = rows.filter((r) => r.group === LedgerGroup.DIRECT_EXPENSE);
      const indirectExpenses = rows.filter((r) => r.group === LedgerGroup.INDIRECT_EXPENSE);
      const purchases = rows.filter((r) => r.group === LedgerGroup.PURCHASE);
      const directIncome = rows.filter((r) => r.group === LedgerGroup.DIRECT_INCOME);
      const indirectIncome = rows.filter((r) => r.group === LedgerGroup.INDIRECT_INCOME);
      const sales = rows.filter((r) => r.group === LedgerGroup.SALES);

      const totalDirectExpense = directExpenses.reduce((s, r) => s + r.amount, 0);
      const totalIndirectExpense = indirectExpenses.reduce((s, r) => s + r.amount, 0);
      const totalPurchases = purchases.reduce((s, r) => s + r.amount, 0);
      const totalDirectIncome = directIncome.reduce((s, r) => s + r.amount, 0);
      const totalIndirectIncome = indirectIncome.reduce((s, r) => s + r.amount, 0);
      const totalSales = sales.reduce((s, r) => s + r.amount, 0);

      const totalExpense = totalDirectExpense + totalIndirectExpense + totalPurchases;
      const totalIncome = totalDirectIncome + totalIndirectIncome + totalSales;
      const netProfit = totalIncome - totalExpense;

      res.json({
        dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        expenses: {
          purchases: { ledgers: purchases, total: totalPurchases },
          directExpenses: { ledgers: directExpenses, total: totalDirectExpense },
          indirectExpenses: { ledgers: indirectExpenses, total: totalIndirectExpense },
          total: totalExpense,
        },
        income: {
          sales: { ledgers: sales, total: totalSales },
          directIncome: { ledgers: directIncome, total: totalDirectIncome },
          indirectIncome: { ledgers: indirectIncome, total: totalIndirectIncome },
          total: totalIncome,
        },
        netProfit,
        isProfit: netProfit >= 0,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Balance Sheet — Assets = Liabilities + Capital
// ═══════════════════════════════════════════════════════════
router.get(
  '/balance-sheet',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(balanceSheetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asOfDate = req.query.asOfDate ? new Date(String(req.query.asOfDate)) : new Date();

      const ledgers = await prisma.ledger.findMany({
        where: { projectId, deletedAt: null, isActive: true },
        orderBy: [{ group: 'asc' }, { name: 'asc' }],
      });

      // Only balance-sheet groups
      const bsLedgers = ledgers.filter((l) => isBalanceSheetGroup(l.group as LedgerGroup));

      const rows = await Promise.all(
        bsLedgers.map(async (l) => {
          const entries = await prisma.ledgerEntry.aggregate({
            where: {
              ledgerId: l.id,
              voucherDate: { lte: asOfDate },
            },
            _sum: { debit: true, credit: true },
          });
          const balance = Number(l.openingBalance) + (Number(entries._sum.debit) - Number(entries._sum.credit));
          const isDebit = isDebitNatureGroup(l.group as LedgerGroup);
          // Assets: debit balance = asset value
          // Liabilities/Capital: credit balance = liability value (stored as negative)
          const amount = isDebit ? balance : -balance;
          return {
            id: l.id,
            name: l.name,
            group: l.group,
            balance,
            amount: Math.max(0, amount),
          };
        }),
      );

      // Group into Assets and Liabilities+Capital
      const assetGroups = [LedgerGroup.FIXED_ASSET, LedgerGroup.CURRENT_ASSET, LedgerGroup.BANK, LedgerGroup.CASH, LedgerGroup.SUNDRY_DEBTORS];
      const liabilityGroups = [LedgerGroup.CURRENT_LIABILITY, LedgerGroup.LOAN, LedgerGroup.DUTIES_TAXES, LedgerGroup.SUNDRY_CREDITORS, LedgerGroup.CAPITAL_ACCOUNT];

      const assets = rows.filter((r) => assetGroups.includes(r.group as LedgerGroup));
      const liabilities = rows.filter((r) => liabilityGroups.includes(r.group as LedgerGroup));

      // Compute P&L net profit to add to capital (closing balance)
      const plLedgers = ledgers.filter((l) => !isBalanceSheetGroup(l.group as LedgerGroup));
      let netProfit = 0;
      for (const l of plLedgers) {
        const entries = await prisma.ledgerEntry.aggregate({
          where: { ledgerId: l.id, voucherDate: { lte: asOfDate } },
          _sum: { debit: true, credit: true },
        });
        const balance = Number(l.openingBalance) + (Number(entries._sum.debit) - Number(entries._sum.credit));
        // Expense groups: debit balance = expense; Income groups: credit balance = income
        const expenseGroups = [LedgerGroup.DIRECT_EXPENSE, LedgerGroup.INDIRECT_EXPENSE, LedgerGroup.PURCHASE];
        const incomeGroups = [LedgerGroup.DIRECT_INCOME, LedgerGroup.INDIRECT_INCOME, LedgerGroup.SALES];
        if (expenseGroups.includes(l.group as LedgerGroup)) {
          netProfit -= balance; // expense reduces profit
        } else if (incomeGroups.includes(l.group as LedgerGroup)) {
          netProfit += -balance; // income (credit balance, stored negative) increases profit
        }
      }

      const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
      const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
      const totalCapitalAndLiabilities = totalLiabilities + Math.max(0, netProfit);

      // Group assets and liabilities by group
      const groupedAssets: Record<string, typeof assets> = {};
      for (const a of assets) {
        if (!groupedAssets[a.group]) groupedAssets[a.group] = [];
        groupedAssets[a.group].push(a);
      }
      const groupedLiabilities: Record<string, typeof liabilities> = {};
      for (const l of liabilities) {
        if (!groupedLiabilities[l.group]) groupedLiabilities[l.group] = [];
        groupedLiabilities[l.group].push(l);
      }

      res.json({
        asOfDate: asOfDate.toISOString(),
        assets: Object.entries(groupedAssets).map(([group, ledgers]) => ({
          group,
          ledgers,
          total: ledgers.reduce((s, r) => s + r.amount, 0),
        })),
        liabilities: Object.entries(groupedLiabilities).map(([group, ledgers]) => ({
          group,
          ledgers,
          total: ledgers.reduce((s, r) => s + r.amount, 0),
        })),
        netProfit,
        totals: {
          totalAssets,
          totalLiabilities,
          totalCapitalAndLiabilities,
          difference: totalAssets - totalCapitalAndLiabilities,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
