import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, VoucherType } from '@hospital-erp/shared';
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
import { ensureOwnerLedger, ensureBankLedger } from './ledger.routes';
import { postVoucher, generateVoucherNumber } from './voucher.routes';

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
  afterCreate: async (record, _userId, projectId) => {
    // Auto-create a Capital Account ledger for this owner. Fire-and-forget.
    await ensureOwnerLedger(record.id as string, projectId).catch((err) =>
      console.error(`[OwnerAccount] auto-ledger creation failed for ${record.id}:`, err),
    );
  },
  afterUpdate: async (record, _userId, _projectId) => {
    if (record.ownerName) {
      await prisma.ledger.updateMany({
        where: { linkedEntityType: 'OWNER_ACCOUNT', linkedEntityId: record.id as string, deletedAt: null },
        data: { name: record.ownerName as string },
      }).catch((err) => console.error(`[OwnerAccount] ledger name sync failed for ${record.id}:`, err));
    }
  },
});

const router = Router();
router.use(authMiddleware);
router.use(crudRouter);

// ── Owner contribution: money into company bank → owner balance increases ──
// Creates a RECEIPT voucher (Dr Bank, Cr Capital Account) via postVoucher,
// which also updates the bank balance and creates a bank transaction.
router.post(
  '/:id/contribution',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(ownerContributionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { bankAccountId, amount, date, description } = req.body;
      const amt = Number(amount);
      const contributionDate = date ? new Date(date) : new Date();

      // Verify owner account belongs to project
      const ownerAccount = await prisma.ownerAccount.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!ownerAccount) throw new Error('Owner account not found');

      // Verify bank account belongs to project
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, projectId, deletedAt: null },
      });
      if (!bankAccount) throw new Error('Bank account not found');
      if (!bankAccount.isActive) throw new Error('Bank account is inactive');

      // Ensure ledgers exist
      const bankLedgerId = await ensureBankLedger(bankAccountId as string, projectId);
      const ownerLedgerId = await ensureOwnerLedger(req.params.id, projectId);

      // Fetch ledgers for the ledgerMap
      const [bankLedger, ownerLedger] = await Promise.all([
        prisma.ledger.findUnique({ where: { id: bankLedgerId } }),
        prisma.ledger.findUnique({ where: { id: ownerLedgerId } }),
      ]);
      if (!bankLedger || !ownerLedger) throw new Error('Failed to load ledgers');

      const ledgerMap = new Map([
        [bankLedger.id, { id: bankLedger.id, name: bankLedger.name, group: bankLedger.group, linkedEntityType: bankLedger.linkedEntityType, linkedEntityId: bankLedger.linkedEntityId }],
        [ownerLedger.id, { id: ownerLedger.id, name: ownerLedger.name, group: ownerLedger.group, linkedEntityType: ownerLedger.linkedEntityType, linkedEntityId: ownerLedger.linkedEntityId }],
      ]);

      const jvNumber = await generateVoucherNumber(VoucherType.RECEIPT);

      // RECEIPT: Dr Bank (money in), Cr Capital Account (owner's equity increases)
      const voucherResult = await postVoucher({
        projectId,
        jvNumber,
        voucherType: VoucherType.RECEIPT,
        voucherDate: contributionDate,
        description: (description as string) ?? `Owner contribution by ${ownerAccount.ownerName}`,
        totalDebit: amt,
        totalCredit: amt,
        entries: [
          { ledgerId: bankLedgerId, debit: amt, credit: 0 },
          { ledgerId: ownerLedgerId, debit: 0, credit: amt },
        ],
        ledgerMap,
        budgetHeadMap: new Map(),
        sourceInvoiceId: null,
        billSettlements: [],
        userId: req.user!.id,
      });

      // Update owner's currentBalance (company owes owner more)
      const updatedOwner = await prisma.ownerAccount.update({
        where: { id: req.params.id },
        data: { currentBalance: { increment: amt } },
        select: { currentBalance: true },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'OWNER_ACCOUNT',
        entityId: req.params.id,
        projectId,
        newValue: { type: 'CONTRIBUTION', amount, bankAccountId, jvNumber, voucherId: voucherResult.voucherId },
      });

      res.status(201).json({
        jvNumber,
        voucherId: voucherResult.voucherId,
        newOwnerBalance: Number(updatedOwner.currentBalance),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Owner withdrawal: money out of company bank → owner balance decreases ──
// Creates a PAYMENT voucher (Dr Capital Account, Cr Bank) via postVoucher.
router.post(
  '/:id/withdrawal',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(ownerContributionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { bankAccountId, amount, date, description } = req.body;
      const amt = Number(amount);
      const withdrawalDate = date ? new Date(date) : new Date();

      const ownerAccount = await prisma.ownerAccount.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!ownerAccount) throw new Error('Owner account not found');

      const bankAccount = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, projectId, deletedAt: null },
      });
      if (!bankAccount) throw new Error('Bank account not found');
      if (!bankAccount.isActive) throw new Error('Bank account is inactive');
      if (Number(bankAccount.currentBalance) < amt) {
        throw new Error('Insufficient balance in bank account');
      }
      if (Number(ownerAccount.currentBalance) < amt) {
        throw new Error('Insufficient owner balance for withdrawal');
      }

      const bankLedgerId = await ensureBankLedger(bankAccountId as string, projectId);
      const ownerLedgerId = await ensureOwnerLedger(req.params.id, projectId);

      const [bankLedger, ownerLedger] = await Promise.all([
        prisma.ledger.findUnique({ where: { id: bankLedgerId } }),
        prisma.ledger.findUnique({ where: { id: ownerLedgerId } }),
      ]);
      if (!bankLedger || !ownerLedger) throw new Error('Failed to load ledgers');

      const ledgerMap = new Map([
        [bankLedger.id, { id: bankLedger.id, name: bankLedger.name, group: bankLedger.group, linkedEntityType: bankLedger.linkedEntityType, linkedEntityId: bankLedger.linkedEntityId }],
        [ownerLedger.id, { id: ownerLedger.id, name: ownerLedger.name, group: ownerLedger.group, linkedEntityType: ownerLedger.linkedEntityType, linkedEntityId: ownerLedger.linkedEntityId }],
      ]);

      const jvNumber = await generateVoucherNumber(VoucherType.PAYMENT);

      // PAYMENT: Dr Capital Account (owner's equity decreases), Cr Bank (money out)
      const voucherResult = await postVoucher({
        projectId,
        jvNumber,
        voucherType: VoucherType.PAYMENT,
        voucherDate: withdrawalDate,
        description: (description as string) ?? `Owner withdrawal by ${ownerAccount.ownerName}`,
        totalDebit: amt,
        totalCredit: amt,
        entries: [
          { ledgerId: ownerLedgerId, debit: amt, credit: 0 },
          { ledgerId: bankLedgerId, debit: 0, credit: amt },
        ],
        ledgerMap,
        budgetHeadMap: new Map(),
        sourceInvoiceId: null,
        billSettlements: [],
        userId: req.user!.id,
      });

      // Update owner's currentBalance (company owes owner less)
      const updatedOwner = await prisma.ownerAccount.update({
        where: { id: req.params.id },
        data: { currentBalance: { decrement: amt } },
        select: { currentBalance: true },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'OWNER_ACCOUNT',
        entityId: req.params.id,
        projectId,
        newValue: { type: 'WITHDRAWAL', amount, bankAccountId, jvNumber, voucherId: voucherResult.voucherId },
      });

      res.status(201).json({
        jvNumber,
        voucherId: voucherResult.voucherId,
        newOwnerBalance: Number(updatedOwner.currentBalance),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Owner account statement: list all ledger entries affecting this owner ──
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

      // Find the ledger linked to this owner account
      const ownerLedger = await prisma.ledger.findFirst({
        where: { linkedEntityType: 'OWNER_ACCOUNT', linkedEntityId: req.params.id, deletedAt: null },
      });
      if (!ownerLedger) {
        res.json({
          account: {
            id: ownerAccount.id,
            ownerName: ownerAccount.ownerName,
            openingBalance: Number(ownerAccount.openingBalance),
            currentBalance: Number(ownerAccount.currentBalance),
          },
          statement: [],
        });
        return;
      }

      // Get all ledger entries for this owner's ledger (only from POSTED JVs),
      // ordered oldest-first so the running balance accumulates correctly.
      const entries = await prisma.ledgerEntry.findMany({
        where: {
          ledgerId: ownerLedger.id,
          journalVoucher: { status: 'POSTED', deletedAt: null },
        },
        include: {
          journalVoucher: {
            select: { id: true, jvNumber: true, date: true, voucherType: true, description: true },
          },
        },
        orderBy: { journalVoucher: { date: 'asc' } },
      });

      // Build running balance statement forward (oldest → newest) so each
      // balanceAfter reflects the cumulative balance at that point in time.
      // For a Capital Account (credit-nature), credit increases balance, debit decreases.
      let runningBalance = Number(ownerAccount.openingBalance);
      const statement = entries.map((entry) => {
        const debit = Number(entry.debit);
        const credit = Number(entry.credit);
        runningBalance += credit - debit;

        return {
          id: entry.id,
          jvNumber: entry.journalVoucher.jvNumber,
          jvId: entry.journalVoucher.id,
          date: entry.journalVoucher.date,
          type: entry.journalVoucher.voucherType,
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
