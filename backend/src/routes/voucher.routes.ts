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
} from '@hospital-erp/shared';
import {
  createVoucherSchema,
  listVouchersSchema,
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
    },
    orderBy: { createdAt: 'asc' as const },
  },
  createdByUser: { select: { id: true, name: true } },
  postedByUser: { select: { id: true, name: true } },
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

async function generateVoucherNumber(voucherType: string): Promise<string> {
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

// ── List vouchers (with type filter, date range) ──
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listVouchersSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 20, search, voucherType, status, startDate, endDate } = req.query as Record<string, unknown>;

      const where: Prisma.JournalVoucherWhereInput = {
        projectId,
        deletedAt: null,
        // Only show new-style vouchers (those with ledger entries). Legacy JVs
        // (type=OWNER_EXPENSE etc.) are shown on the Journal Vouchers page.
        // We filter by voucherType being one of the new types.
        voucherType: { not: VoucherType.JOURNAL },
        ...(voucherType ? { voucherType: String(voucherType) } : {}),
        ...(status ? { status: String(status) } : {}),
        ...(search ? { jvNumber: { contains: String(search), mode: 'insensitive' } } : {}),
        ...(startDate || endDate ? {
          date: {
            ...(startDate ? { gte: new Date(String(startDate)) } : {}),
            ...(endDate ? { lte: new Date(String(endDate)) } : {}),
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
      const { voucherType, date, description, entries, sourceInvoiceId } = req.body;

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

      const jvNumber = await generateVoucherNumber(String(voucherType));
      const voucherDate = date ? new Date(String(date)) : new Date();

      // Post the voucher atomically: create JV + ledger entries + update ledger balances
      const result = await postVoucher({
        projectId,
        jvNumber,
        voucherType: String(voucherType),
        voucherDate,
        description: description ?? null,
        totalDebit,
        totalCredit,
        entries: entries as Array<{ ledgerId: string; debit: number; credit: number; description?: string }>,
        ledgerMap,
        sourceInvoiceId: sourceInvoiceId ?? null,
        userId: req.user!.id,
      });

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
  rbacMiddleware(Permission.MANAGE_FINANCE),
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

      // Reverse: swap debit/credit on each ledger entry, update balances
      await prisma.$transaction(async (tx) => {
        // Atomically claim the voucher (prevent double-cancel)
        const claimed = await tx.journalVoucher.updateMany({
          where: { id: voucher.id, status: 'POSTED' },
          data: { status: 'CANCELLED' },
        });
        if (claimed.count !== 1) {
          throw new Error('Voucher is already being cancelled or is not POSTED');
        }

        for (const entry of voucher.ledgerEntries) {
          const ledger = await tx.ledger.findUnique({ where: { id: entry.ledgerId } });
          if (!ledger) continue;

          // Reverse the balance effect: debit becomes credit and vice versa
          const reverseDelta = Number(entry.credit) - Number(entry.debit);
          await tx.ledger.update({
            where: { id: entry.ledgerId },
            data: { currentBalance: { increment: reverseDelta } },
          });
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

// ═══════════════════════════════════════════════════════════
// Voucher Posting Engine — core double-entry logic
// ═══════════════════════════════════════════════════════════

interface PostVoucherArgs {
  projectId: string;
  jvNumber: string;
  voucherType: string;
  voucherDate: Date;
  description: string | null;
  totalDebit: number;
  totalCredit: number;
  entries: Array<{ ledgerId: string; debit: number; credit: number; description?: string }>;
  ledgerMap: Map<string, { id: string; name: string; group: string; linkedEntityType: string | null; linkedEntityId: string | null }>;
  sourceInvoiceId: string | null;
  userId: string;
}

async function postVoucher(args: PostVoucherArgs) {
  return prisma.$transaction(async (tx) => {
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

      // Create the ledger entry record
      await tx.ledgerEntry.create({
        data: {
          ledgerId: entry.ledgerId,
          journalVoucherId: jv.id,
          debit,
          credit,
          description: entry.description ?? args.description ?? args.jvNumber,
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
              referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
              referenceId: jv.id,
              status: 'POSTED',
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
              referenceType: AccountTxnRefType.JOURNAL_VOUCHER,
              referenceId: jv.id,
              status: 'POSTED',
              createdBy: args.userId,
            },
          });
        }
      }
    }

    await Promise.all(bankTxnPromises);

    return {
      voucherId: jv.id,
      transactions: ledgerEntryResults,
    };
  });
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
    sourceInvoiceId: invoiceId,
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

export default router;
