import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, CashTxnType, BankTxnType, AccountTxnRefType } from '@hospital-erp/shared';
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
          orderBy: { date: 'desc', createdAt: 'desc' },
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

// ── Cash IN (money into cash account) ──
router.post(
  '/:id/in',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankDepositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, date, description } = req.body;

      const result = await postCashTransaction({
        cashAccountId: req.params.id,
        projectId,
        type: CashTxnType.IN,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        referenceType: AccountTxnRefType.MANUAL_DEPOSIT,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.transaction.id,
        projectId,
        newValue: { type: CashTxnType.IN, amount, cashAccountId: req.params.id },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Cash OUT (money out of cash account) ──
router.post(
  '/:id/out',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankDepositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, date, description } = req.body;

      const result = await postCashTransaction({
        cashAccountId: req.params.id,
        projectId,
        type: CashTxnType.OUT,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        referenceType: AccountTxnRefType.MANUAL_WITHDRAWAL,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'CASH_TRANSACTION',
        entityId: result.transaction.id,
        projectId,
        newValue: { type: CashTxnType.OUT, amount, cashAccountId: req.params.id },
      });

      res.status(201).json(result);
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
        entityId: result.fromTxn.id,
        projectId,
        newValue: { type: 'TRANSFER', amount, fromAccountId, toAccountId },
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
        entityId: result.bankTxn.id,
        projectId,
        newValue: { type: 'BANK_TO_CASH', amount, bankAccountId, cashAccountId },
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
        entityId: result.cashTxn.id,
        projectId,
        newValue: { type: 'CASH_TO_BANK', amount, bankAccountId, cashAccountId },
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
    const account = await tx.cashAccount.findFirst({
      where: { id: args.cashAccountId, projectId: args.projectId, deletedAt: null },
    });
    if (!account) throw new Error('Cash account not found');
    if (!account.isActive) throw new Error('Cash account is inactive');

    const currentBalance = Number(account.currentBalance);
    let newBalance: number;

    const isIn = [CashTxnType.IN, CashTxnType.TRANSFER_IN, CashTxnType.REVERSAL_IN].includes(
      args.type as CashTxnType,
    );
    const isOut = [CashTxnType.OUT, CashTxnType.TRANSFER_OUT, CashTxnType.REVERSAL_OUT].includes(
      args.type as CashTxnType,
    );

    if (isIn) {
      newBalance = currentBalance + args.amount;
    } else if (isOut) {
      newBalance = currentBalance - args.amount;
      if (newBalance < 0) throw new Error('Insufficient balance in cash account');
    } else {
      throw new Error(`Invalid cash transaction type: ${args.type}`);
    }

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

    await tx.cashAccount.update({
      where: { id: args.cashAccountId },
      data: { currentBalance: newBalance },
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
  return prisma.$transaction(async (tx) => {
    const [fromAccount, toAccount] = await Promise.all([
      tx.cashAccount.findFirst({
        where: { id: args.fromAccountId, projectId: args.projectId, deletedAt: null },
      }),
      tx.cashAccount.findFirst({
        where: { id: args.toAccountId, projectId: args.projectId, deletedAt: null },
      }),
    ]);
    if (!fromAccount) throw new Error('Source cash account not found');
    if (!toAccount) throw new Error('Destination cash account not found');
    if (!fromAccount.isActive || !toAccount.isActive) throw new Error('One or both accounts are inactive');

    const fromBalance = Number(fromAccount.currentBalance) - args.amount;
    if (fromBalance < 0) throw new Error('Insufficient balance in source account');
    const toBalance = Number(toAccount.currentBalance) + args.amount;

    const transferPairId = crypto.randomUUID();

    const [fromTxn, toTxn] = await Promise.all([
      tx.cashTransaction.create({
        data: {
          cashAccountId: args.fromAccountId,
          type: CashTxnType.TRANSFER_OUT,
          amount: args.amount,
          balanceAfter: fromBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
      tx.cashTransaction.create({
        data: {
          cashAccountId: args.toAccountId,
          type: CashTxnType.TRANSFER_IN,
          amount: args.amount,
          balanceAfter: toBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
    ]);

    await Promise.all([
      tx.cashAccount.update({
        where: { id: args.fromAccountId },
        data: { currentBalance: fromBalance },
      }),
      tx.cashAccount.update({
        where: { id: args.toAccountId },
        data: { currentBalance: toBalance },
      }),
    ]);

    return { fromTxn, toTxn, transferPairId };
  });
}

// ── Bank → Cash cross-account transfer (atomic) ──
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
  return prisma.$transaction(async (tx) => {
    const [bankAcct, cashAcct] = await Promise.all([
      tx.bankAccount.findFirst({
        where: { id: args.bankAccountId, projectId: args.projectId, deletedAt: null },
      }),
      tx.cashAccount.findFirst({
        where: { id: args.cashAccountId, projectId: args.projectId, deletedAt: null },
      }),
    ]);
    if (!bankAcct) throw new Error('Bank account not found');
    if (!cashAcct) throw new Error('Cash account not found');
    if (!bankAcct.isActive || !cashAcct.isActive) throw new Error('One or both accounts are inactive');

    const bankBalance = Number(bankAcct.currentBalance) - args.amount;
    if (bankBalance < 0) throw new Error('Insufficient balance in bank account');
    const cashBalance = Number(cashAcct.currentBalance) + args.amount;

    const transferPairId = crypto.randomUUID();

    const [bankTxn, cashTxn] = await Promise.all([
      tx.bankTransaction.create({
        data: {
          bankAccountId: args.bankAccountId,
          type: BankTxnType.TRANSFER_OUT,
          amount: args.amount,
          balanceAfter: bankBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
      tx.cashTransaction.create({
        data: {
          cashAccountId: args.cashAccountId,
          type: CashTxnType.TRANSFER_IN,
          amount: args.amount,
          balanceAfter: cashBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
    ]);

    await Promise.all([
      tx.bankAccount.update({
        where: { id: args.bankAccountId },
        data: { currentBalance: bankBalance },
      }),
      tx.cashAccount.update({
        where: { id: args.cashAccountId },
        data: { currentBalance: cashBalance },
      }),
    ]);

    return { bankTxn, cashTxn, transferPairId };
  });
}

// ── Cash → Bank cross-account transfer (atomic) ──
export async function transferCashToBank(args: BankCashTransferArgs) {
  return prisma.$transaction(async (tx) => {
    const [bankAcct, cashAcct] = await Promise.all([
      tx.bankAccount.findFirst({
        where: { id: args.bankAccountId, projectId: args.projectId, deletedAt: null },
      }),
      tx.cashAccount.findFirst({
        where: { id: args.cashAccountId, projectId: args.projectId, deletedAt: null },
      }),
    ]);
    if (!bankAcct) throw new Error('Bank account not found');
    if (!cashAcct) throw new Error('Cash account not found');
    if (!bankAcct.isActive || !cashAcct.isActive) throw new Error('One or both accounts are inactive');

    const cashBalance = Number(cashAcct.currentBalance) - args.amount;
    if (cashBalance < 0) throw new Error('Insufficient balance in cash account');
    const bankBalance = Number(bankAcct.currentBalance) + args.amount;

    const transferPairId = crypto.randomUUID();

    const [cashTxn, bankTxn] = await Promise.all([
      tx.cashTransaction.create({
        data: {
          cashAccountId: args.cashAccountId,
          type: CashTxnType.TRANSFER_OUT,
          amount: args.amount,
          balanceAfter: cashBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
      tx.bankTransaction.create({
        data: {
          bankAccountId: args.bankAccountId,
          type: BankTxnType.TRANSFER_IN,
          amount: args.amount,
          balanceAfter: bankBalance,
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
    ]);

    await Promise.all([
      tx.cashAccount.update({
        where: { id: args.cashAccountId },
        data: { currentBalance: cashBalance },
      }),
      tx.bankAccount.update({
        where: { id: args.bankAccountId },
        data: { currentBalance: bankBalance },
      }),
    ]);

    return { cashTxn, bankTxn, transferPairId };
  });
}

export default router;
