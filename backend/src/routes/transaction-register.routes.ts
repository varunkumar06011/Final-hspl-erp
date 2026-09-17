import { Router, Response, NextFunction } from 'express';
import { Permission, UserRole, isAdminRole } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';

const router = Router();
router.use(authMiddleware);

// IST is the business timezone — month/year bucketing follows IST dates, not UTC.
const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthOf = (d: Date) => Number(monthFmt.format(d)) - 1; // 0-based

// One normalized activity event per document/transaction.
interface RegEvent {
  vendorId: string;
  date: Date;
  kind: 'vendor' | 'quotation' | 'po' | 'invoice' | 'request' | 'payment' | 'sheet' | 'settlement' | 'receipt';
  amount: number;       // financial weight (0 for non-money events like receipts)
  paid: number;         // portion that is money already out
  status: string;
  budgetHeadId?: string | null;
  budgetHead?: string | null;
}

interface VendorMonthAgg {
  vendorId: string;
  txnCount: number;
  quotationAmount: number;
  poAmount: number;
  invoiceAmount: number;
  paidAmount: number;
  payableAmount: number;
  counts: Record<string, number>;
  budgetHeads: Set<string>;
  lastActivity: Date;
}

const emptyAgg = (vendorId: string): VendorMonthAgg => ({
  vendorId, txnCount: 0, quotationAmount: 0, poAmount: 0, invoiceAmount: 0,
  paidAmount: 0, payableAmount: 0, counts: {}, budgetHeads: new Set(), lastActivity: new Date(0),
});

// GET / — month-wise vendor transaction register for a year
// Restricted to ACCOUNTANT and all admin roles (ADMIN, ADMIN_2, ADMIN_3...).
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const role = req.user!.role;
      if (role !== UserRole.ACCOUNTANT && !isAdminRole(role)) {
        res.status(403).json({ error: 'Transaction Register is restricted to Accountant and Admin roles' });
        return;
      }
      const projectId = requireProjectId(req);
      const {
        year: yearQ, month: monthQ, search, vendorId, budgetHeadId, type, status,
        vendorPage: vpQ, vendorPageSize: vpsQ,
      } = req.query as Record<string, string | undefined>;

      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: IST }));
      const year = Number(yearQ) || nowIST.getFullYear();
      const month = monthQ !== undefined && monthQ !== '' ? Number(monthQ) : null; // 1-12
      const vendorPage = Math.max(1, Number(vpQ) || 1);
      const vendorPageSize = Math.min(100, Math.max(1, Number(vpsQ) || 25));

      // IST calendar-year boundaries
      const yStart = new Date(`${year}-01-01T00:00:00+05:30`);
      const yEnd = new Date(`${year + 1}-01-01T00:00:00+05:30`);
      const inYear = { gte: yStart, lt: yEnd };

      // ── Search: resolve to a set of vendor ids (vendor name/code OR any doc number) ──
      let searchVendorIds: Set<string> | null = null;
      if (search && search.trim()) {
        const s = search.trim();
        const contains = { contains: s, mode: 'insensitive' as const };
        const [vendors, qs, pos, invs, prs, sheets] = await Promise.all([
          prisma.vendor.findMany({ where: { projectId, deletedAt: null, OR: [{ name: contains }, { vendorCode: contains }] }, select: { id: true } }),
          prisma.quotation.findMany({ where: { projectId, deletedAt: null, status: { not: 'DELETED' }, quotationNumber: contains }, select: { vendorId: true } }),
          prisma.purchaseOrder.findMany({ where: { projectId, deletedAt: null, status: { not: 'DELETED' }, poNumber: contains }, select: { vendorId: true } }),
          prisma.vendorInvoice.findMany({ where: { projectId, deletedAt: null, OR: [{ invoiceNumber: contains }, { invoiceCode: contains }] }, select: { vendorId: true } }),
          prisma.paymentRequest.findMany({ where: { projectId, deletedAt: null, status: { not: 'DELETED' }, OR: [{ requestNumber: contains }, { paymentCode: contains }] }, select: { vendorId: true } }),
          prisma.paymentSheet.findMany({ where: { projectId, deletedAt: null, status: { not: 'DELETED' }, purchaseOrder: { poNumber: contains, status: { not: 'DELETED' } } }, select: { purchaseOrder: { select: { vendorId: true } } } }),
        ]);
        searchVendorIds = new Set<string>([
          ...vendors.map((v) => v.id),
          ...qs.map((q) => q.vendorId),
          ...pos.map((p) => p.vendorId),
          ...invs.map((i) => i.vendorId),
          ...prs.map((p) => p.vendorId).filter((v): v is string => !!v),
          ...sheets.map((s2) => s2.purchaseOrder.vendorId),
        ]);
        if (searchVendorIds.size === 0) {
          res.json({ year, months: [], grandSummary: null });
          return;
        }
      }

      const vendorScope = (v: string | null | undefined) =>
        !v ? false : (vendorId ? v === vendorId : true) && (searchVendorIds ? searchVendorIds.has(v) : true);

      const wantType = type ? String(type) : null; // 'quotation'|'po'|'invoice'|'request'|'payment'|'sheet'|'settlement'|'receipt'|'vendor'
      const wantStatus = status ? String(status) : null;
      const keep = (e: RegEvent) =>
        (!wantType || e.kind === wantType) &&
        (!wantStatus || e.status === wantStatus) &&
        (!budgetHeadId || e.budgetHeadId === budgetHeadId);

      // ── Pull year-scoped rows from every vendor-linked module ──
      // Soft-deleted records (status DELETED) are excluded — same semantics as
      // every count/total elsewhere in the app (deleted POs stay visible but
      // don't count financially).
      const [vendorsCreated, quotations, pos, invoices, payReqs, payments, sheets, settlements, receipts] = await Promise.all([
        prisma.vendor.findMany({
          where: { projectId, deletedAt: null, createdAt: inYear },
          select: { id: true, createdAt: true, status: true },
        }),
        prisma.quotation.findMany({
          where: { projectId, deletedAt: null, status: { not: 'DELETED' }, date: inYear },
          select: { vendorId: true, date: true, grandTotal: true, status: true },
        }),
        prisma.purchaseOrder.findMany({
          where: { projectId, deletedAt: null, status: { not: 'DELETED' }, date: inYear },
          select: { vendorId: true, date: true, grandTotal: true, status: true, budgetHeadId: true, budgetHead: { select: { particulars: true } } },
        }),
        prisma.vendorInvoice.findMany({
          where: { projectId, deletedAt: null, date: inYear },
          select: { vendorId: true, date: true, totalAmount: true, paymentStatus: true, purchaseOrder: { select: { budgetHeadId: true, budgetHead: { select: { particulars: true } } } } },
        }),
        prisma.paymentRequest.findMany({
          where: { projectId, deletedAt: null, status: { not: 'DELETED' }, createdAt: inYear, vendorId: { not: null } },
          select: { vendorId: true, poId: true, createdAt: true, amount: true, status: true, type: true, budgetHeadId: true, budgetHead: { select: { particulars: true } }, payments: { select: { id: true } } },
        }),
        // Payments reach the vendor through the payment request (Payment has no projectId)
        prisma.payment.findMany({
          where: { date: inYear, paymentRequest: { projectId, vendorId: { not: null }, deletedAt: null, status: { not: 'DELETED' } } },
          select: { date: true, amount: true, status: true, budgetHeadId: true, budgetHead: { select: { particulars: true } }, paymentRequest: { select: { vendorId: true, poId: true } } },
        }),
        prisma.paymentSheet.findMany({
          where: { projectId, deletedAt: null, status: { not: 'DELETED' }, date: inYear, purchaseOrder: { status: { not: 'DELETED' } } },
          select: { date: true, amount: true, status: true, poId: true, purchaseOrder: { select: { vendorId: true, budgetHeadId: true, budgetHead: { select: { particulars: true } } } } },
        }),
        prisma.billSettlement.findMany({
          where: { projectId, createdAt: inYear },
          select: { vendorId: true, createdAt: true, amount: true },
        }),
        prisma.goodsReceipt.findMany({
          where: { projectId, deletedAt: null, createdAt: inYear, purchaseOrder: { status: { not: 'DELETED' } } },
          select: { status: true, createdAt: true, postedAt: true, purchaseOrder: { select: { vendorId: true } } },
        }),
      ]);

      // ── Normalize into events ──
      const events: RegEvent[] = [];
      for (const v of vendorsCreated) {
        if (!vendorScope(v.id)) continue;
        events.push({ vendorId: v.id, date: v.createdAt, kind: 'vendor', amount: 0, paid: 0, status: v.status });
      }
      for (const q of quotations) {
        if (!vendorScope(q.vendorId)) continue;
        events.push({ vendorId: q.vendorId, date: q.date, kind: 'quotation', amount: Number(q.grandTotal), paid: 0, status: q.status });
      }
      for (const p of pos) {
        if (!vendorScope(p.vendorId)) continue;
        events.push({ vendorId: p.vendorId, date: p.date, kind: 'po', amount: Number(p.grandTotal), paid: 0, status: p.status, budgetHeadId: p.budgetHeadId, budgetHead: p.budgetHead?.particulars });
      }
      for (const i of invoices) {
        if (!vendorScope(i.vendorId)) continue;
        events.push({ vendorId: i.vendorId, date: i.date, kind: 'invoice', amount: Number(i.totalAmount), paid: 0, status: i.paymentStatus, budgetHeadId: i.purchaseOrder?.budgetHeadId, budgetHead: i.purchaseOrder?.budgetHead?.particulars });
      }
      // ── Paid dedup coverage ──
      // The same disbursement is often recorded in BOTH instruments: a payment
      // request's Payment row AND a paid payment-sheet entry for the same PO +
      // amount. Counting both would double the money out. Build a multiset of
      // "PO|amount" keys owned by payments/requests; a paid sheet that matches
      // one is still an activity event but contributes ₹0 to paid totals.
      const coverage = new Map<string, number>();
      const cover = (poId: string | null | undefined, amount: number) => {
        if (!poId) return;
        const k = `${poId}|${amount}`;
        coverage.set(k, (coverage.get(k) ?? 0) + 1);
      };
      const consumeCoverage = (poId: string | null | undefined, amount: number) => {
        if (!poId) return false;
        const k = `${poId}|${amount}`;
        const n = coverage.get(k) ?? 0;
        if (n <= 0) return false;
        coverage.set(k, n - 1);
        return true;
      };
      for (const p of payments) {
        if (p.status === 'PAID') cover(p.paymentRequest.poId, Number(p.amount));
      }

      for (const pr of payReqs) {
        if (!pr.vendorId || !vendorScope(pr.vendorId)) continue;
        // A PAID request with no Payment rows still represents money out (e.g. advance marked paid)
        const paid = pr.status === 'PAID' && pr.payments.length === 0 ? Number(pr.amount) : 0;
        if (paid > 0) cover(pr.poId, paid);
        events.push({ vendorId: pr.vendorId, date: pr.createdAt, kind: 'request', amount: Number(pr.amount), paid, status: pr.status, budgetHeadId: pr.budgetHeadId, budgetHead: pr.budgetHead?.particulars });
      }
      for (const p of payments) {
        const vid = p.paymentRequest.vendorId;
        if (!vid || !vendorScope(vid)) continue;
        const isPaid = p.status === 'PAID';
        events.push({ vendorId: vid, date: p.date, kind: 'payment', amount: Number(p.amount), paid: isPaid ? Number(p.amount) : 0, status: p.status, budgetHeadId: p.budgetHeadId, budgetHead: p.budgetHead?.particulars });
      }
      for (const s of sheets) {
        const vid = s.purchaseOrder.vendorId;
        if (!vendorScope(vid)) continue;
        const isPaid = s.status !== 'PENDING';
        // Skip the paid contribution when a payment/request already covers this
        // exact PO+amount — it's the same money recorded in two instruments.
        const paid = isPaid && !consumeCoverage(s.poId, Number(s.amount)) ? Number(s.amount) : 0;
        events.push({ vendorId: vid, date: s.date, kind: 'sheet', amount: Number(s.amount), paid, status: s.status, budgetHeadId: s.purchaseOrder.budgetHeadId, budgetHead: s.purchaseOrder.budgetHead?.particulars });
      }
      for (const st of settlements) {
        if (!vendorScope(st.vendorId)) continue;
        events.push({ vendorId: st.vendorId, date: st.createdAt, kind: 'settlement', amount: Number(st.amount), paid: 0, status: 'SETTLED' });
      }
      for (const g of receipts) {
        const vid = g.purchaseOrder.vendorId;
        if (!vendorScope(vid)) continue;
        events.push({ vendorId: vid, date: g.postedAt ?? g.createdAt, kind: 'receipt', amount: 0, paid: 0, status: g.status });
      }

      const visible = events.filter(keep);

      // ── Bucket by month → vendor ──
      const months = Array.from({ length: 12 }, () => new Map<string, VendorMonthAgg>());
      for (const e of visible) {
        const m = monthOf(e.date);
        const bucket = months[m];
        const agg = bucket.get(e.vendorId) ?? emptyAgg(e.vendorId);
        agg.txnCount += 1;
        agg.counts[e.kind] = (agg.counts[e.kind] ?? 0) + 1;
        if (e.kind === 'quotation') agg.quotationAmount += e.amount;
        if (e.kind === 'po') agg.poAmount += e.amount;
        if (e.kind === 'invoice') agg.invoiceAmount += e.amount;
        agg.paidAmount += e.paid;
        if (e.kind === 'sheet' && e.status === 'PENDING') agg.payableAmount += e.amount;
        if (e.budgetHead) agg.budgetHeads.add(e.budgetHead);
        if (e.date > agg.lastActivity) agg.lastActivity = e.date;
        bucket.set(e.vendorId, agg);
      }

      // Vendor display data
      const allVendorIds = new Set<string>();
      for (const m of months) for (const id of m.keys()) allVendorIds.add(id);
      const vendorRows = await prisma.vendor.findMany({
        where: { id: { in: [...allVendorIds] } },
        select: { id: true, name: true, vendorCode: true, status: true },
      });
      const vendorInfo = new Map(vendorRows.map((v) => [v.id, v]));

      const monthParam = month !== null ? month - 1 : null;
      const outMonths = [];
      const grandVendors = new Map<string, VendorMonthAgg>();

      for (let m = 0; m < 12; m++) {
        if (monthParam !== null && m !== monthParam) continue;
        const bucket = months[m];
        if (bucket.size === 0) continue;

        const sorted = [...bucket.values()].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
        const vendorTotal = sorted.length;
        const pageRows = sorted.slice((vendorPage - 1) * vendorPageSize, vendorPage * vendorPageSize);

        const summary = { vendorCount: vendorTotal, quotationAmount: 0, poAmount: 0, invoiceAmount: 0, paidAmount: 0, payableAmount: 0, outstandingAmount: 0, expenditureAmount: 0, counts: { quotations: 0, pos: 0, invoices: 0, payments: 0, requests: 0, sheets: 0, receipts: 0, settlements: 0 } };
        for (const agg of sorted) {
          summary.quotationAmount += agg.quotationAmount;
          summary.poAmount += agg.poAmount;
          summary.invoiceAmount += agg.invoiceAmount;
          summary.paidAmount += agg.paidAmount;
          summary.payableAmount += agg.payableAmount;
          summary.outstandingAmount += Math.max(0, agg.invoiceAmount - agg.paidAmount);
          summary.counts.quotations += agg.counts.quotation ?? 0;
          summary.counts.pos += agg.counts.po ?? 0;
          summary.counts.invoices += agg.counts.invoice ?? 0;
          summary.counts.payments += agg.counts.payment ?? 0;
          summary.counts.requests += agg.counts.request ?? 0;
          summary.counts.sheets += agg.counts.sheet ?? 0;
          summary.counts.receipts += agg.counts.receipt ?? 0;
          summary.counts.settlements += agg.counts.settlement ?? 0;
          // merge into year-level view
          const g = grandVendors.get(agg.vendorId) ?? emptyAgg(agg.vendorId);
          g.txnCount += agg.txnCount; g.quotationAmount += agg.quotationAmount; g.poAmount += agg.poAmount;
          g.invoiceAmount += agg.invoiceAmount; g.paidAmount += agg.paidAmount; g.payableAmount += agg.payableAmount;
          for (const [k, c] of Object.entries(agg.counts)) g.counts[k] = (g.counts[k] ?? 0) + c;
          agg.budgetHeads.forEach((h) => g.budgetHeads.add(h));
          if (agg.lastActivity > g.lastActivity) g.lastActivity = agg.lastActivity;
          grandVendors.set(agg.vendorId, g);
        }
        summary.expenditureAmount = summary.paidAmount;

        outMonths.push({
          month: m + 1,
          name: MONTH_NAMES[m],
          year,
          summary,
          vendorTotal,
          vendorPage,
          vendorPageSize,
          vendors: pageRows.map((agg) => {
            const v = vendorInfo.get(agg.vendorId);
            const outstanding = Math.max(0, agg.invoiceAmount - agg.paidAmount);
            const derivedStatus =
              agg.invoiceAmount > 0
                ? outstanding <= 0 ? 'Paid' : agg.paidAmount > 0 ? 'Partially Paid' : 'Not Paid'
                : 'Active';
            return {
              vendorId: agg.vendorId,
              name: v?.name ?? 'Unknown',
              vendorCode: v?.vendorCode ?? null,
              vendorStatus: v?.status ?? null,
              txnCount: agg.txnCount,
              quotationAmount: agg.quotationAmount,
              poAmount: agg.poAmount,
              invoiceAmount: agg.invoiceAmount,
              paidAmount: agg.paidAmount,
              payableAmount: agg.payableAmount,
              outstandingAmount: outstanding,
              budgetHeads: [...agg.budgetHeads],
              status: derivedStatus,
              lastActivityDate: agg.lastActivity.toISOString(),
              counts: agg.counts,
            };
          }),
        });
      }

      // Year-level summary across selected scope
      const grandSummary = {
        vendorCount: grandVendors.size, quotationAmount: 0, poAmount: 0, invoiceAmount: 0, paidAmount: 0, payableAmount: 0, outstandingAmount: 0, expenditureAmount: 0,
        counts: { quotations: 0, pos: 0, invoices: 0, payments: 0, requests: 0, sheets: 0, receipts: 0, settlements: 0 },
      };
      for (const g of grandVendors.values()) {
        grandSummary.quotationAmount += g.quotationAmount;
        grandSummary.poAmount += g.poAmount;
        grandSummary.invoiceAmount += g.invoiceAmount;
        grandSummary.paidAmount += g.paidAmount;
        grandSummary.payableAmount += g.payableAmount;
        grandSummary.outstandingAmount += Math.max(0, g.invoiceAmount - g.paidAmount);
        grandSummary.counts.quotations += g.counts.quotation ?? 0;
        grandSummary.counts.pos += g.counts.po ?? 0;
        grandSummary.counts.invoices += g.counts.invoice ?? 0;
        grandSummary.counts.payments += g.counts.payment ?? 0;
        grandSummary.counts.requests += g.counts.request ?? 0;
        grandSummary.counts.sheets += g.counts.sheet ?? 0;
        grandSummary.counts.receipts += g.counts.receipt ?? 0;
        grandSummary.counts.settlements += g.counts.settlement ?? 0;
      }
      grandSummary.expenditureAmount = grandSummary.paidAmount;

      res.json({ year, month, months: outMonths, grandSummary });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
