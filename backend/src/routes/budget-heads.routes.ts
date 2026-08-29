import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, GoodsReceiptStatus, JournalAccountType, JVType } from '@hospital-erp/shared';
import {
  createBudgetHeadSchema,
  updateBudgetHeadSchema,
  listBudgetHeadsSchema,
  importBudgetSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { createCrudRouter } from '../utils/crudFactory';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

// ── Base CRUD via factory ──
const crudRouter = createCrudRouter({
  entityType: 'BUDGET_HEAD',
  model: 'budgetHead',
  createPermission: Permission.MANAGE_FINANCE,
  viewPermission: Permission.VIEW_FINANCIALS,
  createSchema: createBudgetHeadSchema,
  updateSchema: updateBudgetHeadSchema,
  listSchema: listBudgetHeadsSchema,
  searchFields: ['particulars'],
  defaultSort: { slNo: 'asc' },
  transformCreate: async (body, _userId, projectId) => ({
    projectId,
    slNo: body.slNo as number,
    particulars: body.particulars as string,
    allocatedAmount: body.allocatedAmount as number,
  }),
  transformUpdate: async (body) => {
    const data: Record<string, unknown> = {};
    for (const key of ['slNo', 'particulars', 'allocatedAmount', 'status']) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    return data;
  },
});

const router = Router();
router.use(authMiddleware);

// ── Custom routes (mounted BEFORE CRUD router so /:id does not shadow them) ──

// ── Import budget from JSON (draft budget format) ──
// Body: { items: [{ sl_no, particulars, amount }] }
router.post(
  '/import',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  validateMiddleware(importBudgetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const items = req.body.items as Array<{ sl_no: number; particulars: string; amount: number }>;

      // Upsert budget heads by slNo, preserving existing IDs so that historical
      // transactions (POs, payments, JVs, GRNs) keep their budgetHeadId linkage.
      // Previously this route soft-deleted every head and created new ones with
      // new UUIDs, orphaning all committed/actual/paid history.
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.budgetHead.findMany({
          where: { projectId, deletedAt: null },
          select: { id: true, slNo: true },
        });
        const existingBySlNo = new Map(existing.map((h) => [h.slNo, h]));

        const updated: typeof existing = [];
        for (const item of items) {
          const match = existingBySlNo.get(item.sl_no);
          if (match) {
            // Update in place — keeps the same id, preserving all FK references
            await tx.budgetHead.update({
              where: { id: match.id },
              data: {
                particulars: item.particulars,
                allocatedAmount: item.amount,
                deletedAt: null, // revive if it was previously soft-deleted
              },
            });
            updated.push(match);
            existingBySlNo.delete(item.sl_no);
          } else {
            // New head — create it
            const created = await tx.budgetHead.create({
              data: {
                projectId,
                slNo: item.sl_no,
                particulars: item.particulars,
                allocatedAmount: item.amount,
              },
            });
            updated.push(created);
          }
        }
        // NOTE: existing heads whose slNo is not in the import are intentionally
        // left untouched — they may have linked transactions and must not be
        // silently deleted.

        return updated;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'BUDGET_HEAD',
        entityId: projectId, // project-level import
        projectId,
        newValue: { importedCount: result.length },
      });

      res.status(201).json({ imported: result.length, budgetHeads: result });
    } catch (error) {
      next(error);
    }
  },
);

// ── Recompute cached totals from source events ──
// Rebuilds committedAmount, actualAmount, paidAmount for all budget heads in
// the project from the immutable financial events (POs, GRNs, Payments, JVs).
// This provides a financial audit trail: if cached totals ever drift due to
// bugs or manual edits, they can be reconstructed from the source data.
router.post(
  '/recompute',
  rbacMiddleware(Permission.MANAGE_FINANCE),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      // ── C24: Wrap the entire recompute in a transaction ──
      // If any update fails, all changes roll back, preventing a partially
      // recomputed cache that is inconsistent with the source data.
      const { results, driftedCount } = await prisma.$transaction(async (tx) => {
        const heads = await tx.budgetHead.findMany({
          where: { projectId, deletedAt: null },
          select: { id: true, particulars: true, allocatedAmount: true, committedAmount: true, actualAmount: true, paidAmount: true },
        });

        const results: Array<{ id: string; particulars: string; before: { committed: number; actual: number; paid: number }; after: { committed: number; actual: number; paid: number }; drifted: boolean }> = [];

        for (const head of heads) {
        // ── Recompute committed ──
        // For each non-rejected PO with this budget head:
        //   committed contribution = grandTotal - deliveredValue
        // (delivered value has been converted from committed to actual via GRN)
        // ── C22: Only count genuinely committed POs (APPROVED, PARTIALLY_DELIVERED, DELIVERED) ──
        // Previously excluded only REJECTED, so DRAFT/PENDING_APPROVAL/CANCELLED POs
        // inflated committedAmount and hid available budget.
        const pos = await tx.purchaseOrder.findMany({
          where: { projectId, budgetHeadId: head.id, deletedAt: null, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'] } },
          select: {
            id: true,
            poNumber: true,
            grandTotal: true,
            status: true,
            editedAt: true,
            items: { select: { materialName: true, unitPrice: true, gstRate: true } },
          },
        });

        let committed = 0;
        for (const po of pos) {
          // Compute delivered value for this PO from posted GRNs
          const receipts = await tx.goodsReceipt.findMany({
            where: { poId: po.id, deletedAt: null, status: GoodsReceiptStatus.POSTED },
            select: { items: { select: { materialName: true, acceptedQty: true } } },
          });
          const itemMap = new Map<string, { unitPrice: number; gstRate: number }>();
          for (const item of po.items) {
            itemMap.set(item.materialName.toLowerCase(), { unitPrice: Number(item.unitPrice), gstRate: Number(item.gstRate ?? 0) });
          }
          let deliveredValue = 0;
          for (const receipt of receipts) {
            for (const line of receipt.items) {
              if (Number(line.acceptedQty) <= 0) continue;
              const item = itemMap.get(line.materialName.toLowerCase());
              if (item) {
                const lineAmount = item.unitPrice * Number(line.acceptedQty);
                const lineGst = lineAmount * item.gstRate / 100;
                deliveredValue += lineAmount + lineGst;
              }
            }
          }
          committed += Math.max(0, Number(po.grandTotal) - deliveredValue);
        }

        // ── Recompute actual ──
        // actual = GRN values + EXPENSE payment amounts + JV budget head debits
        let actual = 0;

        // GRN values (committed → actual conversion)
        const grns = await tx.goodsReceipt.findMany({
          where: {
            projectId,
            deletedAt: null,
            status: GoodsReceiptStatus.POSTED,
            purchaseOrder: { budgetHeadId: head.id },
          },
          select: {
            items: {
              select: {
                acceptedQty: true,
                poItem: { select: { unitPrice: true, gstRate: true } },
              },
            },
          },
        });
        for (const grn of grns) {
          for (const line of grn.items) {
            if (Number(line.acceptedQty) <= 0) continue;
            const poItem = line.poItem;
            if (poItem) {
              const lineAmount = Number(poItem.unitPrice) * Number(line.acceptedQty);
              const lineGst = lineAmount * Number(poItem.gstRate) / 100;
              actual += lineAmount + lineGst;
            }
          }
        }

        // EXPENSE payments (payment IS the actual expense event)
        const expensePayments = await tx.payment.aggregate({
          where: {
            budgetHeadId: head.id,
            paymentRequest: { type: 'EXPENSE', deletedAt: null },
          },
          _sum: { amount: true },
        });
        actual += Number(expensePayments._sum.amount) || 0;

        // JV budget head debits (increase actual) and credits (decrease actual)
        const [jvDebits, jvCredits] = await Promise.all([
          prisma.journalEntry.aggregate({
            where: {
              budgetHeadId: head.id,
              debit: { gt: 0 },
              journalVoucher: { projectId, status: 'POSTED', deletedAt: null },
            },
            _sum: { debit: true },
          }),
          prisma.journalEntry.aggregate({
            where: {
              budgetHeadId: head.id,
              credit: { gt: 0 },
              journalVoucher: { projectId, status: 'POSTED', deletedAt: null },
            },
            _sum: { credit: true },
          }),
        ]);
        actual += Number(jvDebits._sum.debit) || 0;
        actual -= Number(jvCredits._sum.credit) || 0;

        // ── Recompute paid ──
        // paid = all payment amounts + JV debits where cash moved
        let paid = 0;

        // All payments (regardless of type — INVOICE, EXPENSE, ADVANCE)
        const allPayments = await tx.payment.aggregate({
          where: {
            budgetHeadId: head.id,
            paymentRequest: { deletedAt: null },
          },
          _sum: { amount: true },
        });
        paid += Number(allPayments._sum.amount) || 0;

        // JV entries where cash moved: debits increase paid, credits decrease paid
        const jvEntriesAll = await tx.journalEntry.findMany({
          where: {
            budgetHeadId: head.id,
            OR: [{ debit: { gt: 0 } }, { credit: { gt: 0 } }],
            journalVoucher: { projectId, status: 'POSTED', deletedAt: null },
          },
          select: {
            debit: true,
            credit: true,
            journalVoucher: {
              select: {
                type: true,
                entries: { select: { accountType: true, debit: true, credit: true } },
              },
            },
          },
        });
        for (const entry of jvEntriesAll) {
          const jv = entry.journalVoucher;
          // Allocate cash outflow proportionally across all budget-head debits
          // in this JV, so a cash credit funding one head does not mark an
          // unrelated accrual debit in the same JV as paid.
          const isCashType = (t: string) => t === JournalAccountType.BANK || t === JournalAccountType.CASH;
          if (Number(entry.debit) > 0) {
            const cashOutflow = jv.entries.reduce((sum, e) => {
              if (isCashType(e.accountType) && Number(e.credit) > 0) return sum + Number(e.credit);
              if (jv.type === JVType.OWNER_EXPENSE && e.accountType === JournalAccountType.OWNER && Number(e.credit) > 0) return sum + Number(e.credit);
              return sum;
            }, 0);
            const totalBhDebit = jv.entries.reduce(
              (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.debit) > 0 ? sum + Number(e.debit) : sum),
              0,
            );
            const share = totalBhDebit > 0 ? Number(entry.debit) * Math.min(1, cashOutflow / totalBhDebit) : 0;
            paid += share;
          } else if (Number(entry.credit) > 0) {
            const cashInflow = jv.entries.reduce((sum, e) => {
              if (isCashType(e.accountType) && Number(e.debit) > 0) return sum + Number(e.debit);
              if (jv.type === JVType.OWNER_REPAYMENT && e.accountType === JournalAccountType.OWNER && Number(e.debit) > 0) return sum + Number(e.debit);
              return sum;
            }, 0);
            const totalBhCredit = jv.entries.reduce(
              (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.credit) > 0 ? sum + Number(e.credit) : sum),
              0,
            );
            const share = totalBhCredit > 0 ? Number(entry.credit) * Math.min(1, cashInflow / totalBhCredit) : 0;
            // ── C23: Floor paid at 0 to prevent negative paidAmount ──
            // Credit JVs reduce paid (cash returned), but without a floor the
            // recompute can drive paid below zero when cash inflow is
            // mis-attributed or when payments were deleted after the JV posted.
            paid = Math.max(0, paid - share);
          }
        }

        const before = {
          committed: Number(head.committedAmount),
          actual: Number(head.actualAmount),
          paid: Number(head.paidAmount),
        };
        const after = { committed, actual, paid };
        const drifted =
          Math.abs(before.committed - after.committed) > 0.01 ||
          Math.abs(before.actual - after.actual) > 0.01 ||
          Math.abs(before.paid - after.paid) > 0.01;

        if (drifted) {
          // ── C24: Use tx instead of prisma so all updates are atomic ──
          await tx.budgetHead.update({
            where: { id: head.id },
            data: { committedAmount: committed, actualAmount: actual, paidAmount: paid },
          });
        }

        results.push({ id: head.id, particulars: head.particulars, before, after, drifted });
      }

        const driftedCount = results.filter((r) => r.drifted).length;
        return { results, driftedCount };
      }, { timeout: 60000, maxWait: 90000 });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'BUDGET_HEAD',
        entityId: projectId,
        projectId,
        newValue: { action: 'recompute', headsChecked: results.length, driftedCount, results },
      });

      res.json({
        headsChecked: results.length,
        driftedCount,
        results,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Budget summary: total allocated, committed, actual, paid, available ──
router.get(
  '/summary',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const heads = await prisma.budgetHead.findMany({
        where: { projectId, deletedAt: null },
        select: {
          allocatedAmount: true,
          committedAmount: true,
          actualAmount: true,
          paidAmount: true,
        },
      });

      const sum = (field: 'allocatedAmount' | 'committedAmount' | 'actualAmount' | 'paidAmount') =>
        heads.reduce((acc, h) => acc + Number(h[field]), 0);

      const totalAllocated = sum('allocatedAmount');
      const totalCommitted = sum('committedAmount');
      const totalActual = sum('actualAmount');
      const totalPaid = sum('paidAmount');

      res.json({
        totalAllocated,
        totalCommitted,
        totalActual,
        totalPaid,
        totalAvailable: totalAllocated - totalActual,
        totalUncommittedAvailable: totalAllocated - totalCommitted - totalActual,
        headCount: heads.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Budget head breakdown: what transactions make up spent amounts ──
router.get(
  '/:id/breakdown',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const head = await prisma.budgetHead.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!head) {
        res.status(404).json({ error: 'Budget head not found' });
        return;
      }

      const budgetHeadId = head.id;
      type Txn = {
        date: string;
        type: string;
        reference: string;
        description: string;
        committed: number;
        actual: number;
        paid: number;
      };
      const transactions: Txn[] = [];

      // 1. Approved POs with this budget head → committed events
      // ── C29: Only include genuinely committed POs, not drafts/pending/cancelled ──
      const pos = await prisma.purchaseOrder.findMany({
        where: { projectId, budgetHeadId, deletedAt: null, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED', 'DELIVERED'] } },
        select: {
          id: true,
          poNumber: true,
          grandTotal: true,
          status: true,
          date: true,
          editedAt: true,
          parentPoId: true,
        },
        orderBy: { date: 'asc' },
      });
      for (const po of pos) {
        transactions.push({
          date: po.date.toISOString(),
          type: po.parentPoId ? 'PO (Regenerated)' : 'PO Approval',
          reference: po.poNumber,
          description: `Committed on approved PO ${po.poNumber}`,
          committed: Number(po.grandTotal),
          actual: 0,
          paid: 0,
        });
      }

      // 2. Posted GRNs against POs with this budget head → committed→actual conversion
      const grns = await prisma.goodsReceipt.findMany({
        where: {
          projectId,
          deletedAt: null,
          status: GoodsReceiptStatus.POSTED,
          purchaseOrder: { budgetHeadId },
        },
        select: {
          id: true,
          receiptNumber: true,
          createdAt: true,
          items: {
            select: { acceptedQty: true, poItem: { select: { unitPrice: true, gstRate: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      for (const grn of grns) {
        let grnValue = 0;
        for (const line of grn.items) {
          if (Number(line.acceptedQty) <= 0) continue;
          const poItem = line.poItem;
          if (poItem) {
            const lineAmount = Number(poItem.unitPrice) * Number(line.acceptedQty);
            const lineGst = lineAmount * Number(poItem.gstRate) / 100;
            grnValue += lineAmount + lineGst;
          }
        }
        if (grnValue > 0) {
          transactions.push({
            date: grn.createdAt.toISOString(),
            type: 'GRN',
            reference: grn.receiptNumber,
            description: `Goods received — commitment converted to actual`,
            committed: -grnValue,
            actual: grnValue,
            paid: 0,
          });
        }
      }

      // 3. Payments linked to this budget head → paid events
      const payments = await prisma.payment.findMany({
        where: {
          budgetHeadId,
          paymentRequest: { deletedAt: null },
        },
        select: {
          id: true,
          amount: true,
          date: true,
          mode: true,
          paymentRequest: {
            select: {
              paymentCode: true,
              type: true,
              description: true,
            },
          },
        },
        orderBy: { date: 'asc' },
      });
      for (const pmt of payments) {
        const isExpense = pmt.paymentRequest.type === 'EXPENSE';
        transactions.push({
          date: pmt.date.toISOString(),
          type: 'Payment',
          reference: pmt.paymentRequest.paymentCode,
          description: pmt.paymentRequest.description ?? `Payment (${pmt.paymentRequest.type})`,
          committed: 0,
          actual: isExpense ? Number(pmt.amount) : 0,
          paid: Number(pmt.amount),
        });
      }

      // 4. Posted JV entries affecting this budget head → actual/paid events
      //    Debits increase actual (and paid if cash moved out)
      //    Credits decrease actual (and paid if cash moved back in)
      const jvEntries = await prisma.journalEntry.findMany({
        where: {
          budgetHeadId,
          OR: [{ debit: { gt: 0 } }, { credit: { gt: 0 } }],
          journalVoucher: { projectId, status: 'POSTED', deletedAt: null },
        },
        select: {
          id: true,
          debit: true,
          credit: true,
          description: true,
          journalVoucher: {
            select: {
              id: true,
              jvNumber: true,
              date: true,
              type: true,
              description: true,
              entries: {
                select: { accountType: true, debit: true, credit: true },
              },
            },
          },
        },
        orderBy: { journalVoucher: { date: 'asc' } },
      });
      for (const entry of jvEntries) {
        const jv = entry.journalVoucher;
        const isDebit = Number(entry.debit) > 0;
        const amount = isDebit ? Number(entry.debit) : Number(entry.credit);
        const isCashType = (t: string) => t === JournalAccountType.BANK || t === JournalAccountType.CASH;
        if (isDebit) {
          const cashOutflow = jv.entries.reduce((sum, e) => {
            if (isCashType(e.accountType) && Number(e.credit) > 0) return sum + Number(e.credit);
            if (jv.type === JVType.OWNER_EXPENSE && e.accountType === JournalAccountType.OWNER && Number(e.credit) > 0) return sum + Number(e.credit);
            return sum;
          }, 0);
          const totalBhDebit = jv.entries.reduce(
            (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.debit) > 0 ? sum + Number(e.debit) : sum),
            0,
          );
          const paidPortion = totalBhDebit > 0 ? amount * Math.min(1, cashOutflow / totalBhDebit) : 0;
          transactions.push({
            date: jv.date.toISOString(),
            type: 'Journal Voucher',
            reference: jv.jvNumber,
            description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
            committed: 0,
            actual: amount,
            paid: paidPortion,
          });
        } else {
          const cashInflow = jv.entries.reduce((sum, e) => {
            if (isCashType(e.accountType) && Number(e.debit) > 0) return sum + Number(e.debit);
            if (jv.type === JVType.OWNER_REPAYMENT && e.accountType === JournalAccountType.OWNER && Number(e.debit) > 0) return sum + Number(e.debit);
            return sum;
          }, 0);
          const totalBhCredit = jv.entries.reduce(
            (sum, e) => (e.accountType === JournalAccountType.BUDGET_HEAD && Number(e.credit) > 0 ? sum + Number(e.credit) : sum),
            0,
          );
          const reversedPortion = totalBhCredit > 0 ? amount * Math.min(1, cashInflow / totalBhCredit) : 0;
          transactions.push({
            date: jv.date.toISOString(),
            type: 'Journal Voucher (Reversal)',
            reference: jv.jvNumber,
            description: entry.description ?? jv.description ?? `JV ${jv.jvNumber}`,
            committed: 0,
            actual: -amount,
            paid: -reversedPortion,
          });
        }
      }

      // Sort all transactions by date
      transactions.sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        budgetHead: {
          id: head.id,
          particulars: head.particulars,
          allocatedAmount: Number(head.allocatedAmount),
          committedAmount: Number(head.committedAmount),
          actualAmount: Number(head.actualAmount),
          paidAmount: Number(head.paidAmount),
          available: Number(head.allocatedAmount) - Number(head.actualAmount),
          uncommittedAvailable: Number(head.allocatedAmount) - Number(head.committedAmount) - Number(head.actualAmount),
        },
        transactions,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── Base CRUD (mounted AFTER custom routes so /:id does not shadow
//    /import, /recompute, /summary, or /:id/breakdown) ──
router.use(crudRouter);

export default router;
