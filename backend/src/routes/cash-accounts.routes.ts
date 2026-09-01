import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, CashTxnType, VoucherType } from '@hospital-erp/shared';
import {
  createCashAccountSchema,
  updateCashAccountSchema,
  listCashAccountsSchema,
  cashTransferSchema,
  bankToCashSchema,
  cashToBankSchema,
  listCashTransactionsSchema,
  bankDepositSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { ensureCashLedger, ensureBankLedger } from './ledger.routes';
import { postVoucher, generateVoucherNumber } from './voucher.routes';

// ── Base CRUD via factory ──
const crudRouter = createCrudRouter({
  entityType: 'CASH_ACCOUNT',
  model: 'cashAccount',
  createPermission: Permission.MANAGE_FINANCE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createCashAccountSchema,
  updateSchema: updateCashAccountSchema,
  listSchema: listCashAccountsSchema,
  searchFields: ['name'],
  defaultSort: { createdAt: 'asc' },
  transformCreate: async (body, _userId, projectId) => ({
    projectId,
    name: body.name as string,
    openingBalance: (body.openingBalance as number) ?? 0,
    currentBalance: (body.openingBalance as number) ?? 0,
  }),
  transformUpdate: async (body) => {
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'isActive']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    return data;
  },
  afterCreate: async (record, _userId, projectId) => {
    // Auto-create a Cash ledger for this account. Fire-and-forget.
    await ensureCashLedger(record.id as string, projectId).catch((err) =>
      console.error(`[CashAccount] auto-ledger creation failed for ${record.id}:`, err),
    );
  },
  afterUpdate: async (record, _userId, _projectId) => {
    if (record.name) {
      await prisma.ledger.updateMany({
        where: { linkedEntityType: 'CASH_ACCOUNT', linkedEntityId: record.id as string, deletedAt: null },
        data: { name: record.name as string },
      }).catch((err) => console.error(`[CashAccount] ledger name sync failed for ${record.id}:`, err));
    }
  },
});

const router = Router();
router.use(authMiddleware);
router.use(crudRouter);

// ── Cash account statement ──
router.get(
  '/:id/statement',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listCashTransactionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 50, startDate, endDate, type } = req.query as Record<string, unknown>;

      const account = await prisma.cashAccount.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!account) {
        res.status(404).json({ error: 'Cash account not found' });
        return;
      }

      const where: Prisma.CashTransactionWhereInput = {
        cashAccountId: req.params.id,
        status: 'POSTED',
      };
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(String(startDate));
        if (endDate) where.date.lte = new Date(String(endDate));
      }
      if (type) where.type = String(type);

      const [data, total] = await Promise.all([
        prisma.cashTransaction.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.cashTransaction.count({ where }),
      ]);

      res.json({
        account: {
          id: account.id,
          name: account.name,
          openingBalance: Number(account.openingBalance),
          currentBalance: Number(account.currentBalance),
        },
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

// ── Cash IN (money into cash account) — creates a RECEIPT voucher ──
// Tally-style: Dr Cash, Cr [contra ledger selected by user]
router.post(
  '/:id/in',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankDepositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, contraLedgerId, date, description } = req.body;

      // Find the cash ledger for this cash account
      const cashLedger = await prisma.ledger.findFirst({
        where: { linkedEntityType: 'CASH_ACCOUNT', linkedEntityId: req.params.id, projectId, deletedAt: null },
      });
      if (!cashLedger) {
        res.status(400).json({ error: 'Cash ledger not found. Run ledger sync first.' });
        return;
      }

      // Validate the contra ledger
      const contraLedger = await prisma.ledger.findFirst({
        where: { id: contraLedgerId, projectId, deletedAt: null },
      });
      if (!contraLedger) {
        res.status(400).json({ error: 'Selected ledger not found' });
        return;
      }

      const amt = Number(amount);
      const ledgerMap = new Map([
        [cashLedger.id, { id: cashLedger.id, name: cashLedger.name, group: cashLedger.group, linkedEntityType: cashLedger.linkedEntityType, linkedEntityId: cashLedger.linkedEntityId }],
        [contraLedger.id, { id: contraLedger.id, name: contraLedger.name, group: contraLedger.group, linkedEntityType: contraLedger.linkedEntityType, linkedEntityId: contraLedger.linkedEntityId }],
      ]);

      const jvNumber = await generateVoucherNumber(VoucherType.RECEIPT);
      const voucherDate = date ? new Date(String(date)) : new Date();

      // Receipt: Dr Cash (money in), Cr Contra ledger (source of money)
      const result = await postVoucher({
        projectId,
        jvNumber,
        voucherType: VoucherType.RECEIPT,
        voucherDate,
        description: description ?? `Cash In to ${cashLedger.name}`,
        totalDebit: amt,
        totalCredit: amt,
        entries: [
          { ledgerId: cashLedger.id, debit: amt, credit: 0 },
          { ledgerId: contraLedger.id, debit: 0, credit: amt },
        ],
        ledgerMap,
        budgetHeadMap: new Map(),
        sourceInvoiceId: null,
        billSettlements: [],
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.voucherId,
        projectId,
        newValue: { type: CashTxnType.IN, amount, cashAccountId: req.params.id, contraLedgerId, jvNumber },
      });

      res.status(201).json({ jvNumber, ...result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Cash OUT (money out of cash account) — creates a PAYMENT voucher ──
// Tally-style: Dr [contra ledger selected by user], Cr Cash
router.post(
  '/:id/out',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankDepositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, contraLedgerId, date, description } = req.body;

      // Find the cash ledger for this cash account
      const cashLedger = await prisma.ledger.findFirst({
        where: { linkedEntityType: 'CASH_ACCOUNT', linkedEntityId: req.params.id, projectId, deletedAt: null },
      });
      if (!cashLedger) {
        res.status(400).json({ error: 'Cash ledger not found. Run ledger sync first.' });
        return;
      }

      // Validate the contra ledger
      const contraLedger = await prisma.ledger.findFirst({
        where: { id: contraLedgerId, projectId, deletedAt: null },
      });
      if (!contraLedger) {
        res.status(400).json({ error: 'Selected ledger not found' });
        return;
      }

      const amt = Number(amount);
      const ledgerMap = new Map([
        [cashLedger.id, { id: cashLedger.id, name: cashLedger.name, group: cashLedger.group, linkedEntityType: cashLedger.linkedEntityType, linkedEntityId: cashLedger.linkedEntityId }],
        [contraLedger.id, { id: contraLedger.id, name: contraLedger.name, group: contraLedger.group, linkedEntityType: contraLedger.linkedEntityType, linkedEntityId: contraLedger.linkedEntityId }],
      ]);

      const jvNumber = await generateVoucherNumber(VoucherType.PAYMENT);
      const voucherDate = date ? new Date(String(date)) : new Date();

      // Payment: Dr Contra ledger (where money goes), Cr Cash (money out)
      const result = await postVoucher({
        projectId,
        jvNumber,
        voucherType: VoucherType.PAYMENT,
        voucherDate,
        description: description ?? `Cash Out from ${cashLedger.name}`,
        totalDebit: amt,
        totalCredit: amt,
        entries: [
          { ledgerId: contraLedger.id, debit: amt, credit: 0 },
          { ledgerId: cashLedger.id, debit: 0, credit: amt },
        ],
        ledgerMap,
        budgetHeadMap: new Map(),
        sourceInvoiceId: null,
        billSettlements: [],
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.voucherId,
        projectId,
        newValue: { type: CashTxnType.OUT, amount, cashAccountId: req.params.id, contraLedgerId, jvNumber },
      });

      res.status(201).json({ jvNumber, ...result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Transfer between two cash accounts (atomic two-sided) ──
router.post(
  '/transfer',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(cashTransferSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { fromAccountId, toAccountId, amount, date, description } = req.body;

      if (fromAccountId === toAccountId) {
        res.status(400).json({ error: 'Cannot transfer to the same account' });
        return;
      }

      const result = await transferCashToCash({
        fromAccountId,
        toAccountId,
        projectId,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.voucherId,
        projectId,
        newValue: { type: 'CONTRA_TRANSFER', amount, fromAccountId, toAccountId, jvNumber: result.jvNumber },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Bank → Cash (withdraw from bank, deposit into cash) ──
router.post(
  '/bank-to-cash',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankToCashSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { bankAccountId, cashAccountId, amount, date, description } = req.body;

      const result = await transferBankToCash({
        bankAccountId,
        cashAccountId,
        projectId,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BANK_TRANSACTION',
        entityId: result.voucherId,
        projectId,
        newValue: { type: 'CONTRA_BANK_TO_CASH', amount, bankAccountId, cashAccountId, jvNumber: result.jvNumber },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Cash → Bank (deposit cash into bank) ──
router.post(
  '/cash-to-bank',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(cashToBankSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { bankAccountId, cashAccountId, amount, date, description } = req.body;

      const result = await transferCashToBank({
        bankAccountId,
        cashAccountId,
        projectId,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.voucherId,
        projectId,
        newValue: { type: 'CONTRA_CASH_TO_BANK', amount, bankAccountId, cashAccountId, jvNumber: result.jvNumber },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Shared posting helpers — exported for use by payment routes later
// ═══════════════════════════════════════════════════════════

interface PostCashTxnArgs {
  cashAccountId: string;
  projectId: string;
  type: string;
  amount: number;
  date: Date;
  description: string | null;
  referenceType: string;
  referenceId?: string;
  userId: string;
}

export async function postCashTransaction(args: PostCashTxnArgs) {
  return prisma.$transaction(async (tx) => {
    // Read only for validation; the balance is updated atomically below.
    const account = await tx.cashAccount.findFirst({
      where: { id: args.cashAccountId, projectId: args.projectId, deletedAt: null },
    });
    if (!account) throw new Error('Cash account not found');
    if (!account.isActive) throw new Error('Cash account is inactive');

    const isIn = [CashTxnType.IN, CashTxnType.TRANSFER_IN, CashTxnType.REVERSAL_IN].includes(
      args.type as CashTxnType,
    );
    const isOut = [CashTxnType.OUT, CashTxnType.TRANSFER_OUT, CashTxnType.REVERSAL_OUT].includes(
      args.type as CashTxnType,
    );

    if (!isIn && !isOut) throw new Error(`Invalid cash transaction type: ${args.type}`);
    if (isOut && Number(account.currentBalance) < args.amount) {
      throw new Error('Insufficient balance in cash account');
    }

    // Atomic balance update — DB applies the delta, preventing lost updates
    // under concurrent postings.
    const updated = await tx.cashAccount.update({
      where: { id: args.cashAccountId },
      data: { currentBalance: isIn ? { increment: args.amount } : { decrement: args.amount } },
      select: { currentBalance: true },
    });
    const newBalance = Number(updated.currentBalance);

    const transaction = await tx.cashTransaction.create({
      data: {
        cashAccountId: args.cashAccountId,
        type: args.type,
        amount: args.amount,
        balanceAfter: newBalance,
        date: args.date,
        description: args.description,
        referenceType: args.referenceType,
        referenceId: args.referenceId ?? null,
        status: 'POSTED',
        createdBy: args.userId,
      },
    });

    return { transaction, newBalance };
  });
}

interface TransferCashArgs {
  fromAccountId: string;
  toAccountId: string;
  projectId: string;
  amount: number;
  date: Date;
  description: string | null;
  userId: string;
}

export async function transferCashToCash(args: TransferCashArgs) {
  const fromLedgerId = await ensureCashLedger(args.fromAccountId, args.projectId);
  const toLedgerId = await ensureCashLedger(args.toAccountId, args.projectId);

  const fromAccount = await prisma.cashAccount.findFirst({
    where: { id: args.fromAccountId, projectId: args.projectId, deletedAt: null },
  });
  if (!fromAccount) throw new Error('Source cash account not found');
  if (!fromAccount.isActive) throw new Error('Source cash account is inactive');
  if (Number(fromAccount.currentBalance) < args.amount) {
    throw new Error('Insufficient balance in source account');
  }

  const [fromLedger, toLedger] = await Promise.all([
    prisma.ledger.findUnique({ where: { id: fromLedgerId } }),
    prisma.ledger.findUnique({ where: { id: toLedgerId } }),
  ]);
  if (!fromLedger || !toLedger) throw new Error('Failed to load cash ledgers');

  const ledgerMap = new Map([
    [fromLedger.id, { id: fromLedger.id, name: fromLedger.name, group: fromLedger.group, linkedEntityType: fromLedger.linkedEntityType, linkedEntityId: fromLedger.linkedEntityId }],
    [toLedger.id, { id: toLedger.id, name: toLedger.name, group: toLedger.group, linkedEntityType: toLedger.linkedEntityType, linkedEntityId: toLedger.linkedEntityId }],
  ]);

  const jvNumber = await generateVoucherNumber(VoucherType.CONTRA);

  // Contra: Dr destination cash (money in), Cr source cash (money out)
  const result = await postVoucher({
    projectId: args.projectId,
    jvNumber,
    voucherType: VoucherType.CONTRA,
    voucherDate: args.date,
    description: args.description ?? `Transfer: ${fromLedger.name} → ${toLedger.name}`,
    totalDebit: args.amount,
    totalCredit: args.amount,
    entries: [
      { ledgerId: toLedgerId, debit: args.amount, credit: 0 },
      { ledgerId: fromLedgerId, debit: 0, credit: args.amount },
    ],
    ledgerMap,
    budgetHeadMap: new Map(),
    sourceInvoiceId: null,
    billSettlements: [],
    userId: args.userId,
  });

  return { jvNumber, ...result };
}

// ── Bank → Cash cross-account transfer (CONTRA voucher) ──
interface BankCashTransferArgs {
  bankAccountId: string;
  cashAccountId: string;
  projectId: string;
  amount: number;
  date: Date;
  description: string | null;
  userId: string;
}

export async function transferBankToCash(args: BankCashTransferArgs) {
  const bankLedgerId = await ensureBankLedger(args.bankAccountId, args.projectId);
  const cashLedgerId = await ensureCashLedger(args.cashAccountId, args.projectId);

  const bankAcct = await prisma.bankAccount.findFirst({
    where: { id: args.bankAccountId, projectId: args.projectId, deletedAt: null },
  });
  if (!bankAcct) throw new Error('Bank account not found');
  if (!bankAcct.isActive) throw new Error('Bank account is inactive');
  if (Number(bankAcct.currentBalance) < args.amount) {
    throw new Error('Insufficient balance in bank account');
  }

  const [bankLedger, cashLedger] = await Promise.all([
    prisma.ledger.findUnique({ where: { id: bankLedgerId } }),
    prisma.ledger.findUnique({ where: { id: cashLedgerId } }),
  ]);
  if (!bankLedger || !cashLedger) throw new Error('Failed to load ledgers');

  const ledgerMap = new Map([
    [bankLedger.id, { id: bankLedger.id, name: bankLedger.name, group: bankLedger.group, linkedEntityType: bankLedger.linkedEntityType, linkedEntityId: bankLedger.linkedEntityId }],
    [cashLedger.id, { id: cashLedger.id, name: cashLedger.name, group: cashLedger.group, linkedEntityType: cashLedger.linkedEntityType, linkedEntityId: cashLedger.linkedEntityId }],
  ]);

  const jvNumber = await generateVoucherNumber(VoucherType.CONTRA);

  // Contra: Dr Cash (money in), Cr Bank (money out)
  const result = await postVoucher({
    projectId: args.projectId,
    jvNumber,
    voucherType: VoucherType.CONTRA,
    voucherDate: args.date,
    description: args.description ?? `Transfer: ${bankLedger.name} → ${cashLedger.name}`,
    totalDebit: args.amount,
    totalCredit: args.amount,
    entries: [
      { ledgerId: cashLedgerId, debit: args.amount, credit: 0 },
      { ledgerId: bankLedgerId, debit: 0, credit: args.amount },
    ],
    ledgerMap,
    budgetHeadMap: new Map(),
    sourceInvoiceId: null,
    billSettlements: [],
    userId: args.userId,
  });

  return { jvNumber, ...result };
}

// ── Cash → Bank cross-account transfer (CONTRA voucher) ──
export async function transferCashToBank(args: BankCashTransferArgs) {
  const bankLedgerId = await ensureBankLedger(args.bankAccountId, args.projectId);
  const cashLedgerId = await ensureCashLedger(args.cashAccountId, args.projectId);

  const cashAcct = await prisma.cashAccount.findFirst({
    where: { id: args.cashAccountId, projectId: args.projectId, deletedAt: null },
  });
  if (!cashAcct) throw new Error('Cash account not found');
  if (!cashAcct.isActive) throw new Error('Cash account is inactive');
  if (Number(cashAcct.currentBalance) < args.amount) {
    throw new Error('Insufficient balance in cash account');
  }

  const [bankLedger, cashLedger] = await Promise.all([
    prisma.ledger.findUnique({ where: { id: bankLedgerId } }),
    prisma.ledger.findUnique({ where: { id: cashLedgerId } }),
  ]);
  if (!bankLedger || !cashLedger) throw new Error('Failed to load ledgers');

  const ledgerMap = new Map([
    [bankLedger.id, { id: bankLedger.id, name: bankLedger.name, group: bankLedger.group, linkedEntityType: bankLedger.linkedEntityType, linkedEntityId: bankLedger.linkedEntityId }],
    [cashLedger.id, { id: cashLedger.id, name: cashLedger.name, group: cashLedger.group, linkedEntityType: cashLedger.linkedEntityType, linkedEntityId: cashLedger.linkedEntityId }],
  ]);

  const jvNumber = await generateVoucherNumber(VoucherType.CONTRA);

  // Contra: Dr Bank (money in), Cr Cash (money out)
  const result = await postVoucher({
    projectId: args.projectId,
    jvNumber,
    voucherType: VoucherType.CONTRA,
    voucherDate: args.date,
    description: args.description ?? `Transfer: ${cashLedger.name} → ${bankLedger.name}`,
    totalDebit: args.amount,
    totalCredit: args.amount,
    entries: [
      { ledgerId: bankLedgerId, debit: args.amount, credit: 0 },
      { ledgerId: cashLedgerId, debit: 0, credit: args.amount },
    ],
    ledgerMap,
    budgetHeadMap: new Map(),
    sourceInvoiceId: null,
    billSettlements: [],
    userId: args.userId,
  });

  return { jvNumber, ...result };
}

export default router;
