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
      const jv = await prisma.journalVoucher.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { entries: true },
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
    entries: Array<{
      id: string;
      accountType: string;
      accountId: string | null;
      budgetHeadId: string | null;
      ownerAccountId: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      description: string | null;
    }>;
  },
  projectId: string,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const txnResults: string[] = [];

    for (const entry of jv.entries) {
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
          const currentBalance = Number(account.currentBalance);
          const newBalance = isDeposit ? currentBalance + amount : currentBalance - amount;
          if (newBalance < 0) throw new Error(`Insufficient balance in bank account ${account.accountName}`);

          const txnType = isDeposit ? BankTxnType.DEPOSIT : BankTxnType.WITHDRAWAL;
          const refType = isDeposit ? AccountTxnRefType.MANUAL_DEPOSIT : AccountTxnRefType.MANUAL_WITHDRAWAL;

          await tx.bankTransaction.create({
            data: {
              bankAccountId: entry.accountId,
              type: txnType,
              amount,
              balanceAfter: newBalance,
              date: jv.date,
              description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
              referenceType: refType,
              referenceId: jv.id,
              status: 'POSTED',
              createdBy: userId,
            },
          });
          await tx.bankAccount.update({
            where: { id: entry.accountId },
            data: { currentBalance: newBalance },
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
          const currentBalance = Number(account.currentBalance);
          const newBalance = isIn ? currentBalance + amount : currentBalance - amount;
          if (newBalance < 0) throw new Error(`Insufficient balance in cash account ${account.name}`);

          const txnType = isIn ? CashTxnType.IN : CashTxnType.OUT;
          const refType = isIn ? AccountTxnRefType.MANUAL_DEPOSIT : AccountTxnRefType.MANUAL_WITHDRAWAL;

          await tx.cashTransaction.create({
            data: {
              cashAccountId: entry.accountId,
              type: txnType,
              amount,
              balanceAfter: newBalance,
              date: jv.date,
              description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
              referenceType: refType,
              referenceId: jv.id,
              status: 'POSTED',
              createdBy: userId,
            },
          });
          await tx.cashAccount.update({
            where: { id: entry.accountId },
            data: { currentBalance: newBalance },
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
          // For OWNER_EXPENSE type, cash already moved via owner, so both actual and paid increase
          if (debit > 0) {
            const newActual = Number(head.actualAmount) + debit;
            let newPaid = Number(head.paidAmount);
            // For owner-expense JVs, the cash already moved (owner paid), so paid also increases
            if (jv.type === JVType.OWNER_EXPENSE) {
              newPaid += debit;
            }
            await tx.budgetHead.update({
              where: { id: entry.budgetHeadId },
              data: { actualAmount: newActual, paidAmount: newPaid },
            });
            txnResults.push(`budget_head:${head.particulars}:actual+${debit}${jv.type === JVType.OWNER_EXPENSE ? `:paid+${debit}` : ''}`);
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
          const newBalance = Number(owner.currentBalance) + credit - debit;
          await tx.ownerAccount.update({
            where: { id: entry.ownerAccountId },
            data: { currentBalance: newBalance },
          });
          txnResults.push(`owner:${credit > 0 ? 'credit' : 'debit'}:${credit > 0 ? credit : debit}:balance=${newBalance}`);
          break;
        }

        default:
          throw new Error(`Unknown account type: ${entry.accountType}`);
      }
    }

    // Mark JV as POSTED
    await tx.journalVoucher.update({
      where: { id: jv.id },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: userId,
      },
    });

    return { transactions: txnResults };
  });
}

export default router;
