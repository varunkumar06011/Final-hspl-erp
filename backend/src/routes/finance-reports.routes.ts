import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import PDFDocument from 'pdfkit';

const router = Router();
router.use(authMiddleware);

// ── Budget vs Actual report ──
// Returns all budget heads with allocated, committed, actual, paid, available, utilization %
router.get(
  '/budget-vs-actual',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const heads = await prisma.budgetHead.findMany({
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
          status: true,
        },
      });

      const report = heads.map((h) => {
        const allocated = Number(h.allocatedAmount);
        const committed = Number(h.committedAmount);
        const actual = Number(h.actualAmount);
        const paid = Number(h.paidAmount);
        const available = allocated - actual;
        const utilizationPct = allocated > 0 ? (actual / allocated) * 100 : 0;
        const paidPct = actual > 0 ? (paid / actual) * 100 : 0;
        return {
          ...h,
          allocated,
          committed,
          actual,
          paid,
          available,
          utilizationPct: Math.round(utilizationPct * 100) / 100,
          paidPct: Math.round(paidPct * 100) / 100,
        };
      });

      const totals = report.reduce(
        (acc, r) => ({
          allocated: acc.allocated + r.allocated,
          committed: acc.committed + r.committed,
          actual: acc.actual + r.actual,
          paid: acc.paid + r.paid,
          available: acc.available + r.available,
        }),
        { allocated: 0, committed: 0, actual: 0, paid: 0, available: 0 },
      );

      res.json({ data: report, totals });
    } catch (error) {
      next(error);
    }
  },
);

// ── Cash flow report ──
// Returns bank + cash transactions in a date range, grouped by day
router.get(
  '/cash-flow',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : new Date();

      const [bankTxns, cashTxns] = await Promise.all([
        prisma.bankTransaction.findMany({
          where: {
            bankAccount: { projectId, deletedAt: null },
            date: { gte: startDate, lte: endDate },
            status: 'POSTED',
          },
          include: { bankAccount: { select: { accountName: true } } },
          orderBy: { date: 'asc' },
        }),
        prisma.cashTransaction.findMany({
          where: {
            cashAccount: { projectId, deletedAt: null },
            date: { gte: startDate, lte: endDate },
            status: 'POSTED',
          },
          include: { cashAccount: { select: { name: true } } },
          orderBy: { date: 'asc' },
        }),
      ]);

      type FlowEntry = {
        date: string;
        account: string;
        accountType: 'BANK' | 'CASH';
        type: string;
        inflow: number;
        outflow: number;
        description: string | null;
        referenceType: string;
      };

      const entries: FlowEntry[] = [];

      for (const t of bankTxns) {
        const isIn = ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
        entries.push({
          date: t.date.toISOString().split('T')[0],
          account: t.bankAccount.accountName,
          accountType: 'BANK',
          type: t.type,
          inflow: isIn ? Number(t.amount) : 0,
          outflow: isIn ? 0 : Number(t.amount),
          description: t.description,
          referenceType: t.referenceType,
        });
      }

      for (const t of cashTxns) {
        const isIn = ['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
        entries.push({
          date: t.date.toISOString().split('T')[0],
          account: t.cashAccount.name,
          accountType: 'CASH',
          type: t.type,
          inflow: isIn ? Number(t.amount) : 0,
          outflow: isIn ? 0 : Number(t.amount),
          description: t.description,
          referenceType: t.referenceType,
        });
      }

      entries.sort((a, b) => a.date.localeCompare(b.date));

      const totalInflow = entries.reduce((s, e) => s + e.inflow, 0);
      const totalOutflow = entries.reduce((s, e) => s + e.outflow, 0);
      const netFlow = totalInflow - totalOutflow;

      res.json({
        data: entries,
        summary: { totalInflow, totalOutflow, netFlow, count: entries.length },
        dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Bank + Cash account summary (balances + recent activity) ──
router.get(
  '/account-summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const [bankAccounts, cashAccounts] = await Promise.all([
        prisma.bankAccount.findMany({
          where: { projectId, deletedAt: null },
          select: {
            id: true,
            accountName: true,
            bankName: true,
            accountNumber: true,
            openingBalance: true,
            currentBalance: true,
            isActive: true,
            _count: { select: { transactions: { where: { status: 'POSTED' } } } },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.cashAccount.findMany({
          where: { projectId, deletedAt: null },
          select: {
            id: true,
            name: true,
            openingBalance: true,
            currentBalance: true,
            isActive: true,
            _count: { select: { transactions: { where: { status: 'POSTED' } } } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      const bankTotal = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
      const cashTotal = cashAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);

      res.json({
        bankAccounts: bankAccounts.map((a) => ({
          ...a,
          openingBalance: Number(a.openingBalance),
          currentBalance: Number(a.currentBalance),
        })),
        cashAccounts: cashAccounts.map((a) => ({
          ...a,
          openingBalance: Number(a.openingBalance),
          currentBalance: Number(a.currentBalance),
        })),
        totals: { bankTotal, cashTotal, grandTotal: bankTotal + cashTotal },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Owner equity summary ──
router.get(
  '/owner-equity',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const ownerAccounts = await prisma.ownerAccount.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          ownerName: true,
          openingBalance: true,
          currentBalance: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const totalOwedToOwner = ownerAccounts.reduce(
        (s, a) => s + Math.max(0, Number(a.currentBalance)),
        0,
      );
      const totalOwedByOwner = ownerAccounts.reduce(
        (s, a) => s + Math.min(0, Number(a.currentBalance)),
        0,
      );

      res.json({
        accounts: ownerAccounts.map((a) => ({
          ...a,
          openingBalance: Number(a.openingBalance),
          currentBalance: Number(a.currentBalance),
        })),
        totals: {
          totalOwedToOwner,
          totalOwedByOwner: Math.abs(totalOwedByOwner),
          netOwnerEquity: totalOwedToOwner + totalOwedByOwner,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Finance dashboard (all KPIs in one call) ──
router.get(
  '/dashboard',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);

      const [budgetHeads, bankAccounts, cashAccounts, ownerAccounts] = await Promise.all([
        prisma.budgetHead.findMany({
          where: { projectId, deletedAt: null },
          select: { allocatedAmount: true, committedAmount: true, actualAmount: true, paidAmount: true },
        }),
        prisma.bankAccount.findMany({
          where: { projectId, deletedAt: null, isActive: true },
          select: { currentBalance: true },
        }),
        prisma.cashAccount.findMany({
          where: { projectId, deletedAt: null, isActive: true },
          select: { currentBalance: true },
        }),
        prisma.ownerAccount.findMany({
          where: { projectId, deletedAt: null },
          select: { currentBalance: true },
        }),
      ]);

      const totalAllocated = budgetHeads.reduce((s, h) => s + Number(h.allocatedAmount), 0);
      const totalCommitted = budgetHeads.reduce((s, h) => s + Number(h.committedAmount), 0);
      const totalActual = budgetHeads.reduce((s, h) => s + Number(h.actualAmount), 0);
      const totalPaid = budgetHeads.reduce((s, h) => s + Number(h.paidAmount), 0);
      const totalAvailable = totalAllocated - totalActual;
      const totalUnpaid = totalActual - totalPaid;

      const bankBalance = bankAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
      const cashBalance = cashAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);
      const totalLiquidity = bankBalance + cashBalance;

      const ownerEquity = ownerAccounts.reduce((s, a) => s + Number(a.currentBalance), 0);

      res.json({
        budget: {
          totalAllocated,
          totalCommitted,
          totalActual,
          totalPaid,
          totalAvailable,
          totalUnpaid,
          utilizationPct: totalAllocated > 0 ? Math.round((totalActual / totalAllocated) * 10000) / 100 : 0,
        },
        liquidity: {
          bankBalance,
          cashBalance,
          totalLiquidity,
        },
        ownerEquity,
        budgetHeadCount: budgetHeads.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Bank reconciliation: compare system balance vs transactions sum ──
router.get(
  '/bank-reconciliation',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const accounts = await prisma.bankAccount.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          accountName: true,
          bankName: true,
          accountNumber: true,
          openingBalance: true,
          currentBalance: true,
          isActive: true,
          transactions: {
            where: { status: 'POSTED' },
            select: { type: true, amount: true, date: true, description: true, referenceType: true },
            orderBy: { date: 'desc' },
            take: 5,
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const report = await Promise.all(
        accounts.map(async (acc) => {
          // Calculate expected balance: opening + deposits - withdrawals
          const txns = await prisma.bankTransaction.findMany({
            where: { bankAccountId: acc.id, status: 'POSTED' },
            select: { type: true, amount: true },
          });
          const deposits = txns
            .filter((t) => ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type))
            .reduce((s, t) => s + Number(t.amount), 0);
          const withdrawals = txns
            .filter((t) => !['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type))
            .reduce((s, t) => s + Number(t.amount), 0);
          const expectedBalance = Number(acc.openingBalance) + deposits - withdrawals;
          const systemBalance = Number(acc.currentBalance);
          const discrepancy = systemBalance - expectedBalance;

          return {
            id: acc.id,
            accountName: acc.accountName,
            bankName: acc.bankName,
            accountNumber: acc.accountNumber,
            openingBalance: Number(acc.openingBalance),
            currentBalance: systemBalance,
            expectedBalance,
            discrepancy,
            isReconciled: Math.abs(discrepancy) < 0.01,
            isActive: acc.isActive,
            transactionCount: txns.length,
            recentTransactions: acc.transactions.map((t) => ({
              type: t.type,
              amount: Number(t.amount),
              date: t.date.toISOString().split('T')[0],
              description: t.description,
              referenceType: t.referenceType,
            })),
          };
        }),
      );

      const totalDiscrepancy = report.reduce((s, r) => s + Math.abs(r.discrepancy), 0);
      const reconciledCount = report.filter((r) => r.isReconciled).length;

      res.json({
        data: report,
        summary: {
          totalAccounts: report.length,
          reconciledCount,
          unreconciledCount: report.length - reconciledCount,
          totalDiscrepancy,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Cash reconciliation: same as bank but for cash accounts ──
router.get(
  '/cash-reconciliation',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const accounts = await prisma.cashAccount.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          name: true,
          openingBalance: true,
          currentBalance: true,
          isActive: true,
          transactions: {
            where: { status: 'POSTED' },
            select: { type: true, amount: true, date: true, description: true, referenceType: true },
            orderBy: { date: 'desc' },
            take: 5,
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const report = await Promise.all(
        accounts.map(async (acc) => {
          const txns = await prisma.cashTransaction.findMany({
            where: { cashAccountId: acc.id, status: 'POSTED' },
            select: { type: true, amount: true },
          });
          const inflows = txns
            .filter((t) => ['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type))
            .reduce((s, t) => s + Number(t.amount), 0);
          const outflows = txns
            .filter((t) => !['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type))
            .reduce((s, t) => s + Number(t.amount), 0);
          const expectedBalance = Number(acc.openingBalance) + inflows - outflows;
          const systemBalance = Number(acc.currentBalance);
          const discrepancy = systemBalance - expectedBalance;

          return {
            id: acc.id,
            name: acc.name,
            openingBalance: Number(acc.openingBalance),
            currentBalance: systemBalance,
            expectedBalance,
            discrepancy,
            isReconciled: Math.abs(discrepancy) < 0.01,
            isActive: acc.isActive,
            transactionCount: txns.length,
            recentTransactions: acc.transactions.map((t) => ({
              type: t.type,
              amount: Number(t.amount),
              date: t.date.toISOString().split('T')[0],
              description: t.description,
              referenceType: t.referenceType,
            })),
          };
        }),
      );

      const totalDiscrepancy = report.reduce((s, r) => s + Math.abs(r.discrepancy), 0);
      const reconciledCount = report.filter((r) => r.isReconciled).length;

      res.json({
        data: report,
        summary: {
          totalAccounts: report.length,
          reconciledCount,
          unreconciledCount: report.length - reconciledCount,
          totalDiscrepancy,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Vendor-wise payment aging summary ──
// Shows each vendor with their total invoiced, paid, outstanding, and aging buckets
router.get(
  '/vendor-aging',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendors = await prisma.vendor.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          name: true,
          vendorCode: true,
          invoices: {
            where: { deletedAt: null },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceCode: true,
              totalAmount: true,
              date: true,
              stockStatus: true,
              verificationStatus: true,
              paymentRequests: {
                select: {
                  status: true,
                  payments: { select: { amount: true, date: true } },
                },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      const now = new Date();
      const report = vendors.map((vendor) => {
        let totalInvoiced = 0;
        let totalPaid = 0;
        let totalOutstanding = 0;
        const agingBuckets = { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: 0 };
        const invoiceDetails: Array<{
          invoiceNumber: string;
          invoiceCode: string;
          totalAmount: number;
          paidAmount: number;
          outstanding: number;
          ageDays: number;
          date: string;
        }> = [];

        for (const inv of vendor.invoices) {
          const invTotal = Number(inv.totalAmount);
          // Paid = sum of all payment amounts across all payment requests for this invoice
          const paid = inv.paymentRequests.reduce(
            (s, pr) => s + pr.payments.reduce((ps, p) => ps + Number(p.amount), 0),
            0,
          );
          const outstanding = invTotal - paid;
          const ageMs = now.getTime() - new Date(inv.date).getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

          totalInvoiced += invTotal;
          totalPaid += paid;
          totalOutstanding += outstanding;

          if (outstanding > 0.01) {
            if (ageDays <= 30) agingBuckets.current += outstanding;
            else if (ageDays <= 60) agingBuckets.days30 += outstanding;
            else if (ageDays <= 90) agingBuckets.days60 += outstanding;
            else if (ageDays <= 120) agingBuckets.days90 += outstanding;
            else agingBuckets.days90Plus += outstanding;

            invoiceDetails.push({
              invoiceNumber: inv.invoiceNumber,
              invoiceCode: inv.invoiceCode,
              totalAmount: invTotal,
              paidAmount: paid,
              outstanding,
              ageDays,
              date: new Date(inv.date).toISOString().split('T')[0],
            });
          }
        }

        return {
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorCode: vendor.vendorCode,
          invoiceCount: vendor.invoices.length,
          totalInvoiced,
          totalPaid,
          totalOutstanding,
          agingBuckets,
          invoicesWithOutstanding: invoiceDetails.sort((a, b) => b.ageDays - a.ageDays),
        };
      }).filter((r) => r.totalInvoiced > 0);

      const totals = report.reduce(
        (acc, r) => ({
          totalInvoiced: acc.totalInvoiced + r.totalInvoiced,
          totalPaid: acc.totalPaid + r.totalPaid,
          totalOutstanding: acc.totalOutstanding + r.totalOutstanding,
          current: acc.current + r.agingBuckets.current,
          days30: acc.days30 + r.agingBuckets.days30,
          days60: acc.days60 + r.agingBuckets.days60,
          days90: acc.days90 + r.agingBuckets.days90,
          days90Plus: acc.days90Plus + r.agingBuckets.days90Plus,
        }),
        { totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0, current: 0, days30: 0, days60: 0, days90: 0, days90Plus: 0 },
      );

      res.json({ data: report, totals });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// PDF EXPORT ENDPOINTS
// ═══════════════════════════════════════════════════════════

const PDF_PRIMARY = '#1a5276';
const PDF_PRIMARY_LIGHT = '#d4e6f1';
const PDF_LIGHT_BG = '#f8f9fa';
const PDF_BORDER = '#bdc3c7';
const PDF_TEXT_DARK = '#2c3e50';
const PDF_TEXT_MUTED = '#7f8c8d';
const PDF_WHITE = '#ffffff';
const PDF_GREEN = '#27ae60';
const PDF_RED = '#c0392b';
const PDF_ORANGE = '#e67e22';

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function pdfHeader(doc: PDFKit.PDFDocument, title: string, projectName: string, subtitle?: string) {
  const pageWidth = 595;
  doc.rect(0, 0, pageWidth, 70).fill(PDF_PRIMARY);
  doc.fillColor(PDF_WHITE).fontSize(20).font('Helvetica-Bold').text(projectName || 'Vgrand Hospital', 50, 14);
  doc.fontSize(10).font('Helvetica').fillColor(PDF_PRIMARY_LIGHT).text(title, 50, 40);
  if (subtitle) {
    doc.fontSize(8).font('Helvetica').fillColor(PDF_PRIMARY_LIGHT).text(subtitle, 50, 55);
  }
  doc.fillColor(PDF_TEXT_MUTED).fontSize(8).font('Helvetica').text(
    `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    50, 78,
  );
}

function pdfFooter(doc: PDFKit.PDFDocument) {
  const pageWidth = 595;
  const pageHeight = 842;
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(PDF_TEXT_MUTED).fontSize(7).font('Helvetica').text(
      `Page ${i + 1} of ${pages.count}`,
      50, pageHeight - 30, { width: pageWidth - 100, align: 'center' },
    );
  }
}

// ── PDF: Budget vs Actual ──
router.get(
  '/pdf/budget-vs-actual',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
      const heads = await prisma.budgetHead.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { slNo: 'asc' },
      });

      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="budget-vs-actual.pdf"`);
      doc.pipe(res);

      pdfHeader(doc, 'BUDGET VS ACTUAL REPORT', project?.name ?? '', 'All budget heads with utilization');

      let y = 95;
      const margin = 50;
      const pageWidth = 595;
      const contentWidth = pageWidth - margin * 2;

      // Table headers
      const cols = [
        { label: 'Sl', w: 25 },
        { label: 'Particulars', w: 130 },
        { label: 'Allocated', w: 75, align: 'right' as const },
        { label: 'Committed', w: 75, align: 'right' as const },
        { label: 'Actual', w: 75, align: 'right' as const },
        { label: 'Paid', w: 75, align: 'right' as const },
        { label: 'Available', w: 75, align: 'right' as const },
        { label: 'Util %', w: 45, align: 'right' as const },
      ];

      doc.rect(margin, y, contentWidth, 18).fill(PDF_PRIMARY);
      let xh = margin;
      for (const c of cols) {
        doc.fillColor(PDF_WHITE).fontSize(7).font('Helvetica-Bold');
        if (c.align === 'right') {
          doc.text(c.label, xh, y + 5, { width: c.w, align: 'right' });
        } else {
          doc.text(c.label, xh + 2, y + 5, { width: c.w - 4 });
        }
        xh += c.w;
      }
      y += 18;

      // Rows
      let totalAllocated = 0, totalCommitted = 0, totalActual = 0, totalPaid = 0;
      for (const h of heads) {
        if (y > 780) { doc.addPage(); y = 50; }
        const allocated = Number(h.allocatedAmount);
        const committed = Number(h.committedAmount);
        const actual = Number(h.actualAmount);
        const paid = Number(h.paidAmount);
        const available = allocated - actual;
        const utilPct = allocated > 0 ? (actual / allocated) * 100 : 0;
        totalAllocated += allocated; totalCommitted += committed; totalActual += actual; totalPaid += paid;

        const bgColor = Math.floor(heads.indexOf(h)) % 2 === 0 ? PDF_WHITE : PDF_LIGHT_BG;
        doc.rect(margin, y, contentWidth, 20).fill(bgColor);
        doc.fillColor(PDF_TEXT_DARK).fontSize(7).font('Helvetica');
        let xr = margin;
        doc.text(String(h.slNo), xr + 2, y + 6, { width: cols[0].w - 4 });
        xr += cols[0].w;
        doc.text(h.particulars, xr + 2, y + 6, { width: cols[1].w - 4 });
        xr += cols[1].w;
        doc.text(fmtMoney(allocated), xr, y + 6, { width: cols[2].w, align: 'right' });
        xr += cols[2].w;
        doc.text(fmtMoney(committed), xr, y + 6, { width: cols[3].w, align: 'right' });
        xr += cols[3].w;
        doc.text(fmtMoney(actual), xr, y + 6, { width: cols[4].w, align: 'right' });
        xr += cols[4].w;
        doc.text(fmtMoney(paid), xr, y + 6, { width: cols[5].w, align: 'right' });
        xr += cols[5].w;
        doc.fillColor(available < 0 ? PDF_RED : PDF_GREEN).font('Helvetica-Bold');
        doc.text(fmtMoney(available), xr, y + 6, { width: cols[6].w, align: 'right' });
        xr += cols[6].w;
        doc.fillColor(utilPct > 90 ? PDF_RED : utilPct > 70 ? PDF_ORANGE : PDF_GREEN);
        doc.text(`${utilPct.toFixed(1)}%`, xr, y + 6, { width: cols[7].w, align: 'right' });
        y += 20;
      }

      // Totals row
      if (y > 780) { doc.addPage(); y = 50; }
      doc.rect(margin, y, contentWidth, 22).fill(PDF_PRIMARY);
      doc.fillColor(PDF_WHITE).fontSize(8).font('Helvetica-Bold');
      doc.text('TOTAL', margin + 2, y + 7, { width: cols[0].w + cols[1].w - 4 });
      let xt = margin + cols[0].w + cols[1].w;
      doc.text(fmtMoney(totalAllocated), xt, y + 7, { width: cols[2].w, align: 'right' });
      xt += cols[2].w;
      doc.text(fmtMoney(totalCommitted), xt, y + 7, { width: cols[3].w, align: 'right' });
      xt += cols[3].w;
      doc.text(fmtMoney(totalActual), xt, y + 7, { width: cols[4].w, align: 'right' });
      xt += cols[4].w;
      doc.text(fmtMoney(totalPaid), xt, y + 7, { width: cols[5].w, align: 'right' });
      xt += cols[5].w;
      const totalAvailable = totalAllocated - totalActual;
      doc.text(fmtMoney(totalAvailable), xt, y + 7, { width: cols[6].w, align: 'right' });
      y += 30;

      // Summary box
      doc.roundedRect(margin, y, contentWidth, 60, 5).fillAndStroke(PDF_LIGHT_BG, PDF_BORDER);
      doc.fillColor(PDF_PRIMARY).fontSize(9).font('Helvetica-Bold').text('Summary', margin + 10, y + 8);
      doc.fillColor(PDF_TEXT_DARK).fontSize(8).font('Helvetica');
      doc.text(`Total Allocated: ${fmtMoney(totalAllocated)}`, margin + 10, y + 24);
      doc.text(`Total Actual: ${fmtMoney(totalActual)}`, margin + 10, y + 36);
      doc.text(`Total Available: ${fmtMoney(totalAvailable)}`, margin + 200, y + 24);
      const overallUtil = totalAllocated > 0 ? (totalActual / totalAllocated) * 100 : 0;
      doc.text(`Overall Utilization: ${overallUtil.toFixed(1)}%`, margin + 200, y + 36);

      pdfFooter(doc);
      doc.end();
    } catch (error) {
      next(error);
    }
  },
);

// ── PDF: Cash Flow ──
router.get(
  '/pdf/cash-flow',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
      const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : new Date();

      const [bankTxns, cashTxns] = await Promise.all([
        prisma.bankTransaction.findMany({
          where: { bankAccount: { projectId, deletedAt: null }, date: { gte: startDate, lte: endDate }, status: 'POSTED' },
          include: { bankAccount: { select: { accountName: true } } },
          orderBy: { date: 'asc' },
        }),
        prisma.cashTransaction.findMany({
          where: { cashAccount: { projectId, deletedAt: null }, date: { gte: startDate, lte: endDate }, status: 'POSTED' },
          include: { cashAccount: { select: { name: true } } },
          orderBy: { date: 'asc' },
        }),
      ]);

      type Entry = { date: string; account: string; type: string; inflow: number; outflow: number; description: string | null };
      const entries: Entry[] = [];
      for (const t of bankTxns) {
        const isIn = ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
        entries.push({ date: t.date.toISOString().split('T')[0], account: t.bankAccount.accountName, type: t.type, inflow: isIn ? Number(t.amount) : 0, outflow: isIn ? 0 : Number(t.amount), description: t.description });
      }
      for (const t of cashTxns) {
        const isIn = ['IN', 'TRANSFER_IN', 'REVERSAL_IN'].includes(t.type);
        entries.push({ date: t.date.toISOString().split('T')[0], account: t.cashAccount.name, type: t.type, inflow: isIn ? Number(t.amount) : 0, outflow: isIn ? 0 : Number(t.amount), description: t.description });
      }
      entries.sort((a, b) => a.date.localeCompare(b.date));

      const totalInflow = entries.reduce((s, e) => s + e.inflow, 0);
      const totalOutflow = entries.reduce((s, e) => s + e.outflow, 0);

      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="cash-flow.pdf"`);
      doc.pipe(res);

      const dateRange = `${startDate.toLocaleDateString('en-IN')} to ${endDate.toLocaleDateString('en-IN')}`;
      pdfHeader(doc, 'CASH FLOW REPORT', project?.name ?? '', dateRange);

      let y = 95;
      const margin = 50;
      const pageWidth = 595;
      const contentWidth = pageWidth - margin * 2;

      // Summary
      doc.roundedRect(margin, y, contentWidth, 45, 5).fillAndStroke(PDF_LIGHT_BG, PDF_BORDER);
      doc.fillColor(PDF_TEXT_DARK).fontSize(9).font('Helvetica-Bold');
      doc.text(`Total Inflow: ${fmtMoney(totalInflow)}`, margin + 10, y + 10);
      doc.fillColor(PDF_RED).text(`Total Outflow: ${fmtMoney(totalOutflow)}`, margin + 200, y + 10);
      doc.fillColor(totalInflow - totalOutflow >= 0 ? PDF_GREEN : PDF_RED);
      doc.text(`Net Flow: ${fmtMoney(totalInflow - totalOutflow)}`, margin + 10, y + 28);
      doc.fillColor(PDF_TEXT_MUTED).font('Helvetica').fontSize(8);
      doc.text(`Transactions: ${entries.length}`, margin + 200, y + 28);
      y += 60;

      // Table
      const cols = [
        { label: 'Date', w: 65 },
        { label: 'Account', w: 110 },
        { label: 'Type', w: 70 },
        { label: 'Inflow', w: 80, align: 'right' as const },
        { label: 'Outflow', w: 80, align: 'right' as const },
        { label: 'Description', w: 90 },
      ];

      doc.rect(margin, y, contentWidth, 18).fill(PDF_PRIMARY);
      let xh = margin;
      for (const c of cols) {
        doc.fillColor(PDF_WHITE).fontSize(7).font('Helvetica-Bold');
        if (c.align === 'right') { doc.text(c.label, xh, y + 5, { width: c.w, align: 'right' }); }
        else { doc.text(c.label, xh + 2, y + 5, { width: c.w - 4 }); }
        xh += c.w;
      }
      y += 18;

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (y > 780) { doc.addPage(); y = 50; }
        const bg = i % 2 === 0 ? PDF_WHITE : PDF_LIGHT_BG;
        doc.rect(margin, y, contentWidth, 18).fill(bg);
        doc.fillColor(PDF_TEXT_DARK).fontSize(7).font('Helvetica');
        let xr = margin;
        doc.text(e.date, xr + 2, y + 5, { width: cols[0].w - 4 });
        xr += cols[0].w;
        doc.text(e.account, xr + 2, y + 5, { width: cols[1].w - 4 });
        xr += cols[1].w;
        doc.fillColor(e.inflow > 0 ? PDF_GREEN : PDF_RED);
        doc.text(e.type.replace(/_/g, ' '), xr + 2, y + 5, { width: cols[2].w - 4 });
        xr += cols[2].w;
        doc.fillColor(PDF_GREEN).font('Helvetica-Bold');
        doc.text(e.inflow > 0 ? fmtMoney(e.inflow) : '—', xr, y + 5, { width: cols[3].w, align: 'right' });
        xr += cols[3].w;
        doc.fillColor(PDF_RED);
        doc.text(e.outflow > 0 ? fmtMoney(e.outflow) : '—', xr, y + 5, { width: cols[4].w, align: 'right' });
        xr += cols[4].w;
        doc.fillColor(PDF_TEXT_MUTED).font('Helvetica');
        doc.text(e.description ?? '—', xr + 2, y + 5, { width: cols[5].w - 4 });
        y += 18;
      }

      pdfFooter(doc);
      doc.end();
    } catch (error) {
      next(error);
    }
  },
);

// ── PDF: Account Summary ──
router.get(
  '/pdf/account-summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
      const [bankAccounts, cashAccounts] = await Promise.all([
        prisma.bankAccount.findMany({ where: { projectId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
        prisma.cashAccount.findMany({ where: { projectId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      ]);

      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="account-summary.pdf"`);
      doc.pipe(res);

      pdfHeader(doc, 'ACCOUNT SUMMARY REPORT', project?.name ?? '', 'Bank & Cash account balances');

      let y = 95;
      const margin = 50;
      const pageWidth = 595;
      const contentWidth = pageWidth - margin * 2;

      // Bank Accounts section
      doc.fillColor(PDF_PRIMARY).fontSize(11).font('Helvetica-Bold').text('Bank Accounts', margin, y);
      y += 18;
      const bankCols = [
        { label: 'Account Name', w: 180 },
        { label: 'Bank', w: 120 },
        { label: 'Account No', w: 100 },
        { label: 'Opening', w: 95, align: 'right' as const },
        { label: 'Current', w: 95, align: 'right' as const },
      ];
      // Adjust widths to fit contentWidth
      const bankTotalW = bankCols.reduce((s, c) => s + c.w, 0);
      const bankScale = contentWidth / bankTotalW;
      for (const c of bankCols) c.w = Math.floor(c.w * bankScale);

      doc.rect(margin, y, contentWidth, 18).fill(PDF_PRIMARY);
      let xh = margin;
      for (const c of bankCols) {
        doc.fillColor(PDF_WHITE).fontSize(7).font('Helvetica-Bold');
        if (c.align === 'right') { doc.text(c.label, xh, y + 5, { width: c.w, align: 'right' }); }
        else { doc.text(c.label, xh + 2, y + 5, { width: c.w - 4 }); }
        xh += c.w;
      }
      y += 18;

      let bankTotal = 0;
      for (let i = 0; i < bankAccounts.length; i++) {
        const a = bankAccounts[i];
        if (y > 780) { doc.addPage(); y = 50; }
        const bg = i % 2 === 0 ? PDF_WHITE : PDF_LIGHT_BG;
        doc.rect(margin, y, contentWidth, 18).fill(bg);
        doc.fillColor(PDF_TEXT_DARK).fontSize(7).font('Helvetica');
        let xr = margin;
        doc.text(a.accountName, xr + 2, y + 5, { width: bankCols[0].w - 4 });
        xr += bankCols[0].w;
        doc.text(a.bankName ?? '—', xr + 2, y + 5, { width: bankCols[1].w - 4 });
        xr += bankCols[1].w;
        doc.text(a.accountNumber ?? '—', xr + 2, y + 5, { width: bankCols[2].w - 4 });
        xr += bankCols[2].w;
        doc.text(fmtMoney(Number(a.openingBalance)), xr, y + 5, { width: bankCols[3].w, align: 'right' });
        xr += bankCols[3].w;
        doc.fillColor(PDF_GREEN).font('Helvetica-Bold');
        doc.text(fmtMoney(Number(a.currentBalance)), xr, y + 5, { width: bankCols[4].w, align: 'right' });
        bankTotal += Number(a.currentBalance);
        y += 18;
      }
      if (y > 780) { doc.addPage(); y = 50; }
      doc.rect(margin, y, contentWidth, 20).fill(PDF_PRIMARY_LIGHT);
      doc.fillColor(PDF_PRIMARY).fontSize(8).font('Helvetica-Bold');
      doc.text('Total Bank Balance', margin + 2, y + 6, { width: contentWidth - 100 });
      doc.fillColor(PDF_GREEN).text(fmtMoney(bankTotal), margin + contentWidth - 100, y + 6, { width: 95, align: 'right' });
      y += 30;

      // Cash Accounts section
      if (y > 750) { doc.addPage(); y = 50; }
      doc.fillColor(PDF_PRIMARY).fontSize(11).font('Helvetica-Bold').text('Cash Accounts', margin, y);
      y += 18;
      const cashCols = [
        { label: 'Account Name', w: 250 },
        { label: 'Opening', w: 120, align: 'right' as const },
        { label: 'Current', w: 125, align: 'right' as const },
      ];
      const cashTotalW = cashCols.reduce((s, c) => s + c.w, 0);
      const cashScale = contentWidth / cashTotalW;
      for (const c of cashCols) c.w = Math.floor(c.w * cashScale);

      doc.rect(margin, y, contentWidth, 18).fill(PDF_PRIMARY);
      xh = margin;
      for (const c of cashCols) {
        doc.fillColor(PDF_WHITE).fontSize(7).font('Helvetica-Bold');
        if (c.align === 'right') { doc.text(c.label, xh, y + 5, { width: c.w, align: 'right' }); }
        else { doc.text(c.label, xh + 2, y + 5, { width: c.w - 4 }); }
        xh += c.w;
      }
      y += 18;

      let cashTotal = 0;
      for (let i = 0; i < cashAccounts.length; i++) {
        const a = cashAccounts[i];
        if (y > 780) { doc.addPage(); y = 50; }
        const bg = i % 2 === 0 ? PDF_WHITE : PDF_LIGHT_BG;
        doc.rect(margin, y, contentWidth, 18).fill(bg);
        doc.fillColor(PDF_TEXT_DARK).fontSize(7).font('Helvetica');
        doc.text(a.name, margin + 2, y + 5, { width: cashCols[0].w - 4 });
        doc.text(fmtMoney(Number(a.openingBalance)), margin + cashCols[0].w, y + 5, { width: cashCols[1].w, align: 'right' });
        doc.fillColor(PDF_GREEN).font('Helvetica-Bold');
        doc.text(fmtMoney(Number(a.currentBalance)), margin + cashCols[0].w + cashCols[1].w, y + 5, { width: cashCols[2].w, align: 'right' });
        cashTotal += Number(a.currentBalance);
        y += 18;
      }
      if (y > 780) { doc.addPage(); y = 50; }
      doc.rect(margin, y, contentWidth, 20).fill(PDF_PRIMARY_LIGHT);
      doc.fillColor(PDF_PRIMARY).fontSize(8).font('Helvetica-Bold');
      doc.text('Total Cash Balance', margin + 2, y + 6, { width: contentWidth - 100 });
      doc.fillColor(PDF_GREEN).text(fmtMoney(cashTotal), margin + contentWidth - 100, y + 6, { width: 95, align: 'right' });
      y += 30;

      // Grand total
      if (y > 760) { doc.addPage(); y = 50; }
      doc.roundedRect(margin, y, contentWidth, 40, 5).fill(PDF_PRIMARY);
      doc.fillColor(PDF_WHITE).fontSize(10).font('Helvetica-Bold');
      doc.text('TOTAL LIQUIDITY (Bank + Cash)', margin + 10, y + 12);
      doc.fontSize(14).text(fmtMoney(bankTotal + cashTotal), margin + 10, y + 24);

      pdfFooter(doc);
      doc.end();
    } catch (error) {
      next(error);
    }
  },
);

// ── PDF: Owner Equity ──
router.get(
  '/pdf/owner-equity',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
      const ownerAccounts = await prisma.ownerAccount.findMany({
        where: { projectId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="owner-equity.pdf"`);
      doc.pipe(res);

      pdfHeader(doc, 'OWNER EQUITY REPORT', project?.name ?? '', 'Owner account balances and net equity');

      let y = 95;
      const margin = 50;
      const pageWidth = 595;
      const contentWidth = pageWidth - margin * 2;

      const cols = [
        { label: 'Owner Name', w: 200 },
        { label: 'Opening Balance', w: 120, align: 'right' as const },
        { label: 'Current Balance', w: 120, align: 'right' as const },
        { label: 'Status', w: 75 },
      ];
      const totalW = cols.reduce((s, c) => s + c.w, 0);
      const scale = contentWidth / totalW;
      for (const c of cols) c.w = Math.floor(c.w * scale);

      doc.rect(margin, y, contentWidth, 18).fill(PDF_PRIMARY);
      let xh = margin;
      for (const c of cols) {
        doc.fillColor(PDF_WHITE).fontSize(7).font('Helvetica-Bold');
        if (c.align === 'right') { doc.text(c.label, xh, y + 5, { width: c.w, align: 'right' }); }
        else { doc.text(c.label, xh + 2, y + 5, { width: c.w - 4 }); }
        xh += c.w;
      }
      y += 18;

      let totalOwedToOwner = 0, totalOwedByOwner = 0;
      for (let i = 0; i < ownerAccounts.length; i++) {
        const a = ownerAccounts[i];
        if (y > 780) { doc.addPage(); y = 50; }
        const balance = Number(a.currentBalance);
        if (balance > 0) totalOwedToOwner += balance;
        else totalOwedByOwner += Math.abs(balance);
        const bg = i % 2 === 0 ? PDF_WHITE : PDF_LIGHT_BG;
        doc.rect(margin, y, contentWidth, 20).fill(bg);
        doc.fillColor(PDF_TEXT_DARK).fontSize(8).font('Helvetica-Bold');
        doc.text(a.ownerName, margin + 2, y + 6, { width: cols[0].w - 4 });
        doc.fillColor(PDF_TEXT_DARK).font('Helvetica').fontSize(7);
        doc.text(fmtMoney(Number(a.openingBalance)), margin + cols[0].w, y + 6, { width: cols[1].w, align: 'right' });
        doc.fillColor(balance > 0 ? PDF_RED : balance < 0 ? PDF_ORANGE : PDF_TEXT_DARK).font('Helvetica-Bold');
        doc.text(fmtMoney(balance), margin + cols[0].w + cols[1].w, y + 6, { width: cols[2].w, align: 'right' });
        doc.fillColor(PDF_TEXT_MUTED).font('Helvetica').fontSize(7);
        const status = balance > 0 ? 'Co. owes owner' : balance < 0 ? 'Owner owes co.' : 'Settled';
        doc.text(status, margin + cols[0].w + cols[1].w + cols[2].w + 2, y + 6, { width: cols[3].w - 4 });
        y += 20;
      }

      // Summary
      y += 10;
      if (y > 740) { doc.addPage(); y = 50; }
      doc.roundedRect(margin, y, contentWidth, 70, 5).fillAndStroke(PDF_LIGHT_BG, PDF_BORDER);
      doc.fillColor(PDF_PRIMARY).fontSize(9).font('Helvetica-Bold').text('Summary', margin + 10, y + 8);
      doc.fillColor(PDF_TEXT_DARK).fontSize(8).font('Helvetica');
      doc.text(`Company Owes Owner: ${fmtMoney(totalOwedToOwner)}`, margin + 10, y + 26);
      doc.text(`Owner Owes Company: ${fmtMoney(totalOwedByOwner)}`, margin + 10, y + 40);
      doc.fillColor(PDF_PRIMARY).font('Helvetica-Bold').fontSize(9);
      doc.text(`Net Owner Equity: ${fmtMoney(totalOwedToOwner - totalOwedByOwner)}`, margin + 10, y + 54);

      pdfFooter(doc);
      doc.end();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
