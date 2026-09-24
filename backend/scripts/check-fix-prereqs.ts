import { prisma } from '../src/config/prisma';

const VOUCHER_ID = '0288fdf3-bdd8-4b7b-9a4e-1e55029678db';
const BANK_ACCT = '5ea29e57-e86a-40b4-b157-1fae73b33abb';
const REVERSAL_TXN_CREATED = new Date('2026-09-23T15:25:34.986Z');
const BUDGET_HEAD = '0d403981-0006-4ef0-bc53-2fef15c44159';

(async () => {
  const bh = await prisma.budgetHead.findUnique({ where: { id: BUDGET_HEAD } });
  console.log('=== BUDGET HEAD ===');
  console.log(bh ? `  ${bh.name} allocated=${bh.allocatedAmount} committed=${bh.committedAmount} actual=${bh.actualAmount} paid=${bh.paidAmount}` : '  not found');

  const later = await prisma.bankTransaction.findMany({
    where: { bankAccountId: BANK_ACCT, createdAt: { gt: REVERSAL_TXN_CREATED } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, amount: true, balanceAfter: true, createdAt: true, description: true },
  });
  console.log(`\n=== BANK TXNS AFTER REVERSAL (${later.length}) ===`);
  for (const t of later) {
    console.log(`  ${t.createdAt.toISOString()} ${t.type} amt=${t.amount} balAfter=${t.balanceAfter} ${t.description ?? ''}`);
  }

  const acct = await prisma.bankAccount.findUnique({
    where: { id: BANK_ACCT },
    select: { accountName: true, currentBalance: true },
  });
  console.log(`\n=== BANK ACCOUNT === ${acct?.accountName} bal=${acct?.currentBalance}`);

  const journalEntries = await prisma.journalEntry.findMany({ where: { journalVoucherId: VOUCHER_ID } });
  console.log(`\n=== JOURNAL ENTRIES on voucher: ${journalEntries.length} ===`);
  for (const je of journalEntries) {
    console.log(`  ${je.id.slice(0, 8)} Dr=${je.debit} Cr=${je.credit} ${je.description ?? ''}`);
  }

  const settlements = await prisma.billSettlement.findMany({ where: { journalVoucherId: VOUCHER_ID } });
  console.log(`\n=== BILL SETTLEMENTS: ${settlements.length} ===`);

  const payments = await prisma.payment.findMany({ where: { journalVoucherId: VOUCHER_ID } });
  console.log(`\n=== PAYMENTS LINKED: ${payments.length} ===`);
  for (const p of payments) {
    console.log(`  ${p.id.slice(0, 8)} amount=${p.amount} status=${p.status}`);
  }

  await prisma.$disconnect();
})();
