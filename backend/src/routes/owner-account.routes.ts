import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, BankTxnType, AccountTxnRefType } from '@hospital-erp/shared';
import {
  createOwnerAccountSchema,
  updateOwnerAccountSchema,
  listOwnerAccountsSchema,
  ownerContributionSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

// ── Base CRUD via factory ──
const crudRouter = createCrudRouter({
  entityType: 'OWNER_ACCOUNT',
  model: 'ownerAccount',
  createPermission: Permission.MANAGE_FINANCE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createOwnerAccountSchema,
  updateSchema: updateOwnerAccountSchema,
  listSchema: listOwnerAccountsSchema,
  searchFields: ['ownerName'],
  defaultSort: { createdAt: 'asc' },
  transformCreate: async (body, _userId, projectId) => ({
    projectId,
    ownerName: body.ownerName as string,
    openingBalance: (body.openingBalance as number) ?? 0,
    currentBalance: (body.openingBalance as number) ?? 0,
  }),
  transformUpdate: async (body) => {
    const data: Record<string, unknown> = {};
    for (const key of ['ownerName', 'isActive']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    return data;
  },
});

const router = Router();
router.use(authMiddleware);
router.use(crudRouter);

// ── Owner contribution: money into company bank → owner balance increases ──
// This creates a bank deposit AND increases owner's currentBalance atomically.
router.post(
  '/:id/contribution',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(ownerContributionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { bankAccountId, amount, date, description } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        // Verify owner account belongs to project
        const ownerAccount = await tx.ownerAccount.findFirst({
          where: { id: req.params.id, projectId, deletedAt: null },
        });
        if (!ownerAccount) throw new Error('Owner account not found');

        // Verify bank account belongs to project
        const bankAccount = await tx.bankAccount.findFirst({
          where: { id: bankAccountId, projectId, deletedAt: null },
        });
        if (!bankAccount) throw new Error('Bank account not found');
        if (!bankAccount.isActive) throw new Error('Bank account is inactive');

        // 1. Create bank deposit transaction
        const bankBalance = Number(bankAccount.currentBalance) + Number(amount);
        const bankTxn = await tx.bankTransaction.create({
          data: {
            bankAccountId: bankAccountId as string,
            type: BankTxnType.DEPOSIT,
            amount: Number(amount),
            balanceAfter: bankBalance,
            date: date ? new Date(date) : new Date(),
            description: (description as string) ?? `Owner contribution by ${ownerAccount.ownerName}`,
            referenceType: AccountTxnRefType.MANUAL_DEPOSIT,
            referenceId: ownerAccount.id,
            status: 'POSTED',
            createdBy: req.user!.id,
          },
        });
        await tx.bankAccount.update({
          where: { id: bankAccountId as string },
          data: { currentBalance: bankBalance },
        });

        // 2. Increase owner balance (company owes owner more)
        const newOwnerBalance = Number(ownerAccount.currentBalance) + Number(amount);
        await tx.ownerAccount.update({
          where: { id: req.params.id },
          data: { currentBalance: newOwnerBalance },
        });

        return { bankTxn, newOwnerBalance };
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'OWNER_ACCOUNT',
        entityId: req.params.id,
        projectId,
        newValue: { type: 'CONTRIBUTION', amount, bankAccountId, bankTxnId: result.bankTxn.id },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  },
);

// ── Owner account statement: list all JV entries affecting this owner ──
router.get(
  '/:id/statement',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const ownerAccount = await prisma.ownerAccount.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!ownerAccount) {
        res.status(404).json({ error: 'Owner account not found' });
        return;
      }

      // Get all journal entries for this owner account (only from POSTED JVs),
      // ordered oldest-first so the running balance accumulates correctly.
      const entries = await prisma.journalEntry.findMany({
        where: {
          ownerAccountId: req.params.id,
          journalVoucher: { status: 'POSTED', deletedAt: null },
        },
        include: {
          journalVoucher: {
            select: { id: true, jvNumber: true, date: true, type: true, description: true },
          },
        },
        orderBy: { journalVoucher: { date: 'asc' } },
      });

      // Build running balance statement forward (oldest → newest) so each
      // balanceAfter reflects the cumulative balance at that point in time.
      let runningBalance = Number(ownerAccount.openingBalance);
      const statement = entries.map((entry) => {
        // Credit to owner = company owes owner more (balance increases)
        // Debit to owner = company owes owner less (balance decreases)
        const debit = Number(entry.debit);
        const credit = Number(entry.credit);
        runningBalance += credit - debit;

        return {
          id: entry.id,
          jvNumber: entry.journalVoucher.jvNumber,
          jvId: entry.journalVoucher.id,
          date: entry.journalVoucher.date,
          type: entry.journalVoucher.type,
          description: entry.journalVoucher.description ?? entry.description ?? '—',
          debit,
          credit,
          balanceAfter: runningBalance,
        };
      });

      res.json({
        account: {
          id: ownerAccount.id,
          ownerName: ownerAccount.ownerName,
          openingBalance: Number(ownerAccount.openingBalance),
          currentBalance: Number(ownerAccount.currentBalance),
        },
        statement: statement.reverse(), // most recent first for display
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
