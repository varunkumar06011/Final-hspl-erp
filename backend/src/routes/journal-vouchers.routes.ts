import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  AuditAction,
  JVType,
  JournalAccountType,
  BankTxnType,
  CashTxnType,
  AccountTxnRefType,
  ApprovalStepStatus,
  LedgerGroup,
  LedgerLinkType,
} from '@hospital-erp/shared';
import {
  createJournalVoucherSchema,
  listJournalVouchersSchema,
  jvApprovalActionSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import * as approvalService from '../services/approval.service';
import { notifyAllHeads } from '../services/push.service';
import { ensureBankLedger, ensureCashLedger, ensureOwnerLedger } from './ledger.routes';

const router = Router();
router.use(authMiddleware);

const jvInclude = {
  entries: {
    include: {
      budgetHead: { select: { id: true, particulars: true } },
      ownerAccount: { select: { id: true, ownerName: true } },
    },
  },
  createdByUser: { select: { id: true, name: true } },
  postedByUser: { select: { id: true, name: true } },
  approvalWorkflow: {
    include: {
      steps: {
        orderBy: { stepNumber: 'asc' as const },
        include: { approverUser: { select: { id: true, name: true, role: true } } },
      },
    },
  },
};

async function generateJvNumber(): Promise<string> {
  const jvs = await prisma.journalVoucher.findMany({
    where: { jvNumber: { startsWith: 'VGH-JV' } },
    select: { jvNumber: true },
  });
  const maxNum = jvs.reduce((max, jv) => {
    const match = jv.jvNumber?.match(/^VGH-JV(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  return `VGH-JV${String(maxNum + 1).padStart(3, '0')}`;
}

// ── List JVs ──
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listJournalVouchersSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page = 1, pageSize = 20, search, type, status } = req.query as Record<string, unknown>;

      const where: Prisma.JournalVoucherWhereInput = {
        projectId,
        deletedAt: null,
        ...(type ? { type: String(type) } : {}),
        ...(status ? { status: String(status) } : {}),
        ...(search ? { jvNumber: { contains: String(search), mode: 'insensitive' } } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.journalVoucher.findMany({
          where,
          include: jvInclude,
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

// ── Get single JV ──
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include: jvInclude,
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      res.json(jv);
    } catch (error) {
      next(error);
    }
  },
);

// ── Create JV (status = DRAFT) ──
router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(createJournalVoucherSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { type, date, description, entries } = req.body;

      const totalDebit = (entries as Array<{ debit: number }>).reduce((s, e) => s + Number(e.debit), 0);
      const totalCredit = (entries as Array<{ credit: number }>).reduce((s, e) => s + Number(e.credit), 0);

      const jvNumber = await generateJvNumber();

      const jv = await prisma.journalVoucher.create({
        data: {
          projectId,
          jvNumber,
          type,
          date: date ? new Date(date) : new Date(),
          description: description ?? null,
          status: 'DRAFT',
          totalDebit,
          totalCredit,
          createdBy: req.user!.id,
          entries: {
            create: (entries as Array<Record<string, unknown>>).map((entry) => ({
              accountType: String(entry.accountType),
              accountId: (entry.accountId as string) ?? null,
              budgetHeadId: (entry.budgetHeadId as string) ?? null,
              ownerAccountId: (entry.ownerAccountId as string) ?? null,
              debit: Number(entry.debit) || 0,
              credit: Number(entry.credit) || 0,
              description: (entry.description as string) ?? null,
            })),
          },
        },
        include: jvInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        newValue: { jvNumber, type, totalDebit, totalCredit },
      });

      res.status(201).json(jv);
    } catch (error) {
      next(error);
    }
  },
);

// ── Submit JV for approval (DRAFT → PENDING_APPROVAL) ──
router.post(
  '/:id/submit',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { entries: true },
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      if (jv.status !== 'DRAFT') {
        res.status(400).json({ error: `JV is already ${jv.status}` });
        return;
      }

      // Initiate approval workflow
      const workflow = await approvalService.initiate({
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        minApprovers: 2,
        approvalPolicy: 'HEAD_GROUPS',
      });

      await prisma.journalVoucher.update({
        where: { id: jv.id },
        data: { status: 'PENDING_APPROVAL', approvalWorkflowId: workflow.id },
      });

      // Notify all heads
      notifyAllHeads(projectId, {
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        title: 'Journal Voucher Approval Required',
        body: `JV ${jv.jvNumber} (${jv.type}) — ₹${jv.totalDebit} needs approval`,
        url: '/journal-vouchers',
      }).catch((err) => console.error('[Push] JV submit notification error:', err));

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        newValue: { status: 'PENDING_APPROVAL' },
      });

      res.json({ message: 'JV submitted for approval', jvNumber: jv.jvNumber });
    } catch (error) {
      next(error);
    }
  },
);

// ── Approve JV step ──
router.post(
  '/:id/approve',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(jvApprovalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      if (jv.status !== 'PENDING_APPROVAL') {
        res.status(400).json({ error: `JV is not pending approval (current: ${jv.status})` });
        return;
      }
      if (!jv.approvalWorkflow) {
        res.status(400).json({ error: 'No approval workflow found' });
        return;
      }

      // Find the pending step for this user's role
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) {
        res.status(403).json({ error: 'User not found' });
        return;
      }
      const step = jv.approvalWorkflow.steps.find(
        (s) => s.approverRole === user.role && s.status === ApprovalStepStatus.PENDING
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role' });
        return;
      }

      const result = await approvalService.approve(step.id, req.user!.id, req.body.comments);

      if (result.isFullyApproved) {
        await prisma.journalVoucher.update({
          where: { id: jv.id },
          data: { status: 'APPROVED' },
        });
        await logAudit({
          userId: req.user!.id,
          action: AuditAction.APPROVE,
          entityType: 'JOURNAL_VOUCHER',
          entityId: jv.id,
          projectId,
          newValue: { status: 'APPROVED' },
        });
      }

      res.json({
        message: result.isFullyApproved ? 'JV fully approved — ready to post' : 'Step approved',
        isFullyApproved: result.isFullyApproved,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Reject JV ──
router.post(
  '/:id/reject',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(jvApprovalActionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { approvalWorkflow: { include: { steps: true } } },
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      if (jv.status !== 'PENDING_APPROVAL') {
        res.status(400).json({ error: `JV is not pending approval (current: ${jv.status})` });
        return;
      }
      if (!jv.approvalWorkflow) {
        res.status(400).json({ error: 'No approval workflow found' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) {
        res.status(403).json({ error: 'User not found' });
        return;
      }
      const step = jv.approvalWorkflow.steps.find(
        (s) => s.approverRole === user.role && s.status === ApprovalStepStatus.PENDING
      );
      if (!step) {
        res.status(400).json({ error: 'No pending step for your role' });
        return;
      }

      const reason = req.body.reason || req.body.comments || 'Rejected';
      const result = await approvalService.reject(step.id, req.user!.id, reason);

      if (result.isFullyRejected) {
        await prisma.journalVoucher.update({
          where: { id: jv.id },
          data: { status: 'REJECTED' },
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.REJECT,
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        newValue: { status: 'REJECTED', reason },
      });

      res.json({ message: 'JV rejected', isFullyRejected: result.isFullyRejected });
    } catch (error) {
      next(error);
    }
  },
);

// ── Post JV (APPROVED → POSTED) ──
// This is the critical step: creates bank/cash transactions, updates budget heads, updates owner balance.
router.post(
  '/:id/post',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      // Pre-check for a fast, user-friendly 400. The authoritative claim is
      // the atomic updateMany inside postJournalVoucher — two concurrent post
      // requests can both pass this read but only one will win the claim.
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: { id: true, jvNumber: true, type: true, date: true, description: true, status: true },
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      if (jv.status !== 'APPROVED') {
        res.status(400).json({ error: `JV must be APPROVED to post (current: ${jv.status})` });
        return;
      }

      const result = await postJournalVoucher(jv, projectId, req.user!.id);

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        newValue: { status: 'POSTED', postedAt: new Date(), ...result },
      });

      res.json({ message: 'JV posted successfully', jvNumber: jv.jvNumber, ...result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Cancel JV (DRAFT or PENDING_APPROVAL → CANCELLED) ──
router.post(
  '/:id/cancel',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!jv) {
        res.status(404).json({ error: 'Journal voucher not found' });
        return;
      }
      if (!['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(jv.status)) {
        res.status(400).json({ error: `Cannot cancel a ${jv.status} JV` });
        return;
      }

      await prisma.journalVoucher.update({
        where: { id: jv.id },
        data: { status: 'CANCELLED' },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'JOURNAL_VOUCHER',
        entityId: jv.id,
        projectId,
        newValue: { status: 'CANCELLED' },
      });

      res.json({ message: 'JV cancelled' });
    } catch (error) {
      next(error);
    }
  },
);

// ═══════════════════════════════════════════════════════════
// JV Posting Engine — the core financial logic
// ═══════════════════════════════════════════════════════════

async function postJournalVoucher(
  jv: {
    id: string;
    jvNumber: string;
    type: string;
    date: Date;
    description: string | null;
  },
  projectId: string,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const txnResults: string[] = [];

    // ── A17: Atomically claim the JV to prevent double posting ──
    // Two concurrent /post calls can both pass the route's pre-transaction
    // APPROVED check. This atomic updateMany ensures only one can transition
    // the JV from APPROVED → POSTED; the other gets count=0 and aborts. The
    // `status: APPROVED` filter is the lock. If the financial work below
    // throws, the whole transaction (including this claim) rolls back, so the
    // JV returns to APPROVED and can be retried.
    const claimed = await tx.journalVoucher.updateMany({
      where: { id: jv.id, status: 'APPROVED' },
      data: { status: 'POSTED', postedAt: new Date(), postedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new Error('JV is already being posted or is no longer APPROVED');
    }

    // Re-fetch entries inside the transaction so we post against the rows that
    // existed at claim time, not a stale read from before the transaction.
    const fresh = await tx.journalVoucher.findUnique({
      where: { id: jv.id },
      include: { entries: true },
    });
    if (!fresh) throw new Error('Journal voucher not found');
    const entries = fresh.entries;

    // ── Compute cash movement totals to allocate "paid" correctly per budget head ──
    // Previously a single global hasCashOutflow flag marked EVERY budget-head debit
    // in the JV as paid if any bank/cash credit existed — cross-contaminating
    // unrelated accrual debits. Now we allocate the actual cash outflow
    // proportionally across all budget-head debits, so total paid can never
    // exceed the cash that actually moved. Owner-expense JVs treat owner
    // credits as a funding source (like cash).
    const isCashType = (t: string) => t === JournalAccountType.BANK || t === JournalAccountType.CASH;
    const cashOutflow = entries.reduce((sum, e) => {
      if (isCashType(e.accountType) && Number(e.credit) > 0) return sum + Number(e.credit);
      if (jv.type === JVType.OWNER_EXPENSE && e.accountType === JournalAccountType.OWNER && Number(e.credit) > 0) return sum + Number(e.credit);
      return sum;
    }, 0);
    const totalBhDebit = entries.reduce(
      (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.debit) > 0 ? sum + Number(e.debit) : sum),
      0,
    );
    const cashInflow = entries.reduce((sum, e) => {
      if (isCashType(e.accountType) && Number(e.debit) > 0) return sum + Number(e.debit);
      if (jv.type === JVType.OWNER_REPAYMENT && e.accountType === JournalAccountType.OWNER && Number(e.debit) > 0) return sum + Number(e.debit);
      return sum;
    }, 0);
    const totalBhCredit = entries.reduce(
      (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.credit) > 0 ? sum + Number(e.credit) : sum),
      0,
    );

    // ── Rounding-safe proportional allocation (C29) ──
    // Naive proportional shares (debit * cashOutflow/totalBhDebit) can produce
    // fractions that, when rounded to Decimal(15,2), sum to slightly less or
    // more than the cash that actually moved (e.g. ₹33.33 × 3 = ₹99.99 instead
    // of ₹100.00). Over many JVs these paise differences accumulate. We round
    // each share to 2 decimals and assign the residual to the LAST debit/credit
    // line so the total paid/reversed always equals the cash moved exactly.
    const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const debitEntries = entries.filter((e) => e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.debit) > 0);
    const creditEntries = entries.filter((e) => e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.credit) > 0);
    const debitRatio = totalBhDebit > 0 ? Math.min(1, cashOutflow / totalBhDebit) : 0;
    const creditRatio = totalBhCredit > 0 ? Math.min(1, cashInflow / totalBhCredit) : 0;

    const paidByEntryId = new Map<string, number>();
    let allocatedPaid = 0;
    debitEntries.forEach((e, idx) => {
      if (idx === debitEntries.length - 1) {
        paidByEntryId.set(e.id, Math.max(0, round2(cashOutflow) - round2(allocatedPaid)));
      } else {
        const share = round2(Number(e.debit) * debitRatio);
        paidByEntryId.set(e.id, share);
        allocatedPaid += share;
      }
    });

    const reversedByEntryId = new Map<string, number>();
    let allocatedReversed = 0;
    creditEntries.forEach((e, idx) => {
      if (idx === creditEntries.length - 1) {
        reversedByEntryId.set(e.id, Math.max(0, round2(cashInflow) - round2(allocatedReversed)));
      } else {
        const share = round2(Number(e.credit) * creditRatio);
        reversedByEntryId.set(e.id, share);
        allocatedReversed += share;
      }
    });

    for (const entry of entries) {
      const debit = Number(entry.debit);
      const credit = Number(entry.credit);

      switch (entry.accountType as JournalAccountType) {
        case JournalAccountType.BANK: {
          if (!entry.accountId) throw new Error('Bank entry missing accountId');
          const account = await tx.bankAccount.findFirst({
            where: { id: entry.accountId, projectId, deletedAt: null },
          });
          if (!account) throw new Error('Bank account not found');
          if (!account.isActive) throw new Error(`Bank account ${account.accountName} is inactive`);

          // Debit to bank = money IN (deposit), Credit to bank = money OUT (withdrawal)
          const isDeposit = debit > 0;
          const amount = isDeposit ? debit : credit;
          if (!isDeposit && Number(account.currentBalance) < amount) {
            throw new Error(`Insufficient balance in bank account ${account.accountName}`);
          }

          const txnType = isDeposit ? BankTxnType.DEPOSIT : BankTxnType.WITHDRAWAL;
          const refType = isDeposit ? AccountTxnRefType.MANUAL_DEPOSIT : AccountTxnRefType.MANUAL_WITHDRAWAL;

          // Atomic balance update — DB applies the delta.
          const updated = await tx.bankAccount.update({
            where: { id: entry.accountId },
            data: { currentBalance: isDeposit ? { increment: amount } : { decrement: amount } },
            select: { currentBalance: true },
          });
          await tx.bankTransaction.create({
            data: {
              bankAccountId: entry.accountId,
              type: txnType,
              amount,
              balanceAfter: Number(updated.currentBalance),
              date: jv.date,
              description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
              referenceType: refType,
              referenceId: jv.id,
              status: 'POSTED',
              createdBy: userId,
            },
          });
          txnResults.push(`bank:${isDeposit ? 'deposit' : 'withdrawal'}:${amount}`);
          break;
        }

        case JournalAccountType.CASH: {
          if (!entry.accountId) throw new Error('Cash entry missing accountId');
          const account = await tx.cashAccount.findFirst({
            where: { id: entry.accountId, projectId, deletedAt: null },
          });
          if (!account) throw new Error('Cash account not found');
          if (!account.isActive) throw new Error(`Cash account ${account.name} is inactive`);

          const isIn = debit > 0;
          const amount = isIn ? debit : credit;
          if (!isIn && Number(account.currentBalance) < amount) {
            throw new Error(`Insufficient balance in cash account ${account.name}`);
          }

          const txnType = isIn ? CashTxnType.IN : CashTxnType.OUT;
          const refType = isIn ? AccountTxnRefType.MANUAL_DEPOSIT : AccountTxnRefType.MANUAL_WITHDRAWAL;

          // Atomic balance update — DB applies the delta.
          const updated = await tx.cashAccount.update({
            where: { id: entry.accountId },
            data: { currentBalance: isIn ? { increment: amount } : { decrement: amount } },
            select: { currentBalance: true },
          });
          await tx.cashTransaction.create({
            data: {
              cashAccountId: entry.accountId,
              type: txnType,
              amount,
              balanceAfter: Number(updated.currentBalance),
              date: jv.date,
              description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
              referenceType: refType,
              referenceId: jv.id,
              status: 'POSTED',
              createdBy: userId,
            },
          });
          txnResults.push(`cash:${isIn ? 'in' : 'out'}:${amount}`);
          break;
        }

        case JournalAccountType.BUDGET_HEAD: {
          if (!entry.budgetHeadId) throw new Error('Budget head entry missing budgetHeadId');
          const head = await tx.budgetHead.findFirst({
            where: { id: entry.budgetHeadId, projectId, deletedAt: null },
          });
          if (!head) throw new Error('Budget head not found');

          // Debit to budget head = expense incurred (actual increases)
          // Credit to budget head = expense reversal/correction (actual decreases)
          // If cash moved (bank/cash credit or owner-expense), paid also adjusts.
          // This ensures the same expense produces identical accounting whether
          // entered via JV or via Expense → Payment, and allows ADJUSTMENT JVs
          // to correct overstated actual/paid amounts via credit entries.
          if (debit > 0) {
            // ── C27: Prevent overspend beyond allocated budget ──
            const projectedActual = Number(head.actualAmount) + debit;
            if (projectedActual > Number(head.allocatedAmount) + 0.01) {
              throw new Error(
                `Debit of ₹${debit.toFixed(2)} to budget head "${head.particulars}" would exceed allocated budget ` +
                `(allocated: ₹${Number(head.allocatedAmount).toFixed(2)}, current actual: ₹${Number(head.actualAmount).toFixed(2)})`
              );
            }
            const paidPortion = paidByEntryId.get(entry.id) ?? 0;
            // Atomic increments — DB applies both deltas, preventing lost updates
            // when a JV and a payment hit the same budget head concurrently.
            await tx.budgetHead.update({
              where: { id: entry.budgetHeadId },
              data: {
                actualAmount: { increment: debit },
                paidAmount: { increment: paidPortion },
              },
            });
            txnResults.push(`budget_head:${head.particulars}:actual+${debit}${paidPortion > 0 ? `:paid+${paidPortion.toFixed(2)}` : ''}`);
          } else if (credit > 0) {
            // Credit to budget head = reversal/correction of expense
            // ── C25: Validate before clamping instead of silently dropping ──
            // If the credit exceeds the current actualAmount or the reversed
            // paid portion exceeds paidAmount, throwing surfaces the error
            // instead of silently discarding the excess and corrupting the
            // link between the journal and the budget cache.
            const currentActual = Number(head.actualAmount);
            if (credit > currentActual + 0.01) {
              throw new Error(
                `Credit of ₹${credit.toFixed(2)} to budget head "${head.particulars}" exceeds current actual amount ` +
                `(₹${currentActual.toFixed(2)}). Reduce the credit or post a correction JV first.`
              );
            }
            const reversedPaid = reversedByEntryId.get(entry.id) ?? 0;
            const currentPaid = Number(head.paidAmount);
            if (reversedPaid > currentPaid + 0.01) {
              throw new Error(
                `Reversed paid portion of ₹${reversedPaid.toFixed(2)} exceeds current paid amount ` +
                `(₹${currentPaid.toFixed(2)}) on budget head "${head.particulars}".`
              );
            }
            // Atomic decrements — DB applies both deltas.
            await tx.budgetHead.update({
              where: { id: entry.budgetHeadId },
              data: {
                actualAmount: { decrement: credit },
                paidAmount: { decrement: reversedPaid },
              },
            });
            txnResults.push(`budget_head:${head.particulars}:actual-${credit}${reversedPaid > 0 ? `:paid-${reversedPaid.toFixed(2)}` : ''}`);
          }
          break;
        }

        case JournalAccountType.OWNER: {
          if (!entry.ownerAccountId) throw new Error('Owner entry missing ownerAccountId');
          const owner = await tx.ownerAccount.findFirst({
            where: { id: entry.ownerAccountId, projectId, deletedAt: null },
          });
          if (!owner) throw new Error('Owner account not found');

          // Credit to owner = company owes owner more (balance increases)
          // Debit to owner = company owes owner less (balance decreases)
          // Atomic update — increment handles both directions (credit - debit;
          // a negative increment is a decrement).
          const delta = credit - debit;
          const updated = await tx.ownerAccount.update({
            where: { id: entry.ownerAccountId },
            data: { currentBalance: { increment: delta } },
            select: { currentBalance: true },
          });
          txnResults.push(`owner:${credit > 0 ? 'credit' : 'debit'}:${credit > 0 ? credit : debit}:balance=${Number(updated.currentBalance)}`);
          break;
        }

        default:
          throw new Error(`Unknown account type: ${entry.accountType}`);
      }
    }

    // ── Create LedgerEntry rows for every journal entry so the new Tally-style ──
    // reports (trial balance, P&L, balance sheet) can see this JV. The legacy
    // posting logic above updates BankAccount/CashAccount/BudgetHead/OwnerAccount
    // balances directly; this section mirrors those movements into the ledger
    // system by creating LedgerEntry rows and updating Ledger.currentBalance.
    for (const entry of entries) {
      const debit = Number(entry.debit);
      const credit = Number(entry.credit);
      let ledgerId: string | null = null;

      switch (entry.accountType as JournalAccountType) {
        case JournalAccountType.BANK: {
          if (!entry.accountId) break;
          ledgerId = await ensureBankLedger(entry.accountId, projectId);
          break;
        }
        case JournalAccountType.CASH: {
          if (!entry.accountId) break;
          ledgerId = await ensureCashLedger(entry.accountId, projectId);
          break;
        }
        case JournalAccountType.OWNER: {
          if (!entry.ownerAccountId) break;
          ledgerId = await ensureOwnerLedger(entry.ownerAccountId, projectId);
          break;
        }
        case JournalAccountType.BUDGET_HEAD: {
          if (!entry.budgetHeadId) break;
          // Find or create an expense ledger for this budget head
          const head = await tx.budgetHead.findFirst({ where: { id: entry.budgetHeadId, projectId, deletedAt: null } });
          if (!head) break;
          const existing = await prisma.ledger.findFirst({
            where: { linkedEntityType: LedgerLinkType.NONE, name: head.particulars, projectId, deletedAt: null },
          });
          if (existing) {
            ledgerId = existing.id;
          } else {
            const created = await prisma.ledger.create({
              data: {
                projectId,
                name: head.particulars,
                group: LedgerGroup.DIRECT_EXPENSE,
                linkedEntityType: LedgerLinkType.NONE,
                openingBalance: 0,
                currentBalance: 0,
                isActive: true,
              },
            });
            ledgerId = created.id;
          }
          break;
        }
      }

      if (!ledgerId) continue;

      // Update ledger balance: debit increases, credit decreases (debit-nature convention)
      const balanceDelta = debit - credit;
      await tx.ledger.update({
        where: { id: ledgerId },
        data: { currentBalance: { increment: balanceDelta } },
      });

      // Create the LedgerEntry row
      await tx.ledgerEntry.create({
        data: {
          ledgerId,
          journalVoucherId: jv.id,
          debit,
          credit,
          description: entry.description ?? jv.description ?? jv.jvNumber,
          voucherType: jv.type,
          voucherNumber: jv.jvNumber,
          voucherDate: jv.date,
        },
      });
    }

    return { transactions: txnResults };
  });
}

export default router;
