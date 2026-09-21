import { prisma } from '../src/config/prisma';

const BANK_IN_TYPES = ['DEPOSIT', 'TRANSFER_IN', 'REVERSAL_IN'];
const CASH_IN_TYPES = ['IN', 'TRANSFER_IN', 'REVERSAL_IN'];

(async () => {
  const deleted = await prisma.journalVoucher.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, jvNumber: true },
  });
  console.log(`Cleaning up artifacts for ${deleted.length} deleted vouchers`);

  for (const v of deleted) {
    await prisma.$transaction(async (tx) => {
      // Defensive: if leftover ledger entries don't net to zero per ledger,
      // undo their residual effect on the cached balance before removing them.
      const ledgerNets = await tx.ledgerEntry.groupBy({
        by: ['ledgerId'],
        where: { journalVoucherId: v.id },
        _sum: { debit: true, credit: true },
      });
      for (const row of ledgerNets) {
        const net = Number(row._sum.debit ?? 0) - Number(row._sum.credit ?? 0);
        if (net !== 0) {
          await tx.ledger.update({
            where: { id: row.ledgerId },
            data: { currentBalance: { decrement: net } },
          });
          console.log(`  ! ledger ${row.ledgerId} residual net ${net} reversed`);
        }
      }

      const bankTxns = await tx.bankTransaction.findMany({
        where: { referenceId: v.id, status: 'POSTED' },
        select: { bankAccountId: true, type: true, amount: true },
      });
      const bankNets = new Map<string, number>();
      for (const t of bankTxns) {
        const signed = (BANK_IN_TYPES.includes(t.type) ? 1 : -1) * Number(t.amount);
        bankNets.set(t.bankAccountId, (bankNets.get(t.bankAccountId) ?? 0) + signed);
      }
      for (const [accountId, net] of bankNets) {
        if (net !== 0) {
          await tx.bankAccount.update({
            where: { id: accountId },
            data: { currentBalance: { decrement: net } },
          });
          console.log(`  ! bankAccount ${accountId} residual net ${net} reversed`);
        }
      }

      const cashTxns = await tx.cashTransaction.findMany({
        where: { referenceId: v.id, status: 'POSTED' },
        select: { cashAccountId: true, type: true, amount: true },
      });
      const cashNets = new Map<string, number>();
      for (const t of cashTxns) {
        const signed = (CASH_IN_TYPES.includes(t.type) ? 1 : -1) * Number(t.amount);
        cashNets.set(t.cashAccountId, (cashNets.get(t.cashAccountId) ?? 0) + signed);
      }
      for (const [accountId, net] of cashNets) {
        if (net !== 0) {
          await tx.cashAccount.update({
            where: { id: accountId },
            data: { currentBalance: { decrement: net } },
          });
          console.log(`  ! cashAccount ${accountId} residual net ${net} reversed`);
        }
      }

      const le = await tx.ledgerEntry.deleteMany({ where: { journalVoucherId: v.id } });
      const je = await tx.journalEntry.deleteMany({ where: { journalVoucherId: v.id } });
      const bs = await tx.billSettlement.deleteMany({ where: { journalVoucherId: v.id } });
      const po = await tx.pOItemLedgerPost.deleteMany({ where: { journalVoucherId: v.id } });
      const bt = await tx.bankTransaction.deleteMany({ where: { referenceId: v.id } });
      const ct = await tx.cashTransaction.deleteMany({ where: { referenceId: v.id } });
      const pm = await tx.payment.updateMany({
        where: { journalVoucherId: v.id },
        data: { journalVoucherId: null },
      });
      const ps = await tx.paymentSheet.deleteMany({ where: { voucherId: v.id } });

      console.log(
        `  ${v.jvNumber}: ledgerEntries=${le.count} journalEntries=${je.count} settlements=${bs.count} poPosts=${po.count} bankTxns=${bt.count} cashTxns=${ct.count} paymentsUnlinked=${pm.count} sheets=${ps.count}`,
      );
    });
  }

  await prisma.$disconnect();
})();
