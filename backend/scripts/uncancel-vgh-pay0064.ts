import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../src/config/prisma';

// Uncancel VGH-PAY0064: the payment was real (money left the bank 16/09) and the
// refund was booked separately as VGH-RCPT0041 (22/09). The cancel/reversal done
// on 23/09 was a mistake — this script restores the voucher to POSTED and
// removes every artifact the cancel created.
const VOUCHER_ID = '0288fdf3-bdd8-4b7b-9a4e-1e55029678db';
const BUDGET_HEAD_ID = '0d403981-0006-4ef0-bc53-2fef15c44159';
const AMOUNT = 2582313;

(async () => {
  const result = await prisma.$transaction(async (tx) => {
    const voucher = await tx.journalVoucher.findUnique({
      where: { id: VOUCHER_ID },
      include: { ledgerEntries: true },
    });
    if (!voucher) throw new Error('Voucher not found');
    if (voucher.status !== 'CANCELLED') throw new Error(`Voucher is ${voucher.status}, expected CANCELLED`);

    const reversalEntries = voucher.ledgerEntries.filter((e) =>
      (e.description ?? '').startsWith('REVERSAL:'),
    );
    const reversalBankTxns = await tx.bankTransaction.findMany({
      where: { referenceId: VOUCHER_ID, type: { in: ['REVERSAL_IN', 'REVERSAL_OUT'] } },
    });
    const reversalCashTxns = await tx.cashTransaction.findMany({
      where: { referenceId: VOUCHER_ID, type: { in: ['REVERSAL_IN', 'REVERSAL_OUT'] } },
    });

    // Backup everything we are about to delete
    const backupPath = join(__dirname, 'backup', `uncancel-${voucher.jvNumber}-${Date.now()}.json`);
    writeFileSync(
      backupPath,
      JSON.stringify({ voucher, reversalEntries, reversalBankTxns, reversalCashTxns }, null, 2),
    );
    console.log(`backup written: ${backupPath}`);

    // 1. Undo reversal entries' balance effect, then delete them
    for (const e of reversalEntries) {
      const delta = Number(e.debit) - Number(e.credit);
      await tx.ledger.update({
        where: { id: e.ledgerId },
        data: { currentBalance: { decrement: delta } },
      });
      console.log(`  ledger ${e.ledgerId.slice(0, 8)} balance -= ${delta}`);
    }
    const delEntries = await tx.ledgerEntry.deleteMany({
      where: { id: { in: reversalEntries.map((e) => e.id) } },
    });

    // 2. Undo reversal bank txns (account balance + later balanceAfter), then delete
    for (const t of reversalBankTxns) {
      const signed = t.type === 'REVERSAL_IN' ? Number(t.amount) : -Number(t.amount);
      await tx.bankAccount.update({
        where: { id: t.bankAccountId },
        data: { currentBalance: { decrement: signed } },
      });
      const shifted = await tx.bankTransaction.updateMany({
        where: { bankAccountId: t.bankAccountId, createdAt: { gt: t.createdAt } },
        data: { balanceAfter: { decrement: signed } },
      });
      console.log(`  bankAcct ${t.bankAccountId.slice(0, 8)} balance -= ${signed}; ${shifted.count} later txns shifted`);
    }
    const delBank = await tx.bankTransaction.deleteMany({
      where: { id: { in: reversalBankTxns.map((t) => t.id) } },
    });

    // 3. Same for cash txns
    for (const t of reversalCashTxns) {
      const signed = t.type === 'REVERSAL_IN' ? Number(t.amount) : -Number(t.amount);
      await tx.cashAccount.update({
        where: { id: t.cashAccountId },
        data: { currentBalance: { decrement: signed } },
      });
      const shifted = await tx.cashTransaction.updateMany({
        where: { cashAccountId: t.cashAccountId, createdAt: { gt: t.createdAt } },
        data: { balanceAfter: { decrement: signed } },
      });
      console.log(`  cashAcct ${t.cashAccountId.slice(0, 8)} balance -= ${signed}; ${shifted.count} later txns shifted`);
    }
    const delCash = await tx.cashTransaction.deleteMany({
      where: { id: { in: reversalCashTxns.map((t) => t.id) } },
    });

    // 4. Re-apply the payment's budget head effect (mirror of postVoucher)
    const head = await tx.budgetHead.findUnique({
      where: { id: BUDGET_HEAD_ID },
      select: { committedAmount: true },
    });
    const committedRelease = Math.min(AMOUNT, Number(head?.committedAmount ?? 0));
    await tx.budgetHead.update({
      where: { id: BUDGET_HEAD_ID },
      data: {
        actualAmount: { increment: AMOUNT },
        paidAmount: { increment: AMOUNT },
        committedAmount: { decrement: committedRelease },
      },
    });
    console.log(`  budgetHead actual+=${AMOUNT} paid+=${AMOUNT} committed-=${committedRelease}`);

    // 5. Voucher back to POSTED
    const claimed = await tx.journalVoucher.updateMany({
      where: { id: VOUCHER_ID, status: 'CANCELLED' },
      data: { status: 'POSTED' },
    });
    if (claimed.count !== 1) throw new Error('Failed to restore voucher status');

    return { delEntries: delEntries.count, delBank: delBank.count, delCash: delCash.count };
  });

  console.log(`\nDone: removed ${result.delEntries} reversal entries, ${result.delBank} bank txns, ${result.delCash} cash txns`);
  await prisma.$disconnect();
})();
