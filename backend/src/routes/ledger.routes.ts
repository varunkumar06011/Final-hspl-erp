import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  AuditAction,
  LedgerGroup,
  LedgerLinkType,
  GST_LEDGER_NAMES,
  DEFAULT_EXPENSE_LEDGERS,
  DEFAULT_INCOME_LEDGERS,
  DEFAULT_CASH_LEDGER_NAME,
  isDebitNatureGroup,
} from '@hospital-erp/shared';
import {
  createLedgerSchema,
  updateLedgerSchema,
  listLedgersSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

// ── List ledgers (with group filter, search, pagination) ──
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listLedgersSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 100, search, group, linkedEntityType, isActive } = req.query as Record<string, unknown>;
      const requestedGroup = group ? String(group) : null;
      const childGroupNames = requestedGroup
        ? (await prisma.ledgerCustomGroup.findMany({
            where: { projectId, parentGroup: requestedGroup },
            select: { name: true },
          })).map((customGroup) => customGroup.name)
        : [];
      const selectedGroupNames = requestedGroup ? [requestedGroup, ...childGroupNames] : [];

      const where: Prisma.LedgerWhereInput = {
        projectId,
        deletedAt: null,
        ...(requestedGroup ? { group: { in: selectedGroupNames } } : {}),
        ...(linkedEntityType ? { linkedEntityType: String(linkedEntityType) } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' || isActive === true } : {}),
        ...(search ? { name: { contains: String(search), mode: 'insensitive' } } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.ledger.findMany({
          where,
          orderBy: [{ group: 'asc' }, { name: 'asc' }],
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.ledger.count({ where }),
      ]);

      res.json({
        data: data.map((l) => ({
          ...l,
          openingBalance: Number(l.openingBalance),
          currentBalance: Number(l.currentBalance),
        })),
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

// ── Custom ledger groups (Tally-style sub-groups under primary groups) ──

// GET /ledgers/groups — list all custom groups for the project
router.get(
  '/groups',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const groups = await prisma.ledgerCustomGroup.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
      });
      res.json({ data: groups });
    } catch (error) {
      next(error);
    }
  },
);

// ── Get single ledger ──
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const ledger = await prisma.ledger.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!ledger) {
        res.status(404).json({ error: 'Ledger not found' });
        return;
      }
      res.json({
        ...ledger,
        openingBalance: Number(ledger.openingBalance),
        currentBalance: Number(ledger.currentBalance),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Create ledger ──
router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(createLedgerSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { name, group, openingBalance, isActive } = req.body;

      // Compute initial currentBalance from opening balance based on group nature.
      // Debit-nature groups: positive opening = debit balance (positive stored).
      // Credit-nature groups: positive opening = credit balance (stored as negative).
      const signedOpening = isDebitNatureGroup(group as LedgerGroup)
        ? Number(openingBalance)
        : -Number(openingBalance);

      const ledger = await prisma.ledger.create({
        data: {
          projectId,
          name: String(name),
          group: String(group),
          linkedEntityType: LedgerLinkType.NONE,
          openingBalance: Number(openingBalance),
          currentBalance: signedOpening,
          isActive: isActive !== false,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'LEDGER',
        entityId: ledger.id,
        projectId,
        newValue: { name, group, openingBalance },
      });

      res.status(201).json({
        ...ledger,
        openingBalance: Number(ledger.openingBalance),
        currentBalance: Number(ledger.currentBalance),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A ledger with this name already exists in this project' });
        return;
      }
      next(error);
    }
  },
);

// ── Quick-create ledger from within a voucher (Tally-style Alt+C) ──
// Minimal payload: name + group. Returns the created ledger in list format.
router.post(
  '/quick-create',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(createLedgerSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { name, group, openingBalance } = req.body;

      // Resolve custom group to parent for debit/credit nature determination
      let effectiveGroup = group;
      if (!Object.values(LedgerGroup).includes(group as LedgerGroup)) {
        const customGroup = await prisma.ledgerCustomGroup.findFirst({
          where: { projectId, name: String(group) },
        });
        if (customGroup) {
          effectiveGroup = customGroup.parentGroup;
        }
      }

      const signedOpening = isDebitNatureGroup(effectiveGroup as LedgerGroup)
        ? Number(openingBalance)
        : -Number(openingBalance);

      const ledger = await prisma.ledger.create({
        data: {
          projectId,
          name: String(name),
          group: String(group),
          linkedEntityType: LedgerLinkType.NONE,
          openingBalance: Number(openingBalance),
          currentBalance: signedOpening,
          isActive: true,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'LEDGER',
        entityId: ledger.id,
        projectId,
        newValue: { name, group, openingBalance, quickCreate: true },
      });

      res.status(201).json({
        id: ledger.id,
        name: ledger.name,
        group: ledger.group,
        openingBalance: Number(ledger.openingBalance),
        currentBalance: Number(ledger.currentBalance),
        isActive: ledger.isActive,
        linkedEntityType: ledger.linkedEntityType,
        linkedEntityId: ledger.linkedEntityId,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A ledger with this name already exists in this project' });
        return;
      }
      next(error);
    }
  },
);

// ── Update ledger (name, group, isActive only — never balance) ──
router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(updateLedgerSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.ledger.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Ledger not found' });
        return;
      }
      if (existing.isSystem) {
        res.status(400).json({ error: 'System ledgers cannot be edited' });
        return;
      }

      const data: Record<string, unknown> = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.group !== undefined) data.group = req.body.group;
      if (req.body.isActive !== undefined) data.isActive = req.body.isActive;

      const updated = await prisma.ledger.update({
        where: { id: req.params.id },
        data,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'LEDGER',
        entityId: req.params.id,
        projectId,
        oldValue: { name: existing.name, group: existing.group },
        newValue: data,
      });

      res.json({
        ...updated,
        openingBalance: Number(updated.openingBalance),
        currentBalance: Number(updated.currentBalance),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Delete ledger (soft delete — only if no entries) ──
router.delete(
  '/:id',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const ledger = await prisma.ledger.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { _count: { select: { ledgerEntries: true } } },
      });
      if (!ledger) {
        res.status(404).json({ error: 'Ledger not found' });
        return;
      }
      if (ledger.isSystem) {
        res.status(400).json({ error: 'System ledgers cannot be deleted' });
        return;
      }
      if (ledger._count.ledgerEntries > 0) {
        res.status(400).json({ error: 'Cannot delete a ledger that has transactions. Deactivate it instead.' });
        return;
      }

      await prisma.ledger.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'LEDGER',
        entityId: req.params.id,
        projectId,
        oldValue: { name: ledger.name },
      });

      res.json({ message: 'Ledger deleted' });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Auto-sync: create ledgers for existing vendors, bank accounts,
// cash accounts, and owner accounts. Also seeds GST + default
// expense ledgers. Idempotent — safe to call multiple times.
// ═══════════════════════════════════════════════════════════
router.post(
  '/sync',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const results = await syncProjectLedgers(projectId, req.user!.id);
      res.json(results);
    } catch (error) {
      next(error);
    }
  },
);

// ── Get sync status (what's missing) without creating ──
router.get(
  '/sync/status',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const status = await getSyncStatus(projectId);
      res.json(status);
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// Sync helpers — exported for use by other modules
// ═══════════════════════════════════════════════════════════

/**
 * Ensure a ledger exists for a given vendor. Creates if missing.
 * Returns the ledger. Used by the purchase-posting flow.
 */
export async function ensureVendorLedger(vendorId: string, projectId: string): Promise<string> {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, projectId, deletedAt: null },
  });
  if (!vendor) throw new Error('Vendor not found');

  const existing = await prisma.ledger.findFirst({
    where: { linkedEntityType: LedgerLinkType.VENDOR, linkedEntityId: vendorId, projectId, deletedAt: null },
  });
  if (existing) return existing.id;

  const ledger = await prisma.ledger.create({
    data: {
      projectId,
      name: vendor.name,
      group: LedgerGroup.SUNDRY_CREDITORS,
      linkedEntityType: LedgerLinkType.VENDOR,
      linkedEntityId: vendorId,
      openingBalance: 0,
      currentBalance: 0,
      isActive: true,
    },
  });
  return ledger.id;
}

/**
 * Build a display name for a bank ledger, handling null accountNumber gracefully.
 * Format: "BANK_NAME - A/c 12345" or "BANK_NAME - ACCOUNT_NAME" (when no account number).
 */
function bankLedgerName(account: { bankName: string | null; accountNumber: string | null; accountName: string }): string {
  const bank = account.bankName ?? account.accountName;
  if (account.accountNumber) {
    return `${bank} - A/c ${account.accountNumber}`;
  }
  return `${bank} - ${account.accountName}`;
}

/**
 * Ensure a ledger exists for a bank account. Creates if missing.
 */
export async function ensureBankLedger(bankAccountId: string, projectId: string): Promise<string> {
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, projectId, deletedAt: null },
  });
  if (!account) throw new Error('Bank account not found');

  const existing = await prisma.ledger.findFirst({
    where: { linkedEntityType: LedgerLinkType.BANK_ACCOUNT, linkedEntityId: bankAccountId, projectId, deletedAt: null },
  });
  if (existing) {
    // Fix legacy ledger names that contain "A/c null" (from before the null-safe fix)
    const correctName = bankLedgerName(account);
    if (existing.name !== correctName) {
      await prisma.ledger.update({ where: { id: existing.id }, data: { name: correctName } });
    }
    return existing.id;
  }

  const ledger = await prisma.ledger.create({
    data: {
      projectId,
      name: bankLedgerName(account),
      group: LedgerGroup.BANK,
      linkedEntityType: LedgerLinkType.BANK_ACCOUNT,
      linkedEntityId: bankAccountId,
      openingBalance: Number(account.openingBalance),
      currentBalance: Number(account.currentBalance),
      isActive: account.isActive,
    },
  });
  return ledger.id;
}

/**
 * Ensure a ledger exists for a cash account. Creates if missing.
 */
export async function ensureCashLedger(cashAccountId: string, projectId: string): Promise<string> {
  const account = await prisma.cashAccount.findFirst({
    where: { id: cashAccountId, projectId, deletedAt: null },
  });
  if (!account) throw new Error('Cash account not found');

  const existing = await prisma.ledger.findFirst({
    where: { linkedEntityType: LedgerLinkType.CASH_ACCOUNT, linkedEntityId: cashAccountId, projectId, deletedAt: null },
  });
  if (existing) return existing.id;

  const ledger = await prisma.ledger.create({
    data: {
      projectId,
      name: account.name,
      group: LedgerGroup.CASH,
      linkedEntityType: LedgerLinkType.CASH_ACCOUNT,
      linkedEntityId: cashAccountId,
      openingBalance: Number(account.openingBalance),
      currentBalance: Number(account.currentBalance),
      isActive: account.isActive,
    },
  });
  return ledger.id;
}

/**
 * Ensure a ledger exists for an owner account. Creates if missing.
 */
export async function ensureOwnerLedger(ownerAccountId: string, projectId: string): Promise<string> {
  const account = await prisma.ownerAccount.findFirst({
    where: { id: ownerAccountId, projectId, deletedAt: null },
  });
  if (!account) throw new Error('Owner account not found');

  const existing = await prisma.ledger.findFirst({
    where: { linkedEntityType: LedgerLinkType.OWNER_ACCOUNT, linkedEntityId: ownerAccountId, projectId, deletedAt: null },
  });
  if (existing) return existing.id;

  // Owner = capital account (credit nature). Positive balance = company owes owner = credit balance.
  const ledger = await prisma.ledger.create({
    data: {
      projectId,
      name: account.ownerName,
      group: LedgerGroup.CAPITAL_ACCOUNT,
      linkedEntityType: LedgerLinkType.OWNER_ACCOUNT,
      linkedEntityId: ownerAccountId,
      openingBalance: Number(account.openingBalance),
      currentBalance: -Number(account.currentBalance), // credit nature → negative stored
      isActive: true,
    },
  });
  return ledger.id;
}

/**
 * Find a ledger by name within a project. Used by the purchase-posting flow
 * to locate GST ledgers (Input CGST etc.) and the Purchase ledger.
 */
export async function findLedgerByName(name: string, projectId: string): Promise<string | null> {
  const ledger = await prisma.ledger.findFirst({
    where: { name, projectId, deletedAt: null },
    select: { id: true },
  });
  return ledger?.id ?? null;
}

/**
 * Full sync: create ledgers for all existing vendors, banks, cash, owners,
 * plus seed GST and default expense ledgers. Idempotent.
 */
async function syncProjectLedgers(projectId: string, userId: string) {
  const created: string[] = [];
  const skipped: string[] = [];

  // 1. Vendors → Sundry Creditors
  const vendors = await prisma.vendor.findMany({ where: { projectId, deletedAt: null } });
  for (const v of vendors) {
    const id = await ensureVendorLedger(v.id, projectId);
    (created.includes(id) || skipped.push(id)) && void 0;
  }

  // 2. Bank accounts → Bank
  const banks = await prisma.bankAccount.findMany({ where: { projectId, deletedAt: null } });
  for (const b of banks) {
    await ensureBankLedger(b.id, projectId);
  }

  // 3. Cash accounts → Cash
  const cashAccounts = await prisma.cashAccount.findMany({ where: { projectId, deletedAt: null } });
  for (const c of cashAccounts) {
    await ensureCashLedger(c.id, projectId);
  }

  // 4. Owner accounts → Capital Account
  const owners = await prisma.ownerAccount.findMany({ where: { projectId, deletedAt: null } });
  for (const o of owners) {
    await ensureOwnerLedger(o.id, projectId);
  }

  // 5. Seed GST ledgers (Duties & Taxes — credit nature)
  const gstLedgers = [
    { name: GST_LEDGER_NAMES.INPUT_CGST, group: LedgerGroup.DUTIES_TAXES },
    { name: GST_LEDGER_NAMES.INPUT_SGST, group: LedgerGroup.DUTIES_TAXES },
    { name: GST_LEDGER_NAMES.INPUT_IGST, group: LedgerGroup.DUTIES_TAXES },
    { name: GST_LEDGER_NAMES.OUTPUT_CGST, group: LedgerGroup.DUTIES_TAXES },
    { name: GST_LEDGER_NAMES.OUTPUT_SGST, group: LedgerGroup.DUTIES_TAXES },
    { name: GST_LEDGER_NAMES.OUTPUT_IGST, group: LedgerGroup.DUTIES_TAXES },
  ];
  for (const g of gstLedgers) {
    const existing = await prisma.ledger.findFirst({
      where: { name: g.name, projectId, deletedAt: null },
    });
    if (!existing) {
      await prisma.ledger.create({
        data: {
          projectId,
          name: g.name,
          group: g.group,
          linkedEntityType: LedgerLinkType.NONE,
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isSystem: true,
        },
      });
      created.push(g.name);
    } else {
      skipped.push(g.name);
    }
  }

  // 6. Seed default expense ledgers
  for (const e of DEFAULT_EXPENSE_LEDGERS) {
    const existing = await prisma.ledger.findFirst({
      where: { name: e.name, projectId, deletedAt: null },
    });
    if (!existing) {
      await prisma.ledger.create({
        data: {
          projectId,
          name: e.name,
          group: e.group as LedgerGroup,
          linkedEntityType: LedgerLinkType.NONE,
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isSystem: false,
        },
      });
      created.push(e.name);
    } else {
      skipped.push(e.name);
    }
  }

  // 7. Seed a default "Purchase" ledger (for PURCHASE vouchers)
  const purchaseLedger = await prisma.ledger.findFirst({
    where: { name: 'Purchase', projectId, deletedAt: null },
  });
  if (!purchaseLedger) {
    await prisma.ledger.create({
      data: {
        projectId,
        name: 'Purchase',
        group: LedgerGroup.PURCHASE,
        linkedEntityType: LedgerLinkType.NONE,
        openingBalance: 0,
        currentBalance: 0,
        isActive: true,
        isSystem: false,
      },
    });
    created.push('Purchase');
  } else {
    skipped.push('Purchase');
  }

  // 8. Seed default income/sales ledgers
  for (const inc of DEFAULT_INCOME_LEDGERS) {
    const existing = await prisma.ledger.findFirst({
      where: { name: inc.name, projectId, deletedAt: null },
    });
    if (!existing) {
      await prisma.ledger.create({
        data: {
          projectId,
          name: inc.name,
          group: inc.group as LedgerGroup,
          linkedEntityType: LedgerLinkType.NONE,
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
          isSystem: false,
        },
      });
      created.push(inc.name);
    } else {
      skipped.push(inc.name);
    }
  }

  // 9. Seed a default "Cash in Hand" ledger if no cash ledger exists
  const cashLedger = await prisma.ledger.findFirst({
    where: { group: LedgerGroup.CASH, projectId, deletedAt: null },
  });
  if (!cashLedger) {
    await prisma.ledger.create({
      data: {
        projectId,
        name: DEFAULT_CASH_LEDGER_NAME,
        group: LedgerGroup.CASH,
        linkedEntityType: LedgerLinkType.NONE,
        openingBalance: 0,
        currentBalance: 0,
        isActive: true,
        isSystem: true,
      },
    });
    created.push(DEFAULT_CASH_LEDGER_NAME);
  } else {
    skipped.push(DEFAULT_CASH_LEDGER_NAME);
  }

  await logAudit({
    userId,
    action: AuditAction.UPDATE,
    entityType: 'LEDGER',
    entityId: projectId,
    projectId,
    newValue: { action: 'sync', created: created.length, skipped: skipped.length },
  });

  return {
    message: 'Ledger sync complete',
    createdCount: created.length,
    skippedCount: skipped.length,
    created,
    skipped,
  };
}

/**
 * Check what ledgers are missing without creating them.
 */
async function getSyncStatus(projectId: string) {
  const [vendors, banks, cashAccounts, owners, ledgers] = await Promise.all([
    prisma.vendor.findMany({ where: { projectId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.bankAccount.findMany({ where: { projectId, deletedAt: null }, select: { id: true, accountName: true } }),
    prisma.cashAccount.findMany({ where: { projectId, deletedAt: null }, select: { id: true, name: true } }),
    prisma.ownerAccount.findMany({ where: { projectId, deletedAt: null }, select: { id: true, ownerName: true } }),
    prisma.ledger.findMany({ where: { projectId, deletedAt: null }, select: { linkedEntityType: true, linkedEntityId: true, name: true } }),
  ]);

  const linkedIds = new Set(
    ledgers
      .filter((l) => l.linkedEntityId)
      .map((l) => l.linkedEntityId as string),
  );
  const ledgerNames = new Set(ledgers.map((l) => l.name));

  const missingVendors = vendors.filter((v) => !linkedIds.has(v.id)).map((v) => v.name);
  const missingBanks = banks.filter((b) => !linkedIds.has(b.id)).map((b) => b.accountName);
  const missingCash = cashAccounts.filter((c) => !linkedIds.has(c.id)).map((c) => c.name);
  const missingOwners = owners.filter((o) => !linkedIds.has(o.id)).map((o) => o.ownerName);

  const requiredSystemNames = [
    GST_LEDGER_NAMES.INPUT_CGST,
    GST_LEDGER_NAMES.INPUT_SGST,
    GST_LEDGER_NAMES.INPUT_IGST,
    GST_LEDGER_NAMES.OUTPUT_CGST,
    GST_LEDGER_NAMES.OUTPUT_SGST,
    GST_LEDGER_NAMES.OUTPUT_IGST,
    'Purchase',
    DEFAULT_CASH_LEDGER_NAME,
    ...DEFAULT_EXPENSE_LEDGERS.map((e) => e.name),
    ...DEFAULT_INCOME_LEDGERS.map((e) => e.name),
  ];
  const missingSystem = requiredSystemNames.filter((n) => !ledgerNames.has(n));

  const totalMissing = missingVendors.length + missingBanks.length + missingCash.length + missingOwners.length + missingSystem.length;

  return {
    isSynced: totalMissing === 0,
    totalMissing,
    missingVendors,
    missingBanks,
    missingCash,
    missingOwners,
    missingSystem,
    existingLedgerCount: ledgers.length,
  };
}

// POST /ledgers/groups — create a custom group
router.post(
  '/groups',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { name, parentGroup } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Group name is required' });
        return;
      }
      if (!parentGroup || !Object.values(LedgerGroup).includes(parentGroup as LedgerGroup)) {
        res.status(400).json({ error: 'Valid parent group is required' });
        return;
      }

      const group = await prisma.ledgerCustomGroup.create({
        data: {
          projectId,
          name: name.trim(),
          parentGroup: String(parentGroup),
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'LEDGER',
        entityId: group.id,
        projectId,
        newValue: { name: group.name, parentGroup: group.parentGroup, customGroup: true },
      });

      res.status(201).json(group);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A group with this name already exists' });
        return;
      }
      next(error);
    }
  },
);

// PATCH /ledgers/groups/:id — edit a custom group (name and/or parentGroup)
// If the group name changes, all ledgers using the old name are updated to the new name.
router.patch(
  '/groups/:id',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const group = await prisma.ledgerCustomGroup.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const { name, parentGroup } = req.body;
      const newName = typeof name === 'string' && name.trim() ? name.trim() : null;
      const newParent = parentGroup && Object.values(LedgerGroup).includes(parentGroup as LedgerGroup)
        ? String(parentGroup)
        : null;

      if (!newName && !newParent) {
        res.status(400).json({ error: 'Provide a new name or parent group to update' });
        return;
      }

      const data: { name?: string; parentGroup?: string } = {};
      if (newName && newName !== group.name) data.name = newName;
      if (newParent && newParent !== group.parentGroup) data.parentGroup = newParent;

      if (Object.keys(data).length === 0) {
        res.json(group);
        return;
      }

      // If renaming, update all ledgers that reference the old group name
      if (data.name) {
        await prisma.ledger.updateMany({
          where: { group: group.name, projectId, deletedAt: null },
          data: { group: data.name },
        });
      }

      const updated = await prisma.ledgerCustomGroup.update({
        where: { id: req.params.id },
        data,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'LEDGER',
        entityId: group.id,
        projectId,
        oldValue: { name: group.name, parentGroup: group.parentGroup },
        newValue: data,
      });

      res.json(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A group with this name already exists' });
        return;
      }
      next(error);
    }
  },
);

// DELETE /ledgers/groups/:id — delete a custom group (if no ledgers use it)
router.delete(
  '/groups/:id',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const group = await prisma.ledgerCustomGroup.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      // Check if any ledgers use this group name
      const ledgersUsingGroup = await prisma.ledger.count({
        where: { group: group.name, projectId, deletedAt: null },
      });
      if (ledgersUsingGroup > 0) {
        res.status(400).json({ error: `Cannot delete: ${ledgersUsingGroup} ledger(s) are using this group. Reclassify them first.` });
        return;
      }

      await prisma.ledgerCustomGroup.delete({ where: { id: req.params.id } });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'LEDGER',
        entityId: group.id,
        projectId,
        oldValue: { name: group.name, parentGroup: group.parentGroup },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
