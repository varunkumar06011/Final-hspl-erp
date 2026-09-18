import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  AuditAction,
  VoucherType,
  LedgerGroup,
  BankTxnType,
  CashTxnType,
  AccountTxnRefType,
  GST_LEDGER_NAMES,
  PaymentStatus,
} from '@hospital-erp/shared';
import { recalcInvoicePaymentStatus } from '../services/invoice-payment.service';
import {
  createVoucherSchema,
  listVouchersSchema,
  creditDebitNoteSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { ensureVendorLedger, findLedgerByName } from './ledger.routes';

const router = Router();
router.use(authMiddleware);

const voucherInclude = {
  entries: true,
  ledgerEntries: {
    include: {
      ledger: { select: { id: true, name: true, group: true } },
      budgetHead: { select: { id: true, particulars: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  billSettlements: {
    include: {
      invoice: { select: { id: true, invoiceNumber: true, invoiceCode: true, totalAmount: true } },
    },
  },
  // Non-empty when a payment request already claims this voucher — used by the
  // "Link Voucher" picker to hide vouchers that are already spoken for.
  payments: { select: { id: true } },
  createdByUser: { select: { id: true, name: true } },
  postedByUser: { select: { id: true, name: true } },
  updatedByUser: { select: { id: true, name: true } },
};

// ── Generate voucher number per type ──
const VOUCHER_PREFIXES: Record<string, string> = {
  [VoucherType.RECEIPT]: 'VGH-RCPT',
  [VoucherType.PAYMENT]: 'VGH-PAY',
  [VoucherType.CONTRA]: 'VGH-CONTRA',
  [VoucherType.JOURNAL]: 'VGH-JV',
  [VoucherType.PURCHASE]: 'VGH-PUR',
  [VoucherType.CREDIT_NOTE]: 'VGH-CN',
  [VoucherType.DEBIT_NOTE]: 'VGH-DN',
};

// Map voucher type to the correct account transaction ref type
const VOUCHER_TO_REF_TYPE: Record<string, AccountTxnRefType> = {
  [VoucherType.RECEIPT]: AccountTxnRefType.MANUAL_DEPOSIT,
  [VoucherType.PAYMENT]: AccountTxnRefType.MANUAL_WITHDRAWAL,
  [VoucherType.CONTRA]: AccountTxnRefType.TRANSFER,
  [VoucherType.JOURNAL]: AccountTxnRefType.JOURNAL_VOUCHER,
  [VoucherType.PURCHASE]: AccountTxnRefType.JOURNAL_VOUCHER,
  [VoucherType.CREDIT_NOTE]: AccountTxnRefType.JOURNAL_VOUCHER,
  [VoucherType.DEBIT_NOTE]: AccountTxnRefType.JOURNAL_VOUCHER,
};

export async function generateVoucherNumber(voucherType: string): Promise<string> {
  const prefix = VOUCHER_PREFIXES[voucherType] ?? 'VGH-JV';
  const vouchers = await prisma.journalVoucher.findMany({
    where: { jvNumber: { startsWith: prefix } },
    select: { jvNumber: true },
  });
  const maxNum = vouchers.reduce((max, v) => {
    const match = v.jvNumber?.match(new RegExp(`^${prefix}(\\d+)$`));
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

// Keep the visible number sequence contiguous when a voucher is moved to a
// requested position. The internal voucher IDs never change; only the
// human-readable number and its denormalized ledger snapshot are resequenced.
async function resequenceVoucherSeries(
  tx: Prisma.TransactionClient,
  projectId: string,
  voucherType: string,
  selectedVoucherId: string | null,
  requestedSequence?: number,
): Promise<string> {
  const prefix = VOUCHER_PREFIXES[voucherType] ?? 'VGH-JV';
  const vouchers = await tx.journalVoucher.findMany({
    where: { projectId, voucherType, deletedAt: null },
    select: { id: true, jvNumber: true, date: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  vouchers.sort((a, b) => {
    const aNumber = Number(a.jvNumber.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    const bNumber = Number(b.jvNumber.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
    return aNumber - bNumber || a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  });
  // Keep the existing date order for every other voucher, but move the edited
  // voucher to the requested position and shift the affected vouchers.
  let orderedVouchers = vouchers;
  if (selectedVoucherId) {
    const selectedIndex = vouchers.findIndex((voucher) => voucher.id === selectedVoucherId);
    if (selectedIndex < 0) throw new Error('Voucher not found in its number series');
    if (!Number.isInteger(requestedSequence) || requestedSequence! < 1 || requestedSequence! > vouchers.length) {
      throw new Error(`Voucher number must be between 1 and ${vouchers.length}`);
    }
    orderedVouchers = vouchers.filter((voucher) => voucher.id !== selectedVoucherId);
    orderedVouchers.splice(requestedSequence! - 1, 0, vouchers[selectedIndex]);
  }

  // Move every number out of the way first because jvNumber is globally unique.
  for (const voucher of orderedVouchers) {
    await tx.journalVoucher.update({
      where: { id: voucher.id },
      data: { jvNumber: `${prefix}TMP${voucher.id.replace(/-/g, '')}` },
    });
  }

  let selectedNumber = `${prefix}0001`;
  for (const [index, voucher] of orderedVouchers.entries()) {
    const jvNumber = `${prefix}${String(index + 1).padStart(4, '0')}`;
    await tx.journalVoucher.update({ where: { id: voucher.id }, data: { jvNumber } });
    await tx.ledgerEntry.updateMany({
      where: { journalVoucherId: voucher.id },
      data: { voucherNumber: jvNumber },
    });
    if (voucher.id === selectedVoucherId) selectedNumber = jvNumber;
  }
  return selectedNumber;
}

// ── List vouchers (with type filter, date range) ──
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listVouchersSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 20, search, voucherType, status, date, startDate, endDate, ids, minAmount, maxAmount } = req.query as Record<string, unknown>;

      const where: Prisma.JournalVoucherWhereInput = {
        projectId,
        deletedAt: null,
        // Only show new-style vouchers (those with ledger entries). Legacy JVs
        // (type=OWNER_EXPENSE etc.) are shown on the Journal Vouchers page.
        // We filter by having ledgerEntries — this includes JOURNAL vouchers
        // created from the voucher entry page but excludes legacy JVs.
        ledgerEntries: { some: {} },
        ...(voucherType ? { voucherType: String(voucherType) } : {}),
        ...(status ? { status: String(status) } : {}),
        ...(search ? { jvNumber: { contains: String(search), mode: 'insensitive' } } : {}),
        ...(date ? (() => {
          const dayStart = new Date(String(date));
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(String(date));
          dayEnd.setHours(23, 59, 59, 999);
          return { date: { gte: dayStart, lte: dayEnd } };
        })() : startDate || endDate ? {
          date: {
            ...(startDate ? { gte: new Date(String(startDate)) } : {}),
            ...(endDate ? { lte: new Date(String(endDate)) } : {}),
          },
        } : {}),
        // Filter by specific voucher IDs (used by bank/cash statements to fetch voucher numbers)
        ...(ids ? { id: { in: String(ids).split(',') } } : {}),
        // Amount range filter — totalDebit holds the voucher's total amount
        ...(minAmount || maxAmount ? {
          totalDebit: {
            ...(minAmount ? { gte: Number(minAmount) } : {}),
            ...(maxAmount ? { lte: Number(maxAmount) } : {}),
          },
        } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.journalVoucher.findMany({
          where,
          include: voucherInclude,
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.journalVoucher.count({ where }),
      ]);

      res.json({
        data,
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

// ── Get single voucher ──
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const voucher = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include: voucherInclude,
      });
      if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
      }
      res.json(voucher);
    } catch (error) {
      next(error);
    }
  },
);

// ── Create + post voucher in one step (no approval for new voucher types) ──
router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(createVoucherSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { voucherType, date, description, entries, sourceInvoiceId, billSettlements, paymentRequestId } = req.body;

      const totalDebit = (entries as Array<{ debit: number }>).reduce((s, e) => s + Number(e.debit), 0);
      const totalCredit = (entries as Array<{ credit: number }>).reduce((s, e) => s + Number(e.credit), 0);

      // Validate all ledgers exist and belong to project
      const ledgerIds = (entries as Array<{ ledgerId: string }>).map((e) => e.ledgerId);
      const ledgers = await prisma.ledger.findMany({
        where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true },
      });
      if (ledgers.length !== ledgerIds.length) {
        const found = new Set(ledgers.map((l) => l.id));
        const missing = ledgerIds.filter((id) => !found.has(id));
        res.status(400).json({ error: `One or more ledgers not found or inactive: ${missing.join(', ')}` });
        return;
      }
      const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));

      // ── Payment-request-linked voucher ("Post to Ledgers" from Payments page) ──
      // The voucher posts normally and, in the same transaction, the payment
      // request is claimed (APPROVED → PAID) and a Payment record is created
      // pointing at this voucher — identical semantics to POST /payments/:id/pay.
      let linkedPaymentRequest: {
        id: string; amount: number; type: string; invoiceId: string | null; budgetHeadId: string | null;
      } | null = null;
      let linkedBankAccountId: string | null = null;
      let linkedCashAccountId: string | null = null;
      if (paymentRequestId) {
        if (voucherType !== VoucherType.PAYMENT) {
          res.status(400).json({ error: 'paymentRequestId can only be used with PAYMENT vouchers' });
          return;
        }
        const pr = await prisma.paymentRequest.findFirst({
          where: { id: paymentRequestId, projectId, deletedAt: null },
          include: { payments: { select: { id: true } } },
        });
        if (!pr) {
          res.status(404).json({ error: 'Payment request not found' });
          return;
        }
        if (pr.status !== PaymentStatus.APPROVED) {
          res.status(400).json({ error: `Payment request must be APPROVED. Current status: ${pr.status}` });
          return;
        }
        if (pr.payments.length > 0) {
          res.status(409).json({ error: 'Payment has already been recorded for this request' });
          return;
        }
        if (Math.abs(totalDebit - Number(pr.amount)) > 0.01) {
          res.status(400).json({ error: `Voucher amount must equal the approved amount of ${Number(pr.amount)}` });
          return;
        }
        // The credit entry must be a bank/cash ledger linked to a real account —
        // otherwise no account balance actually moves (phantom payment).
        for (const e of entries as Array<{ ledgerId: string; credit: number }>) {
          if (Number(e.credit) <= 0) continue;
          const l = ledgerMap.get(e.ledgerId);
          if (l?.linkedEntityType === 'BANK_ACCOUNT' && l.linkedEntityId) linkedBankAccountId = l.linkedEntityId;
          if (l?.linkedEntityType === 'CASH_ACCOUNT' && l.linkedEntityId) linkedCashAccountId = l.linkedEntityId;
        }
        if (!linkedBankAccountId && !linkedCashAccountId) {
          res.status(400).json({ error: 'The credit entry must be a bank or cash ledger linked to an account' });
          return;
        }
        linkedPaymentRequest = {
          id: pr.id,
          amount: Number(pr.amount),
          type: pr.type,
          invoiceId: pr.invoiceId,
          budgetHeadId: pr.budgetHeadId,
        };
      }

      // Validate budget head IDs (cost centers) if any entry has them
      const budgetHeadIds = (entries as Array<{ budgetHeadId?: string }>)
        .map((e) => e.budgetHeadId)
        .filter((id): id is string => !!id);
      let budgetHeadMap = new Map<string, string>();
      if (budgetHeadIds.length > 0) {
        const uniqueIds = [...new Set(budgetHeadIds)];
        const budgetHeads = await prisma.budgetHead.findMany({
          where: { id: { in: uniqueIds }, projectId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true, particulars: true },
        });
        if (budgetHeads.length !== uniqueIds.length) {
          const found = new Set(budgetHeads.map((b) => b.id));
          const missing = uniqueIds.filter((id) => !found.has(id));
          res.status(400).json({ error: `One or more cost centers not found: ${missing.join(', ')}` });
          return;
        }
        budgetHeadMap = new Map(budgetHeads.map((b) => [b.id, b.particulars]));
      }

      // For PURCHASE vouchers with sourceInvoiceId, verify the invoice
      if (voucherType === VoucherType.PURCHASE && sourceInvoiceId) {
        const invoice = await prisma.vendorInvoice.findFirst({
          where: { id: sourceInvoiceId, projectId, deletedAt: null },
        });
        if (!invoice) {
          res.status(404).json({ error: 'Source invoice not found' });
          return;
        }
        // Check if already posted
        const existingPost = await prisma.journalVoucher.findFirst({
          where: { sourceInvoiceId, projectId, status: 'POSTED', deletedAt: null },
        });
        if (existingPost) {
          res.status(400).json({ error: `Invoice already posted to books as ${existingPost.jvNumber}` });
          return;
        }
      }

      // Validate bill settlements (if provided) — invoices must belong to the project + vendor
      let validatedSettlements: Array<{ invoiceId: string; vendorId: string; amount: number }> = [];
      if (billSettlements && billSettlements.length > 0) {
        const invoiceIds = (billSettlements as Array<{ invoiceId: string }>).map((s) => s.invoiceId);
        const invoices = await prisma.vendorInvoice.findMany({
          where: { id: { in: invoiceIds }, projectId, deletedAt: null },
          select: { id: true, vendorId: true, totalAmount: true },
        });
        if (invoices.length !== invoiceIds.length) {
          res.status(400).json({ error: 'One or more invoices in bill settlements not found' });
          return;
        }
        const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
        validatedSettlements = (billSettlements as Array<{ invoiceId: string; amount: number }>).map((s) => ({
          invoiceId: s.invoiceId,
          vendorId: invoiceMap.get(s.invoiceId)!.vendorId,
          amount: Number(s.amount),
        }));
      }

      const jvNumber = await generateVoucherNumber(String(voucherType));
      const voucherDate = date ? new Date(String(date)) : new Date();

      // Block future dates
      if (voucherDate > new Date()) {
        res.status(400).json({ error: 'Voucher date cannot be in the future' });
        return;
      }
      const chequeDateCreate = req.body.chequeDate ? new Date(String(req.body.chequeDate)) : null;
      if (chequeDateCreate && chequeDateCreate > new Date()) {
        res.status(400).json({ error: 'Cheque date cannot be in the future' });
        return;
      }

      // ── For PAYMENT vouchers, extract the Budget Head from the party (debit) entry ──
      // The Budget Head is the cost center selected for the expense/party side.
      // We pass it to postVoucher so the bank/cash transaction gets tagged,
      // and we update the Budget Head's actualAmount + paidAmount after posting.
      // ── For RECEIPT vouchers, extract from the party (credit) entry ──
      // A receipt tagged with a budget head adds money INTO that head
      // (allocatedAmount increases), so the available balance goes up.
      let paymentBudgetHeadId: string | null = null;
      let paymentAmount = 0;
      if (voucherType === VoucherType.PAYMENT) {
        const partyEntry = (entries as Array<{ debit: number; credit: number; budgetHeadId?: string }>)
          .find((e) => Number(e.debit) > 0);
        // For payment-request-linked vouchers, fall back to the request's budget head
        const effectiveBudgetHeadId = partyEntry?.budgetHeadId ?? linkedPaymentRequest?.budgetHeadId ?? null;
        if (effectiveBudgetHeadId) {
          paymentBudgetHeadId = effectiveBudgetHeadId;
          paymentAmount = partyEntry ? Number(partyEntry.debit) : 0;
          // ── Over-budget check ──
          // Only applies when this voucher books actual spend. For INVOICE/ADVANCE
          // payment requests the actual was already accrued at GRN/invoice time —
          // this voucher only moves paidAmount, so no check is needed.
          const countsActual = !linkedPaymentRequest || linkedPaymentRequest.type === 'EXPENSE';
          if (countsActual) {
            const bh = await prisma.budgetHead.findFirst({
              where: { id: paymentBudgetHeadId, projectId, deletedAt: null },
            });
            if (!bh) {
              res.status(400).json({ error: 'Selected Budget Head not found' });
              return;
            }
            const projectedActual = Number(bh.actualAmount) + paymentAmount;
            if (projectedActual > Number(bh.allocatedAmount) + 0.01) {
              res.status(400).json({
                error: `Payment of ₹${paymentAmount.toFixed(2)} would exceed the allocated budget for "${bh.particulars}" ` +
                  `(allocated: ₹${Number(bh.allocatedAmount).toFixed(2)}, current actual: ₹${Number(bh.actualAmount).toFixed(2)})`,
              });
              return;
            }
          }
        }
      } else if (voucherType === VoucherType.RECEIPT) {
        const partyEntry = (entries as Array<{ debit: number; credit: number; budgetHeadId?: string }>)
          .find((e) => Number(e.credit) > 0 && e.budgetHeadId);
        if (partyEntry?.budgetHeadId) {
          const bh = await prisma.budgetHead.findFirst({
            where: { id: partyEntry.budgetHeadId, projectId, deletedAt: null },
          });
          if (!bh) {
            res.status(400).json({ error: 'Selected Budget Head not found' });
            return;
          }
          paymentBudgetHeadId = partyEntry.budgetHeadId;
          paymentAmount = Number(partyEntry.credit);
        }
      }

      // Post the voucher atomically: create JV + ledger entries + update ledger
      // balances. When linked to a payment request, the PR claim and Payment
      // record ride along in the same transaction — all-or-nothing.
      const result = await prisma.$transaction(async (tx) => {
        const voucherResult = await postVoucher({
          projectId,
          jvNumber,
          voucherType: String(voucherType),
          voucherDate,
          description: description ?? null,
          totalDebit,
          totalCredit,
          entries: entries as Array<{ ledgerId: string; debit: number; credit: number; description?: string; budgetHeadId?: string }>,
          ledgerMap,
          budgetHeadMap,
          sourceInvoiceId: sourceInvoiceId ?? null,
          billSettlements: validatedSettlements,
          userId: req.user!.id,
          chequeNumber: req.body.chequeNumber ?? null,
          chequeDate: chequeDateCreate,
          budgetHeadId: paymentBudgetHeadId,
          tx,
        });

        if (linkedPaymentRequest) {
          // Atomically claim the request — only one poster can flip APPROVED → PAID
          const claimed = await tx.paymentRequest.updateMany({
            where: { id: linkedPaymentRequest.id, status: PaymentStatus.APPROVED },
            data: { status: PaymentStatus.PAID },
          });
          if (claimed.count !== 1) {
            throw new Error('Payment has already been recorded by another request');
          }

          await tx.payment.create({
            data: {
              paymentRequestId: linkedPaymentRequest.id,
              amount: linkedPaymentRequest.amount,
              mode: linkedBankAccountId ? 'BANK_TRANSFER' : 'CASH',
              reference: req.body.chequeNumber ?? null,
              bankAccountId: linkedBankAccountId,
              cashAccountId: linkedCashAccountId,
              budgetHeadId: paymentBudgetHeadId ?? linkedPaymentRequest.budgetHeadId ?? null,
              journalVoucherId: voucherResult.voucherId,
              postedAt: new Date(),
            },
          });

          if (linkedPaymentRequest.invoiceId) {
            await recalcInvoicePaymentStatus(linkedPaymentRequest.invoiceId, tx);
          }
        }

        return voucherResult;
      });

      // Budget Head totals are updated inside postVoucher's transaction
      // (atomic with the voucher posting — no separate update needed here).

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VOUCHER',
        entityId: result.voucherId,
        projectId,
        newValue: { jvNumber, voucherType, totalDebit, totalCredit, sourceInvoiceId },
      });

      res.status(201).json({
        message: 'Voucher posted successfully',
        jvNumber,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Cancel a posted voucher (creates reversal entries) ──
router.post(
  '/:id/cancel',
  rbacMiddleware(Permission.REVERSE_VOUCHER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const voucher = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { ledgerEntries: true },
      });
      if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
      }
      if (voucher.status !== 'POSTED') {
        res.status(400).json({ error: `Cannot cancel a ${voucher.status} voucher` });
        return;
      }

      // Reverse: swap debit/credit on each ledger entry, update balances,
      // create reversing LedgerEntry rows, and reverse bank/cash transactions.
      // For PAYMENT vouchers with a Budget Head, also reverse the budget deduction.
      // The budget head may be stored on the party ledger entry (VouchersPage flow)
      // or on the bank/cash transaction (cash-out / bank-withdrawal flows), so we
      // check both sources.
      let paymentBudgetHeadId: string | null = null;
      let paymentAmount = 0;
      let isReceiptVoucher = false;
      if (voucher.voucherType === VoucherType.PAYMENT) {
        // 1. Check the party (debit) ledger entry for a budgetHeadId
        const partyEntry = voucher.ledgerEntries.find((e) => Number(e.debit) > 0 && e.budgetHeadId);
        if (partyEntry) {
          paymentBudgetHeadId = partyEntry.budgetHeadId!;
          paymentAmount = Number(partyEntry.debit);
        } else {
          // 2. Check the bank/cash transaction linked to this voucher
          const bankTxn = await prisma.bankTransaction.findFirst({
            where: { referenceId: voucher.id, status: 'POSTED', budgetHeadId: { not: null } },
            select: { budgetHeadId: true, amount: true },
          });
          if (bankTxn?.budgetHeadId) {
            paymentBudgetHeadId = bankTxn.budgetHeadId;
            paymentAmount = Number(bankTxn.amount);
          } else {
            const cashTxn = await prisma.cashTransaction.findFirst({
              where: { referenceId: voucher.id, status: 'POSTED', budgetHeadId: { not: null } },
              select: { budgetHeadId: true, amount: true },
            });
            if (cashTxn?.budgetHeadId) {
              paymentBudgetHeadId = cashTxn.budgetHeadId;
              paymentAmount = Number(cashTxn.amount);
            }
          }
        }
      } else if (voucher.voucherType === VoucherType.RECEIPT) {
        // For receipts, the budget head is on the party (credit) entry.
        const partyEntry = voucher.ledgerEntries.find((e) => Number(e.credit) > 0 && e.budgetHeadId);
        if (partyEntry) {
          paymentBudgetHeadId = partyEntry.budgetHeadId!;
          paymentAmount = Number(partyEntry.credit);
          isReceiptVoucher = true;
        }
      }

      await prisma.$transaction(async (tx) => {
        // Atomically claim the voucher (prevent double-cancel)
        const claimed = await tx.journalVoucher.updateMany({
          where: { id: voucher.id, status: 'POSTED' },
          data: { status: 'CANCELLED', updatedBy: req.user!.id },
        });
        if (claimed.count !== 1) {
          throw new Error('Voucher is already being cancelled or is not POSTED');
        }

        for (const entry of voucher.ledgerEntries) {
          const ledger = await tx.ledger.findUnique({ where: { id: entry.ledgerId } });
          if (!ledger) continue;

          const debit = Number(entry.debit);
          const credit = Number(entry.credit);

          // Reverse the balance effect: debit becomes credit and vice versa
          const reverseDelta = credit - debit;
          await tx.ledger.update({
            where: { id: entry.ledgerId },
            data: { currentBalance: { increment: reverseDelta } },
          });

          // Create a reversing LedgerEntry row so reports that read from
          // LedgerEntry (trial balance, P&L, balance sheet) see the reversal.
          await tx.ledgerEntry.create({
            data: {
              ledgerId: entry.ledgerId,
              journalVoucherId: voucher.id,
              debit: credit, // swapped
              credit: debit, // swapped
              description: `REVERSAL: ${entry.description ?? voucher.jvNumber}`,
              budgetHeadId: entry.budgetHeadId,
              voucherType: voucher.voucherType ?? voucher.type,
              voucherNumber: voucher.jvNumber,
              voucherDate: voucher.date,
            },
          });

          // Reverse bank account balance + create reversal bank transaction
          if (ledger.linkedEntityType === 'BANK_ACCOUNT' && ledger.linkedEntityId) {
            const bankAccount = await tx.bankAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (bankAccount) {
              const wasDeposit = debit > 0; // original debit to bank = money in
              const reverseAmount = wasDeposit ? debit : credit;
              const updatedBank = await tx.bankAccount.update({
                where: { id: bankAccount.id },
                data: {
                  currentBalance: wasDeposit
                    ? { decrement: reverseAmount }
                    : { increment: reverseAmount },
                },
                select: { currentBalance: true },
              });
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: bankAccount.id,
                  type: wasDeposit ? BankTxnType.REVERSAL_OUT : BankTxnType.REVERSAL_IN,
                  amount: reverseAmount,
                  balanceAfter: Number(updatedBank.currentBalance),
                  date: new Date(),
                  description: `REVERSAL: ${voucher.jvNumber}`,
                  referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  createdBy: req.user!.id,
                },
              });
            }
          }

          // Reverse cash account balance + create reversal cash transaction
          if (ledger.linkedEntityType === 'CASH_ACCOUNT' && ledger.linkedEntityId) {
            const cashAccount = await tx.cashAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (cashAccount) {
              const wasIn = debit > 0; // original debit to cash = money in
              const reverseAmount = wasIn ? debit : credit;
              const updatedCash = await tx.cashAccount.update({
                where: { id: cashAccount.id },
                data: {
                  currentBalance: wasIn
                    ? { decrement: reverseAmount }
                    : { increment: reverseAmount },
                },
                select: { currentBalance: true },
              });
              await tx.cashTransaction.create({
                data: {
                  cashAccountId: cashAccount.id,
                  type: wasIn ? CashTxnType.REVERSAL_OUT : CashTxnType.REVERSAL_IN,
                  amount: reverseAmount,
                  balanceAfter: Number(updatedCash.currentBalance),
                  date: new Date(),
                  description: `REVERSAL: ${voucher.jvNumber}`,
                  referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  createdBy: req.user!.id,
                },
              });
            }
          }
        }

        // ── Reverse Budget Head totals for cancelled PAYMENT/RECEIPT vouchers ──
        // PAYMENT: actual/paid decrease and committed increases (the released
        //   commitment is restored).
        // RECEIPT: allocatedAmount decreases (the receipt augmentation is reversed).
        if (paymentBudgetHeadId && paymentAmount > 0) {
          if (isReceiptVoucher) {
            await tx.budgetHead.update({
              where: { id: paymentBudgetHeadId },
              data: {
                allocatedAmount: { decrement: paymentAmount },
              },
            });
          } else {
            await tx.budgetHead.update({
              where: { id: paymentBudgetHeadId },
              data: {
                actualAmount: { decrement: paymentAmount },
                paidAmount: { decrement: paymentAmount },
                committedAmount: { increment: paymentAmount },
              },
            });
          }
        }
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VOUCHER',
        entityId: voucher.id,
        projectId,
        newValue: { status: 'CANCELLED' },
      });

      res.json({ message: 'Voucher cancelled and reversed', jvNumber: voucher.jvNumber });
    } catch (error) {
      next(error);
    }
  },
);

// ── Delete a cancelled voucher and close the number-series gap ──
router.delete(
  '/:id',
  rbacMiddleware(Permission.REVERSE_VOUCHER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const voucher = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: { id: true, jvNumber: true, voucherType: true, status: true },
      });
      if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
      }
      if (voucher.status !== 'CANCELLED') {
        res.status(400).json({ error: 'Only cancelled vouchers can be deleted. Cancel and reverse the voucher first.' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.journalVoucher.update({
          where: { id: voucher.id },
          data: {
            // jvNumber is globally unique, so move the deleted record out of
            // the active series before resequencing the remaining vouchers.
            jvNumber: `DELETED-${voucher.id}`,
            deletedAt: new Date(),
            updatedBy: req.user!.id,
          },
        });
        await resequenceVoucherSeries(tx, projectId, voucher.voucherType, null);
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'VOUCHER',
        entityId: voucher.id,
        projectId,
        oldValue: { jvNumber: voucher.jvNumber, status: voucher.status },
        newValue: { deleted: true },
      });

      res.json({ message: 'Voucher deleted and number series resequenced' });
    } catch (error) {
      next(error);
    }
  },
);

// ── Edit a posted voucher (reverse old entries, apply new entries, same voucher number) ──
router.patch(
  '/:id',
  rbacMiddleware(Permission.REVERSE_VOUCHER),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const voucher = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { ledgerEntries: true, billSettlements: true },
      });
      if (!voucher) {
        res.status(404).json({ error: 'Voucher not found' });
        return;
      }
      if (voucher.status !== 'POSTED') {
        res.status(400).json({ error: `Cannot edit a ${voucher.status} voucher` });
        return;
      }
      // Block editing purchase vouchers linked to invoices — those must be cancelled and re-posted from the invoice
      if (voucher.voucherType === VoucherType.PURCHASE && voucher.sourceInvoiceId) {
        res.status(400).json({ error: 'Purchase vouchers linked to invoices cannot be edited directly. Cancel and re-post from the invoice.' });
        return;
      }

      const { date, description, entries, billSettlements, jvNumber: requestedJvNumber } = req.body;
      const expectedPrefix = VOUCHER_PREFIXES[voucher.voucherType] ?? 'VGH-JV';
      let requestedSequence = Number(String(voucher.jvNumber).match(/(\d+)$/)?.[1] ?? 0);
      if (requestedJvNumber !== undefined) {
        const requested = String(requestedJvNumber).trim();
        if (!new RegExp(`^${expectedPrefix}(\\d+)$`).test(requested) && !/^\\d+$/.test(requested)) {
          res.status(400).json({ error: `Voucher number must be a number or start with ${expectedPrefix}` });
          return;
        }
        requestedSequence = Number(requested.match(/(\d+)$/)?.[1] ?? 0);
      }
      let currentJvNumber = voucher.jvNumber;

      // Validate new entries
      const newEntries = entries as Array<{ ledgerId: string; debit: number; credit: number; description?: string; budgetHeadId?: string }>;
      if (!newEntries || newEntries.length < 2) {
        res.status(400).json({ error: 'At least 2 ledger entries are required' });
        return;
      }
      const totalDebit = newEntries.reduce((s, e) => s + Number(e.debit), 0);
      const totalCredit = newEntries.reduce((s, e) => s + Number(e.credit), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        res.status(400).json({ error: `Debit (${totalDebit}) does not equal Credit (${totalCredit})` });
        return;
      }

      // Validate all ledgers exist and belong to project
      const ledgerIds = newEntries.map((e) => e.ledgerId);
      const ledgers = await prisma.ledger.findMany({
        where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true },
      });
      if (ledgers.length !== ledgerIds.length) {
        const found = new Set(ledgers.map((l) => l.id));
        const missing = ledgerIds.filter((id) => !found.has(id));
        res.status(400).json({ error: `One or more ledgers not found or inactive: ${missing.join(', ')}` });
        return;
      }
      const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));

      // Validate budget heads
      const budgetHeadIds = newEntries.map((e) => e.budgetHeadId).filter((id): id is string => !!id);
      if (budgetHeadIds.length > 0) {
        const uniqueIds = [...new Set(budgetHeadIds)];
        const budgetHeads = await prisma.budgetHead.findMany({
          where: { id: { in: uniqueIds }, projectId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        if (budgetHeads.length !== uniqueIds.length) {
          const found = new Set(budgetHeads.map((b) => b.id));
          const missing = uniqueIds.filter((id) => !found.has(id));
          res.status(400).json({ error: `One or more cost centers not found: ${missing.join(', ')}` });
          return;
        }
      }

      // Validate bill settlements
      let validatedSettlements: Array<{ invoiceId: string; vendorId: string; amount: number }> = [];
      if (billSettlements && billSettlements.length > 0) {
        const invoiceIds = (billSettlements as Array<{ invoiceId: string }>).map((s) => s.invoiceId);
        const invoices = await prisma.vendorInvoice.findMany({
          where: { id: { in: invoiceIds }, projectId, deletedAt: null },
          select: { id: true, vendorId: true, totalAmount: true },
        });
        if (invoices.length !== invoiceIds.length) {
          res.status(400).json({ error: 'One or more invoices in bill settlements not found' });
          return;
        }
        const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
        validatedSettlements = (billSettlements as Array<{ invoiceId: string; amount: number }>).map((s) => ({
          invoiceId: s.invoiceId,
          vendorId: invoiceMap.get(s.invoiceId)!.vendorId,
          amount: Number(s.amount),
        }));
      }

      const voucherDate = date ? new Date(String(date)) : voucher.date;
      const chequeNumber = req.body.chequeNumber !== undefined ? (req.body.chequeNumber || null) : voucher.chequeNumber;
      const chequeDate = req.body.chequeDate !== undefined ? (req.body.chequeDate ? new Date(String(req.body.chequeDate)) : null) : voucher.chequeDate;

      // Block future dates
      if (voucherDate > new Date()) {
        res.status(400).json({ error: 'Voucher date cannot be in the future' });
        return;
      }
      if (chequeDate && chequeDate > new Date()) {
        res.status(400).json({ error: 'Cheque date cannot be in the future' });
        return;
      }

      // ── For PAYMENT/RECEIPT vouchers, extract old and new Budget Head info ──
      // The old budget head is reversed (decremented), the new one is applied (incremented).
      // Over-budget check is done on the new budget head (PAYMENT only).
      // The old budget head may be on the party ledger entry (VouchersPage flow)
      // or on the bank/cash transaction (cash-out / bank-withdrawal flows).
      const isReceiptEdit = voucher.voucherType === VoucherType.RECEIPT;
      let oldBudgetHeadId: string | null = null;
      let oldBudgetAmount = 0;
      if (voucher.voucherType === VoucherType.PAYMENT) {
        const oldPartyEntry = voucher.ledgerEntries.find((e) => Number(e.debit) > 0 && e.budgetHeadId);
        if (oldPartyEntry) {
          oldBudgetHeadId = oldPartyEntry.budgetHeadId!;
          oldBudgetAmount = Number(oldPartyEntry.debit);
        } else {
          const bankTxn = await prisma.bankTransaction.findFirst({
            where: { referenceId: voucher.id, status: 'POSTED', budgetHeadId: { not: null } },
            select: { budgetHeadId: true, amount: true },
          });
          if (bankTxn?.budgetHeadId) {
            oldBudgetHeadId = bankTxn.budgetHeadId;
            oldBudgetAmount = Number(bankTxn.amount);
          } else {
            const cashTxn = await prisma.cashTransaction.findFirst({
              where: { referenceId: voucher.id, status: 'POSTED', budgetHeadId: { not: null } },
              select: { budgetHeadId: true, amount: true },
            });
            if (cashTxn?.budgetHeadId) {
              oldBudgetHeadId = cashTxn.budgetHeadId;
              oldBudgetAmount = Number(cashTxn.amount);
            }
          }
        }
      } else if (isReceiptEdit) {
        const oldPartyEntry = voucher.ledgerEntries.find((e) => Number(e.credit) > 0 && e.budgetHeadId);
        if (oldPartyEntry) {
          oldBudgetHeadId = oldPartyEntry.budgetHeadId!;
          oldBudgetAmount = Number(oldPartyEntry.credit);
        }
      }

      let newBudgetHeadId: string | null = null;
      let newBudgetAmount = 0;
      if (voucher.voucherType === VoucherType.PAYMENT) {
        const newPartyEntry = newEntries.find((e) => Number(e.debit) > 0);
        if (newPartyEntry?.budgetHeadId) {
          newBudgetHeadId = newPartyEntry.budgetHeadId;
          newBudgetAmount = Number(newPartyEntry.debit);
          // Over-budget check (account for the reversal of the old budget head)
          const bh = await prisma.budgetHead.findFirst({
            where: { id: newBudgetHeadId, projectId, deletedAt: null },
          });
          if (!bh) {
            res.status(400).json({ error: 'Selected Budget Head not found' });
            return;
          }
          const currentActual = Number(bh.actualAmount);
          // If reversing the old budget head on the same head, add it back first
          const adjustedActual = oldBudgetHeadId === newBudgetHeadId
            ? currentActual - oldBudgetAmount
            : currentActual;
          const projectedActual = adjustedActual + newBudgetAmount;
          if (projectedActual > Number(bh.allocatedAmount) + 0.01) {
            res.status(400).json({
              error: `Payment of ₹${newBudgetAmount.toFixed(2)} would exceed the allocated budget for "${bh.particulars}" ` +
                `(allocated: ₹${Number(bh.allocatedAmount).toFixed(2)}, current actual: ₹${currentActual.toFixed(2)})`,
            });
            return;
          }
        }
      } else if (isReceiptEdit) {
        const newPartyEntry = newEntries.find((e) => Number(e.credit) > 0 && e.budgetHeadId);
        if (newPartyEntry?.budgetHeadId) {
          const bh = await prisma.budgetHead.findFirst({
            where: { id: newPartyEntry.budgetHeadId, projectId, deletedAt: null },
          });
          if (!bh) {
            res.status(400).json({ error: 'Selected Budget Head not found' });
            return;
          }
          newBudgetHeadId = newPartyEntry.budgetHeadId;
          newBudgetAmount = Number(newPartyEntry.credit);
        }
      }

      // ── Budget-head-only shortcut ──
      // When the financial entries (ledgerId + debit + credit) are unchanged
      // and only the budget head / description / cheque info changed, we update
      // the budget head in place on the existing ledger entries and bank/cash
      // transactions instead of reversing and re-creating them. This prevents
      // duplicate expenditure rows in the dashboard popup and avoids extra
      // reversal transactions that would inflate the transaction list.
      const oldEntriesKey = [...voucher.ledgerEntries]
        .map((e) => `${e.ledgerId}:${Number(e.debit)}:${Number(e.credit)}`)
        .sort()
        .join('|');
      const newEntriesKey = newEntries
        .map((e) => `${e.ledgerId}:${Number(e.debit)}:${Number(e.credit)}`)
        .sort()
        .join('|');
      const entriesUnchanged = oldEntriesKey === newEntriesKey;

      if (entriesUnchanged) {
        await prisma.$transaction(async (tx) => {
          // 1. Update voucher header (date, description, cheque info)
          await tx.journalVoucher.update({
            where: { id: voucher.id },
            data: {
              date: voucherDate,
              description: description ?? null,
              chequeNumber,
              chequeDate,
              updatedBy: req.user!.id,
            },
          });

          // 2. Sync the new voucher date to the denormalized date fields that reports
          //    filter/sort on. The shortcut path keeps the existing ledger entries
          //    and bank/cash transactions in place, so their copied date snapshots
          //    (LedgerEntry.voucherDate, BankTransaction.date, CashTransaction.date)
          //    must be updated alongside JournalVoucher.date — otherwise accounting
          //    reports, ledger statements, and bank/cash statements keep showing
          //    the old date. Only original postings are updated; reversal txns
          //    (REVERSAL_IN/OUT) record the moment of edit/cancel and stay as-is.
          await tx.ledgerEntry.updateMany({
            where: { journalVoucherId: voucher.id },
            data: { voucherDate },
          });
          await tx.bankTransaction.updateMany({
            where: {
              referenceId: voucher.id,
              status: 'POSTED',
              type: { notIn: [BankTxnType.REVERSAL_IN, BankTxnType.REVERSAL_OUT] },
            },
            data: { date: voucherDate },
          });
          await tx.cashTransaction.updateMany({
            where: {
              referenceId: voucher.id,
              status: 'POSTED',
              type: { notIn: [CashTxnType.REVERSAL_IN, CashTxnType.REVERSAL_OUT] },
            },
            data: { date: voucherDate },
          });

          // 3. Update budget head on existing ledger entries (match by ledgerId+debit+credit)
          for (const newEntry of newEntries) {
            const matchingOld = voucher.ledgerEntries.find(
              (e) =>
                e.ledgerId === newEntry.ledgerId &&
                Math.abs(Number(e.debit) - Number(newEntry.debit)) < 0.01 &&
                Math.abs(Number(e.credit) - Number(newEntry.credit)) < 0.01,
            );
            if (matchingOld) {
              await tx.ledgerEntry.update({
                where: { id: matchingOld.id },
                data: {
                  budgetHeadId: newEntry.budgetHeadId ?? null,
                  description: newEntry.description ?? description ?? matchingOld.description,
                },
              });
            }
          }

          // 4. Update budget head on existing bank/cash transactions linked to this voucher
          //    Only update the ORIGINAL outflow transactions (WITHDRAWAL/PAYMENT/OUT),
          //    not reversal transactions created by prior edits.
          await tx.bankTransaction.updateMany({
            where: {
              referenceId: voucher.id,
              status: 'POSTED',
              type: BankTxnType.WITHDRAWAL,
            },
            data: { budgetHeadId: newBudgetHeadId },
          });
          await tx.cashTransaction.updateMany({
            where: {
              referenceId: voucher.id,
              status: 'POSTED',
              type: CashTxnType.OUT,
            },
            data: { budgetHeadId: newBudgetHeadId },
          });

          // 5. Reverse old Budget Head totals and apply new Budget Head totals
          // PAYMENT: reversal restores committed; new application mirrors postVoucher
          //   (actual+paid increase, committed decreases capped at 0).
          // RECEIPT: reversal decreases allocated; new application increases allocated.
          if (oldBudgetHeadId && oldBudgetAmount > 0) {
            if (isReceiptEdit) {
              await tx.budgetHead.update({
                where: { id: oldBudgetHeadId },
                data: { allocatedAmount: { decrement: oldBudgetAmount } },
              });
            } else {
              await tx.budgetHead.update({
                where: { id: oldBudgetHeadId },
                data: {
                  actualAmount: { decrement: oldBudgetAmount },
                  paidAmount: { decrement: oldBudgetAmount },
                  committedAmount: { increment: oldBudgetAmount },
                },
              });
            }
          }
          if (newBudgetHeadId && newBudgetAmount > 0) {
            if (isReceiptEdit) {
              await tx.budgetHead.update({
                where: { id: newBudgetHeadId },
                data: { allocatedAmount: { increment: newBudgetAmount } },
              });
            } else {
              const head = await tx.budgetHead.findUnique({
                where: { id: newBudgetHeadId },
                select: { committedAmount: true },
              });
              const committedRelease = Math.min(newBudgetAmount, Number(head?.committedAmount ?? 0));
              await tx.budgetHead.update({
                where: { id: newBudgetHeadId },
                data: {
                  actualAmount: { increment: newBudgetAmount },
                  paidAmount: { increment: newBudgetAmount },
                  committedAmount: { decrement: committedRelease },
                },
              });
            }
          }

          // 6. Update bill settlements if changed
          if (validatedSettlements.length > 0 || voucher.billSettlements.length > 0) {
            await tx.billSettlement.deleteMany({ where: { journalVoucherId: voucher.id } });
            for (const settlement of validatedSettlements) {
              await tx.billSettlement.create({
                data: {
                  projectId,
                  journalVoucherId: voucher.id,
                  invoiceId: settlement.invoiceId,
                  vendorId: settlement.vendorId,
                  amount: settlement.amount,
                },
              });
            }
          }

          currentJvNumber = await resequenceVoucherSeries(tx, projectId, voucher.voucherType, voucher.id, requestedSequence);
        });

        await logAudit({
          userId: req.user!.id,
          action: AuditAction.UPDATE,
          entityType: 'VOUCHER',
          entityId: voucher.id,
          projectId,
          oldValue: { date: voucher.date, description: voucher.description, budgetHeadOnly: true },
          newValue: { date: voucherDate, description, budgetHeadOnly: true, newBudgetHeadId },
        });

        res.json({ message: 'Voucher updated successfully', jvNumber: currentJvNumber });
        return;
      }

      // Execute the edit atomically: reverse old, apply new
      await prisma.$transaction(async (tx) => {
        // 1. Reverse old ledger entry effects
        for (const entry of voucher.ledgerEntries) {
          const ledger = await tx.ledger.findUnique({ where: { id: entry.ledgerId } });
          if (!ledger) continue;

          const debit = Number(entry.debit);
          const credit = Number(entry.credit);
          const reverseDelta = credit - debit;
          await tx.ledger.update({
            where: { id: entry.ledgerId },
            data: { currentBalance: { increment: reverseDelta } },
          });

          // Reverse bank balance
          if (ledger.linkedEntityType === 'BANK_ACCOUNT' && ledger.linkedEntityId) {
            const bankAccount = await tx.bankAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (bankAccount) {
              const wasDeposit = debit > 0;
              const reverseAmount = wasDeposit ? debit : credit;
              const updatedBank = await tx.bankAccount.update({
                where: { id: bankAccount.id },
                data: { currentBalance: wasDeposit ? { decrement: reverseAmount } : { increment: reverseAmount } },
                select: { currentBalance: true },
              });
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: bankAccount.id,
                  type: wasDeposit ? BankTxnType.REVERSAL_OUT : BankTxnType.REVERSAL_IN,
                  amount: reverseAmount,
                  balanceAfter: Number(updatedBank.currentBalance),
                  date: new Date(),
                  description: `EDIT REVERSAL: ${voucher.jvNumber}`,
                  referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  createdBy: req.user!.id,
                },
              });
            }
          }

          // Reverse cash balance
          if (ledger.linkedEntityType === 'CASH_ACCOUNT' && ledger.linkedEntityId) {
            const cashAccount = await tx.cashAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (cashAccount) {
              const wasIn = debit > 0;
              const reverseAmount = wasIn ? debit : credit;
              const updatedCash = await tx.cashAccount.update({
                where: { id: cashAccount.id },
                data: { currentBalance: wasIn ? { decrement: reverseAmount } : { increment: reverseAmount } },
                select: { currentBalance: true },
              });
              await tx.cashTransaction.create({
                data: {
                  cashAccountId: cashAccount.id,
                  type: wasIn ? CashTxnType.REVERSAL_OUT : CashTxnType.REVERSAL_IN,
                  amount: reverseAmount,
                  balanceAfter: Number(updatedCash.currentBalance),
                  date: new Date(),
                  description: `EDIT REVERSAL: ${voucher.jvNumber}`,
                  referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  createdBy: req.user!.id,
                },
              });
            }
          }
        }

        // 2. Delete old ledger entries and bill settlements
        await tx.ledgerEntry.deleteMany({ where: { journalVoucherId: voucher.id } });
        await tx.billSettlement.deleteMany({ where: { journalVoucherId: voucher.id } });

        // ── Reverse old Budget Head totals (PAYMENT/RECEIPT vouchers) ──
        // PAYMENT: restores committed that postVoucher had released.
        // RECEIPT: decreases allocated (undoes the receipt augmentation).
        if (oldBudgetHeadId && oldBudgetAmount > 0) {
          if (isReceiptEdit) {
            await tx.budgetHead.update({
              where: { id: oldBudgetHeadId },
              data: { allocatedAmount: { decrement: oldBudgetAmount } },
            });
          } else {
            await tx.budgetHead.update({
              where: { id: oldBudgetHeadId },
              data: {
                actualAmount: { decrement: oldBudgetAmount },
                paidAmount: { decrement: oldBudgetAmount },
                committedAmount: { increment: oldBudgetAmount },
              },
            });
          }
        }

        // 3. Update voucher header
        await tx.journalVoucher.update({
          where: { id: voucher.id },
          data: {
            date: voucherDate,
            description: description ?? null,
            totalDebit,
            totalCredit,
            chequeNumber,
            chequeDate,
            updatedBy: req.user!.id,
          },
        });

        // 4. Create new ledger entries + apply balance effects
        for (const entry of newEntries) {
          const ledger = ledgerMap.get(entry.ledgerId);
          if (!ledger) throw new Error(`Ledger ${entry.ledgerId} not found`);

          const debit = Number(entry.debit);
          const credit = Number(entry.credit);
          const balanceDelta = debit - credit;
          await tx.ledger.update({
            where: { id: entry.ledgerId },
            data: { currentBalance: { increment: balanceDelta } },
          });

          await tx.ledgerEntry.create({
            data: {
              ledgerId: entry.ledgerId,
              journalVoucherId: voucher.id,
              debit,
              credit,
              description: entry.description ?? description ?? voucher.jvNumber,
              budgetHeadId: entry.budgetHeadId ?? null,
              voucherType: voucher.voucherType ?? voucher.type,
              voucherNumber: voucher.jvNumber,
              voucherDate,
            },
          });

          // Post bank/cash transactions for new entries
          if (ledger.linkedEntityType === 'BANK_ACCOUNT' && ledger.linkedEntityId) {
            const isDeposit = debit > 0;
            const amount = isDeposit ? debit : credit;
            const bankAccount = await tx.bankAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (bankAccount) {
              if (!isDeposit && Number(bankAccount.currentBalance) < amount) {
                throw new Error(`Insufficient balance in bank account ${bankAccount.accountName}`);
              }
              const updatedBank = await tx.bankAccount.update({
                where: { id: bankAccount.id },
                data: { currentBalance: isDeposit ? { increment: amount } : { decrement: amount } },
                select: { currentBalance: true },
              });
              await tx.bankTransaction.create({
                data: {
                  bankAccountId: bankAccount.id,
                  type: isDeposit ? BankTxnType.DEPOSIT : BankTxnType.WITHDRAWAL,
                  amount,
                  balanceAfter: Number(updatedBank.currentBalance),
                  date: voucherDate,
                  description: entry.description ?? description ?? `${voucher.voucherType} ${voucher.jvNumber}`,
                  referenceType: VOUCHER_TO_REF_TYPE[voucher.voucherType ?? ''] ?? AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  budgetHeadId: newBudgetHeadId,
                  createdBy: req.user!.id,
                },
              });
            }
          } else if (ledger.linkedEntityType === 'CASH_ACCOUNT' && ledger.linkedEntityId) {
            const isIn = debit > 0;
            const amount = isIn ? debit : credit;
            const cashAccount = await tx.cashAccount.findUnique({ where: { id: ledger.linkedEntityId } });
            if (cashAccount) {
              if (!isIn && Number(cashAccount.currentBalance) < amount) {
                throw new Error(`Insufficient balance in cash account ${cashAccount.name}`);
              }
              const updatedCash = await tx.cashAccount.update({
                where: { id: cashAccount.id },
                data: { currentBalance: isIn ? { increment: amount } : { decrement: amount } },
                select: { currentBalance: true },
              });
              await tx.cashTransaction.create({
                data: {
                  cashAccountId: cashAccount.id,
                  type: isIn ? CashTxnType.IN : CashTxnType.OUT,
                  amount,
                  balanceAfter: Number(updatedCash.currentBalance),
                  date: voucherDate,
                  description: entry.description ?? description ?? `${voucher.voucherType} ${voucher.jvNumber}`,
                  referenceType: VOUCHER_TO_REF_TYPE[voucher.voucherType ?? ''] ?? AccountTxnRefType.JOURNAL_VOUCHER,
                  referenceId: voucher.id,
                  status: 'POSTED',
                  budgetHeadId: newBudgetHeadId,
                  createdBy: req.user!.id,
                },
              });
            }
          }
        }

        // 5. Create new bill settlements
        for (const settlement of validatedSettlements) {
          await tx.billSettlement.create({
            data: {
              projectId,
              journalVoucherId: voucher.id,
              invoiceId: settlement.invoiceId,
              vendorId: settlement.vendorId,
              amount: settlement.amount,
            },
          });
        }

        // ── Apply new Budget Head totals (PAYMENT/RECEIPT vouchers) ──
        // PAYMENT: mirrors postVoucher (actual+paid increase, committed decreases capped at 0).
        // RECEIPT: increases allocated (budget augmentation).
        if (newBudgetHeadId && newBudgetAmount > 0) {
          if (isReceiptEdit) {
            await tx.budgetHead.update({
              where: { id: newBudgetHeadId },
              data: { allocatedAmount: { increment: newBudgetAmount } },
            });
          } else {
            const head = await tx.budgetHead.findUnique({
              where: { id: newBudgetHeadId },
              select: { committedAmount: true },
            });
            const committedRelease = Math.min(newBudgetAmount, Number(head?.committedAmount ?? 0));
            await tx.budgetHead.update({
              where: { id: newBudgetHeadId },
              data: {
                actualAmount: { increment: newBudgetAmount },
                paidAmount: { increment: newBudgetAmount },
                committedAmount: { decrement: committedRelease },
              },
            });
          }
        }

        currentJvNumber = await resequenceVoucherSeries(tx, projectId, voucher.voucherType, voucher.id, requestedSequence);
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VOUCHER',
        entityId: voucher.id,
        projectId,
        oldValue: { date: voucher.date, description: voucher.description, totalDebit: voucher.totalDebit, totalCredit: voucher.totalCredit },
        newValue: { date: voucherDate, description, totalDebit, totalCredit, edited: true },
      });

      res.json({ message: 'Voucher updated successfully', jvNumber: currentJvNumber });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Voucher Posting Engine — core double-entry logic
// ═══════════════════════════════════════════════════════════

export interface PostVoucherArgs {
  projectId: string;
  jvNumber: string;
  voucherType: string;
  voucherDate: Date;
  description: string | null;
  totalDebit: number;
  totalCredit: number;
  entries: Array<{ ledgerId: string; debit: number; credit: number; description?: string; budgetHeadId?: string }>;
  ledgerMap: Map<string, { id: string; name: string; group: string; linkedEntityType: string | null; linkedEntityId: string | null }>;
  budgetHeadMap: Map<string, string>;
  sourceInvoiceId: string | null;
  billSettlements: Array<{ invoiceId: string; vendorId: string; amount: number }>;
  userId: string;
  chequeNumber?: string | null;
  chequeDate?: Date | null;
  tx?: Prisma.TransactionClient; // optional: run inside an existing transaction
  // Optional: when set, the bank/cash transaction created by this voucher will be
  // tagged with this budget head, and the budget head's actualAmount/paidAmount
  // will increase (and committedAmount will decrease, capped at 0).
  budgetHeadId?: string | null;
}

export async function postVoucher(args: PostVoucherArgs) {
  const run = async (tx: Prisma.TransactionClient) => {
    // 1. Create the JournalVoucher record (status = POSTED directly)
    const jv = await tx.journalVoucher.create({
      data: {
        projectId: args.projectId,
        jvNumber: args.jvNumber,
        date: args.voucherDate,
        description: args.description,
        type: 'ADJUSTMENT', // Legacy type field — new vouchers use voucherType
        voucherType: args.voucherType,
        sourceInvoiceId: args.sourceInvoiceId,
        chequeNumber: args.chequeNumber ?? null,
        chequeDate: args.chequeDate ?? null,
        status: 'POSTED',
        totalDebit: args.totalDebit,
        totalCredit: args.totalCredit,
        postedAt: new Date(),
        postedBy: args.userId,
        createdBy: args.userId,
      },
    });

    // 2. Create ledger entries + update balances
    const ledgerEntryResults: string[] = [];
    const bankTxnPromises: Promise<unknown>[] = [];

    for (const entry of args.entries) {
      const ledger = args.ledgerMap.get(entry.ledgerId);
      if (!ledger) throw new Error(`Ledger ${entry.ledgerId} not found`);

      const debit = Number(entry.debit);
      const credit = Number(entry.credit);

      // Update ledger balance: debit increases debit-nature, decreases credit-nature
      // We store: debit-nature positive = debit balance; credit-nature negative = credit balance
      // So: debit entry → balance += debit; credit entry → balance -= credit
      const balanceDelta = debit - credit;
      const updated = await tx.ledger.update({
        where: { id: entry.ledgerId },
        data: { currentBalance: { increment: balanceDelta } },
        select: { currentBalance: true },
      });

      // Create the ledger entry record (with optional cost center allocation)
      await tx.ledgerEntry.create({
        data: {
          ledgerId: entry.ledgerId,
          journalVoucherId: jv.id,
          debit,
          credit,
          description: entry.description ?? args.description ?? args.jvNumber,
          budgetHeadId: entry.budgetHeadId ?? null,
          voucherType: args.voucherType,
          voucherNumber: args.jvNumber,
          voucherDate: args.voucherDate,
        },
      });

      ledgerEntryResults.push(`${ledger.name}:${debit > 0 ? 'Dr' : 'Cr'}:${debit > 0 ? debit : credit}:bal=${Number(updated.currentBalance)}`);

      // 3. For linked bank/cash ledgers, also post to BankTransaction/CashTransaction
      // so the existing Bank/Cash account pages show the transaction (backward compat)
      if (ledger.linkedEntityType === 'BANK_ACCOUNT' && ledger.linkedEntityId) {
        const isDeposit = debit > 0; // debit to bank = money in
        const amount = isDeposit ? debit : credit;
        const bankAccount = await tx.bankAccount.findUnique({ where: { id: ledger.linkedEntityId } });
        if (bankAccount) {
          if (!isDeposit && Number(bankAccount.currentBalance) < amount) {
            throw new Error(`Insufficient balance in bank account ${bankAccount.accountName}`);
          }
          const updatedBank = await tx.bankAccount.update({
            where: { id: bankAccount.id },
            data: { currentBalance: isDeposit ? { increment: amount } : { decrement: amount } },
            select: { currentBalance: true },
          });
          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              type: isDeposit ? BankTxnType.DEPOSIT : BankTxnType.WITHDRAWAL,
              amount,
              balanceAfter: Number(updatedBank.currentBalance),
              date: args.voucherDate,
              description: entry.description ?? args.description ?? `${args.voucherType} ${args.jvNumber}`,
              referenceType: VOUCHER_TO_REF_TYPE[args.voucherType] ?? AccountTxnRefType.JOURNAL_VOUCHER,
              referenceId: jv.id,
              status: 'POSTED',
              budgetHeadId: args.budgetHeadId ?? null,
              createdBy: args.userId,
            },
          });
        }
      } else if (ledger.linkedEntityType === 'CASH_ACCOUNT' && ledger.linkedEntityId) {
        const isIn = debit > 0; // debit to cash = money in
        const amount = isIn ? debit : credit;
        const cashAccount = await tx.cashAccount.findUnique({ where: { id: ledger.linkedEntityId } });
        if (cashAccount) {
          if (!isIn && Number(cashAccount.currentBalance) < amount) {
            throw new Error(`Insufficient balance in cash account ${cashAccount.name}`);
          }
          const updatedCash = await tx.cashAccount.update({
            where: { id: cashAccount.id },
            data: { currentBalance: isIn ? { increment: amount } : { decrement: amount } },
            select: { currentBalance: true },
          });
          await tx.cashTransaction.create({
            data: {
              cashAccountId: cashAccount.id,
              type: isIn ? CashTxnType.IN : CashTxnType.OUT,
              amount,
              balanceAfter: Number(updatedCash.currentBalance),
              date: args.voucherDate,
              description: entry.description ?? args.description ?? `${args.voucherType} ${args.jvNumber}`,
              referenceType: VOUCHER_TO_REF_TYPE[args.voucherType] ?? AccountTxnRefType.JOURNAL_VOUCHER,
              referenceId: jv.id,
              status: 'POSTED',
              budgetHeadId: args.budgetHeadId ?? null,
              createdBy: args.userId,
            },
          });
        }
      }
    }

    await Promise.all(bankTxnPromises);

    // 4. Create bill settlement records (bill-wise accounting)
    // Links this payment voucher to specific vendor invoices being settled.
    if (args.billSettlements.length > 0) {
      for (const settlement of args.billSettlements) {
        await tx.billSettlement.create({
          data: {
            projectId: args.projectId,
            journalVoucherId: jv.id,
            invoiceId: settlement.invoiceId,
            vendorId: settlement.vendorId,
            amount: settlement.amount,
          },
        });
      }
    }

    // 5. Update Budget Head totals for PAYMENT vouchers with a budget head.
    // A payment deducts from the budget: actualAmount + paidAmount increase,
    // and committedAmount decreases by the same amount (capped at 0) so the
    // commitment earmarked by the PO is released as money actually leaves.
    // GRNs no longer affect budget — they are inventory only.
    // This runs inside the same transaction so the voucher and budget
    // update are atomic — if either fails, both roll back.
    if (args.budgetHeadId && args.voucherType === VoucherType.PAYMENT) {
      const partyEntry = args.entries.find((e) => Number(e.debit) > 0);
      const amt = partyEntry ? Number(partyEntry.debit) : 0;
      if (amt > 0) {
        const head = await tx.budgetHead.findUnique({
          where: { id: args.budgetHeadId },
          select: { committedAmount: true },
        });
        const committedRelease = Math.min(amt, Number(head?.committedAmount ?? 0));
        await tx.budgetHead.update({
          where: { id: args.budgetHeadId },
          data: {
            actualAmount: { increment: amt },
            paidAmount: { increment: amt },
            committedAmount: { decrement: committedRelease },
          },
        });
      }
    }

    // 6. Update Budget Head totals for RECEIPT vouchers with a budget head.
    // A receipt adds money INTO the budget head: allocatedAmount increases so
    // the available balance goes up. This is a budget augmentation — money
    // received for this specific budget head (e.g., a refund, grant, or
    // direct deposit tagged to a cost center).
    if (args.budgetHeadId && args.voucherType === VoucherType.RECEIPT) {
      const partyEntry = args.entries.find((e) => Number(e.credit) > 0);
      const amt = partyEntry ? Number(partyEntry.credit) : 0;
      if (amt > 0) {
        await tx.budgetHead.update({
          where: { id: args.budgetHeadId },
          data: {
            allocatedAmount: { increment: amt },
          },
        });
      }
    }

    return {
      voucherId: jv.id,
      transactions: ledgerEntryResults,
      billSettlements: args.billSettlements.length,
    };
  };

  // Use the provided transaction client, or start a new one
  if (args.tx) return run(args.tx);
  return prisma.$transaction(run);
}

// ═══════════════════════════════════════════════════════════
// Purchase posting helper — used by the invoice "Post to Books" flow
// Creates a PURCHASE voucher: Dr Purchase + Dr Input GST, Cr Sundry Creditor
// ═══════════════════════════════════════════════════════════

export async function postInvoiceToBooks(invoiceId: string, projectId: string, userId: string) {
  const invoice = await prisma.vendorInvoice.findFirst({
    where: { id: invoiceId, projectId, deletedAt: null },
    include: { vendor: true, purchaseOrder: true },
  });
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.verificationStatus !== 'VERIFIED') {
    throw new Error('Invoice must be verified before posting to books');
  }

  // Guard: if this PO's items were already posted to ledgers individually
  // (PO "Post to Ledger" action), posting the whole invoice would double-book.
  if (invoice.poId) {
    const itemPost = await prisma.pOItemLedgerPost.findFirst({
      where: { poItem: { poId: invoice.poId } },
      select: { id: true },
    });
    if (itemPost) {
      throw new Error('Items of this PO were already posted to ledgers individually — posting the invoice to books would double-book the amounts');
    }
  }

  // Check if already posted
  const existing = await prisma.journalVoucher.findFirst({
    where: { sourceInvoiceId: invoiceId, projectId, status: 'POSTED', deletedAt: null },
  });
  if (existing) {
    throw new Error(`Invoice already posted as ${existing.jvNumber}`);
  }

  // Ensure vendor ledger exists
  const vendorLedgerId = await ensureVendorLedger(invoice.vendorId, projectId);

  // Find or create the Purchase ledger
  let purchaseLedgerId = await findLedgerByName('Purchase', projectId);
  if (!purchaseLedgerId) {
    const ledger = await prisma.ledger.create({
      data: {
        projectId,
        name: 'Purchase',
        group: LedgerGroup.PURCHASE,
        linkedEntityType: 'NONE',
        openingBalance: 0,
        currentBalance: 0,
        isActive: true,
      },
    });
    purchaseLedgerId = ledger.id;
  }

  // Build entries: Dr Purchase (taxable amount), Dr Input GST, Cr Vendor (total)
  const entries: Array<{ ledgerId: string; debit: number; credit: number; description?: string }> = [];
  const taxableAmount = Number(invoice.amount);
  const cgst = Number(invoice.cgstAmount);
  const sgst = Number(invoice.sgstAmount);
  const igst = Number(invoice.igstAmount);
  const totalAmount = Number(invoice.totalAmount);

  // Debit Purchase ledger (taxable amount)
  entries.push({
    ledgerId: purchaseLedgerId,
    debit: taxableAmount,
    credit: 0,
    description: `Purchase - ${invoice.invoiceNumber}`,
  });

  // Debit Input GST ledgers (if any GST)
  if (cgst > 0) {
    const cgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_CGST, projectId);
    if (cgstLedgerId) {
      entries.push({ ledgerId: cgstLedgerId, debit: cgst, credit: 0, description: `Input CGST - ${invoice.invoiceNumber}` });
    }
  }
  if (sgst > 0) {
    const sgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_SGST, projectId);
    if (sgstLedgerId) {
      entries.push({ ledgerId: sgstLedgerId, debit: sgst, credit: 0, description: `Input SGST - ${invoice.invoiceNumber}` });
    }
  }
  if (igst > 0) {
    const igstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_IGST, projectId);
    if (igstLedgerId) {
      entries.push({ ledgerId: igstLedgerId, debit: igst, credit: 0, description: `Input IGST - ${invoice.invoiceNumber}` });
    }
  }

  // Credit Vendor ledger (total amount payable)
  entries.push({
    ledgerId: vendorLedgerId,
    debit: 0,
    credit: totalAmount,
    description: `Payable to ${invoice.vendor.name} - ${invoice.invoiceNumber}`,
  });

  // Validate totals balance
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    // If rounding causes imbalance, adjust the vendor credit to match debits
    entries[entries.length - 1].credit = totalDebit;
  }

  // Fetch all ledgers
  const ledgerIds = entries.map((e) => e.ledgerId);
  const ledgers = await prisma.ledger.findMany({ where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true } });
  if (ledgers.length !== ledgerIds.length) {
    throw new Error('One or more required ledgers (Purchase / Input GST) not found. Run ledger sync first.');
  }
  const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));

  const jvNumber = await generateVoucherNumber(VoucherType.PURCHASE);
  const voucherDate = new Date(invoice.date);

  const result = await postVoucher({
    projectId,
    jvNumber,
    voucherType: VoucherType.PURCHASE,
    voucherDate,
    description: `Purchase - Invoice ${invoice.invoiceNumber} (${invoice.vendor.name})`,
    totalDebit,
    totalCredit,
    entries,
    ledgerMap,
    budgetHeadMap: new Map(), // no cost center for auto-generated purchase vouchers
    sourceInvoiceId: invoiceId,
    billSettlements: [], // purchase vouchers create payable, don't settle
    userId,
  });

  await logAudit({
    userId,
    action: AuditAction.CREATE,
    entityType: 'VOUCHER',
    entityId: result.voucherId,
    projectId,
    newValue: { jvNumber, voucherType: VoucherType.PURCHASE, sourceInvoiceId: invoiceId, invoiceNumber: invoice.invoiceNumber },
  });

  return {
    message: 'Invoice posted to books',
    jvNumber,
    voucherId: result.voucherId,
  };
}

// ═══════════════════════════════════════════════════════════
// Credit Note — vendor issues a credit (price reduction, discount, or goods returned)
// Creates a CREDIT_NOTE voucher: Dr Sundry Creditor (vendor), Cr Purchase + Cr Input GST
// ═══════════════════════════════════════════════════════════

async function postCreditOrDebitNote(
  voucherType: VoucherType,
  projectId: string,
  userId: string,
  body: {
    vendorId: string;
    amount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    date?: string;
    description?: string;
    invoiceId?: string;
  },
) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: body.vendorId, projectId, deletedAt: null },
  });
  if (!vendor) throw new Error('Vendor not found');

  const vendorLedgerId = await ensureVendorLedger(vendor.id, projectId);

  // Find or create Purchase ledger
  let purchaseLedgerId = await findLedgerByName('Purchase', projectId);
  if (!purchaseLedgerId) {
    const ledger = await prisma.ledger.create({
      data: {
        projectId,
        name: 'Purchase',
        group: LedgerGroup.PURCHASE,
        linkedEntityType: 'NONE',
        openingBalance: 0,
        currentBalance: 0,
        isActive: true,
      },
    });
    purchaseLedgerId = ledger.id;
  }

  const entries: Array<{ ledgerId: string; debit: number; credit: number; description?: string }> = [];
  const taxableAmount = Number(body.amount);
  const cgst = Number(body.cgstAmount);
  const sgst = Number(body.sgstAmount);
  const igst = Number(body.igstAmount);
  const totalGst = cgst + sgst + igst;
  const totalPayable = taxableAmount + totalGst;

  // Dr Vendor (reduces what we owe)
  entries.push({
    ledgerId: vendorLedgerId,
    debit: totalPayable,
    credit: 0,
    description: body.description ?? `${voucherType === VoucherType.CREDIT_NOTE ? 'Credit Note' : 'Debit Note'} - ${vendor.name}`,
  });

  // Cr Purchase (reduces the purchase expense)
  entries.push({
    ledgerId: purchaseLedgerId,
    debit: 0,
    credit: taxableAmount,
    description: `Purchase reversal - ${vendor.name}`,
  });

  // Cr Input GST (reverses the input GST claimed)
  if (cgst > 0) {
    const cgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_CGST, projectId);
    if (cgstLedgerId) entries.push({ ledgerId: cgstLedgerId, debit: 0, credit: cgst, description: 'Input CGST reversal' });
  }
  if (sgst > 0) {
    const sgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_SGST, projectId);
    if (sgstLedgerId) entries.push({ ledgerId: sgstLedgerId, debit: 0, credit: sgst, description: 'Input SGST reversal' });
  }
  if (igst > 0) {
    const igstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_IGST, projectId);
    if (igstLedgerId) entries.push({ ledgerId: igstLedgerId, debit: 0, credit: igst, description: 'Input IGST reversal' });
  }

  // Validate totals balance
  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    entries[0].debit = totalCredit; // adjust vendor debit to match credits
  }

  // Fetch all ledgers for the ledgerMap
  const ledgerIds = entries.map((e) => e.ledgerId);
  const ledgers = await prisma.ledger.findMany({ where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true } });
  if (ledgers.length !== ledgerIds.length) {
    throw new Error('One or more required ledgers not found. Run ledger sync first.');
  }
  const ledgerMap = new Map(ledgers.map((l) => [l.id, { id: l.id, name: l.name, group: l.group, linkedEntityType: l.linkedEntityType, linkedEntityId: l.linkedEntityId }]));

  const jvNumber = await generateVoucherNumber(voucherType);
  const voucherDate = body.date ? new Date(body.date) : new Date();

  const result = await postVoucher({
    projectId,
    jvNumber,
    voucherType,
    voucherDate,
    description: body.description ?? `${voucherType === VoucherType.CREDIT_NOTE ? 'Credit Note' : 'Debit Note'} - ${vendor.name}`,
    totalDebit,
    totalCredit,
    entries,
    ledgerMap,
    budgetHeadMap: new Map(),
    sourceInvoiceId: body.invoiceId ?? null,
    billSettlements: [],
    userId,
  });

  await logAudit({
    userId,
    action: AuditAction.CREATE,
    entityType: 'VOUCHER',
    entityId: result.voucherId,
    projectId,
    newValue: { jvNumber, voucherType, vendorId: vendor.id, amount: taxableAmount, gst: totalGst },
  });

  return { jvNumber, voucherId: result.voucherId, message: `${voucherType === VoucherType.CREDIT_NOTE ? 'Credit note' : 'Debit note'} posted` };
}

// ── Credit Note endpoint ──
router.post(
  '/credit-note',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(creditDebitNoteSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const result = await postCreditOrDebitNote(VoucherType.CREDIT_NOTE, projectId, req.user!.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Debit Note endpoint ──
router.post(
  '/debit-note',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(creditDebitNoteSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const result = await postCreditOrDebitNote(VoucherType.DEBIT_NOTE, projectId, req.user!.id, req.body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
