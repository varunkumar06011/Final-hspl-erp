import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, BankTxnType, AccountTxnRefType } from '@hospital-erp/shared';
import {
  createBankAccountSchema,
  updateBankAccountSchema,
  listBankAccountsSchema,
  bankDepositSchema,
  bankWithdrawSchema,
  bankTransferSchema,
  listBankTransactionsSchema,
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
  entityType: 'BANK_ACCOUNT',
  model: 'bankAccount',
  createPermission: Permission.MANAGE_FINANCE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createBankAccountSchema,
  updateSchema: updateBankAccountSchema,
  listSchema: listBankAccountsSchema,
  searchFields: ['accountName', 'bankName', 'accountNumber'],
  defaultSort: { createdAt: 'asc' },
  transformCreate: async (body, _userId, projectId) => ({
    projectId,
    accountName: body.accountName as string,
    bankName: (body.bankName as string) ?? null,
    accountNumber: (body.accountNumber as string) ?? null,
    ifscCode: (body.ifscCode as string) ?? null,
    openingBalance: (body.openingBalance as number) ?? 0,
    // Set currentBalance = openingBalance on creation
    currentBalance: (body.openingBalance as number) ?? 0,
  }),
  transformUpdate: async (body) => {
    const data: Record<string, unknown> = {};
    for (const key of ['accountName', 'bankName', 'accountNumber', 'ifscCode', 'isActive']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    // currentBalance is NEVER user-edited
    return data;
  },
});

const router = Router();
router.use(authMiddleware);
router.use(crudRouter);

// ── Bank account statement (transaction history) ──
router.get(
  '/:id/statement',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listBankTransactionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 50, startDate, endDate, type } = req.query as Record<string, unknown>;

      // Verify account belongs to project
      const account = await prisma.bankAccount.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!account) {
        res.status(404).json({ error: 'Bank account not found' });
        return;
      }

      const where: Prisma.BankTransactionWhereInput = {
        bankAccountId: req.params.id,
        status: 'POSTED', // exclude REVERSED
      };
      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(String(startDate));
        if (endDate) where.date.lte = new Date(String(endDate));
      }
      if (type) where.type = String(type);

      const [data, total] = await Promise.all([
        prisma.bankTransaction.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.bankTransaction.count({ where }),
      ]);

      res.json({
        account: {
          id: account.id,
          accountName: account.accountName,
          bankName: account.bankName,
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

// ── Manual deposit (money into bank account) ──
router.post(
  '/:id/deposit',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankDepositSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, date, description } = req.body;

      const result = await postBankTransaction({
        bankAccountId: req.params.id,
        projectId,
        type: BankTxnType.DEPOSIT,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        referenceType: AccountTxnRefType.MANUAL_DEPOSIT,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BANK_TRANSACTION',
        entityId: result.transaction.id,
        projectId,
        newValue: { type: BankTxnType.DEPOSIT, amount, bankAccountId: req.params.id },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Manual withdrawal (money out of bank account) ──
router.post(
  '/:id/withdraw',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankWithdrawSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { amount, date, description } = req.body;

      const result = await postBankTransaction({
        bankAccountId: req.params.id,
        projectId,
        type: BankTxnType.WITHDRAWAL,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        description: description ?? null,
        referenceType: AccountTxnRefType.MANUAL_WITHDRAWAL,
        userId: req.user!.id,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BANK_TRANSACTION',
        entityId: result.transaction.id,
        projectId,
        newValue: { type: BankTxnType.WITHDRAWAL, amount, bankAccountId: req.params.id },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Transfer between two bank accounts (atomic two-sided) ──
router.post(
  '/transfer',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(bankTransferSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { fromAccountId, toAccountId, amount, date, description } = req.body;

      if (fromAccountId === toAccountId) {
        res.status(400).json({ error: 'Cannot transfer to the same account' });
        return;
      }

      const result = await transferBankToBank({
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
        entityType: 'BANK_TRANSACTION',
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

// ═══════════════════════════════════════════════════════════
// Shared posting helpers — used by this route and cash-accounts route
// ═══════════════════════════════════════════════════════════

interface PostBankTxnArgs {
  bankAccountId: string;
  projectId: string;
  type: string;
  amount: number;
  date: Date;
  description: string | null;
  referenceType: string;
  referenceId?: string;
  userId: string;
}

export async function postBankTransaction(args: PostBankTxnArgs) {
  return prisma.$transaction(async (tx) => {
    // Read the account only for validation (existence, active, insufficient
    // balance). The balance itself is updated atomically below via Prisma's
    // `increment`/`decrement` operators, which apply at the DB level and are
    // serialized by the row lock the UPDATE acquires. This prevents lost
    // updates under concurrent postings (read→calculate→write would let two
    // concurrent transactions overwrite each other's computed balance).
    const account = await tx.bankAccount.findFirst({
      where: { id: args.bankAccountId, projectId: args.projectId, deletedAt: null },
    });
    if (!account) throw new Error('Bank account not found');
    if (!account.isActive) throw new Error('Bank account is inactive');

    // IN types increase balance, OUT types decrease balance
    const isIn = [BankTxnType.DEPOSIT, BankTxnType.TRANSFER_IN, BankTxnType.REVERSAL_IN].includes(
      args.type as BankTxnType,
    );
    const isOut = [BankTxnType.WITHDRAWAL, BankTxnType.TRANSFER_OUT, BankTxnType.REVERSAL_OUT].includes(
      args.type as BankTxnType,
    );

    if (!isIn && !isOut) throw new Error(`Invalid bank transaction type: ${args.type}`);
    if (isOut && Number(account.currentBalance) < args.amount) {
      throw new Error('Insufficient balance in bank account');
    }

    // Atomic balance update — the DB applies the delta, not a JS-computed value.
    const updated = await tx.bankAccount.update({
      where: { id: args.bankAccountId },
      data: { currentBalance: isIn ? { increment: args.amount } : { decrement: args.amount } },
      select: { currentBalance: true },
    });
    const newBalance = Number(updated.currentBalance);

    const transaction = await tx.bankTransaction.create({
      data: {
        bankAccountId: args.bankAccountId,
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

interface TransferBankArgs {
  fromAccountId: string;
  toAccountId: string;
  projectId: string;
  amount: number;
  date: Date;
  description: string | null;
  userId: string;
}

export async function transferBankToBank(args: TransferBankArgs) {
  return prisma.$transaction(async (tx) => {
    const [fromAccount, toAccount] = await Promise.all([
      tx.bankAccount.findFirst({
        where: { id: args.fromAccountId, projectId: args.projectId, deletedAt: null },
      }),
      tx.bankAccount.findFirst({
        where: { id: args.toAccountId, projectId: args.projectId, deletedAt: null },
      }),
    ]);
    if (!fromAccount) throw new Error('Source bank account not found');
    if (!toAccount) throw new Error('Destination bank account not found');
    if (!fromAccount.isActive || !toAccount.isActive) throw new Error('One or both accounts are inactive');
    if (Number(fromAccount.currentBalance) < args.amount) {
      throw new Error('Insufficient balance in source account');
    }

    // Generate a shared pair ID for linking
    const transferPairId = crypto.randomUUID();

    // Atomic two-sided balance update — DB applies both deltas, preventing
    // lost updates if another posting touches either account concurrently.
    const [updatedFrom, updatedTo] = await Promise.all([
      tx.bankAccount.update({
        where: { id: args.fromAccountId },
        data: { currentBalance: { decrement: args.amount } },
        select: { currentBalance: true },
      }),
      tx.bankAccount.update({
        where: { id: args.toAccountId },
        data: { currentBalance: { increment: args.amount } },
        select: { currentBalance: true },
      }),
    ]);

    const [fromTxn, toTxn] = await Promise.all([
      tx.bankTransaction.create({
        data: {
          bankAccountId: args.fromAccountId,
          type: BankTxnType.TRANSFER_OUT,
          amount: args.amount,
          balanceAfter: Number(updatedFrom.currentBalance),
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
          bankAccountId: args.toAccountId,
          type: BankTxnType.TRANSFER_IN,
          amount: args.amount,
          balanceAfter: Number(updatedTo.currentBalance),
          date: args.date,
          description: args.description,
          referenceType: AccountTxnRefType.TRANSFER,
          transferPairId,
          status: 'POSTED',
          createdBy: args.userId,
        },
      }),
    ]);

    return { fromTxn, toTxn, transferPairId };
  });
}

export default router;
