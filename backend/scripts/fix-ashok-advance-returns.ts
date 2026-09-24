import { prisma } from '../src/config/prisma';

// The three receipts from S. Ashok Kumar are recovery of the ₹1,00,000 advance
// given on 03.09.26 (PAY0023), not new loans. Retyping their cash transactions
// IN -> REVERSAL_IN so they net against cash expenditure instead of inflating
// the dashboard's Short Advance/Loan figure. Ledger entries stay untouched.
const JV_NUMBERS = ['VGH-RCPT0020', 'VGH-RCPT0023', 'VGH-RCPT0027'];
const PROJECT_ID = '78996889-e6d1-4f54-aa5e-8f62f5027394';

(async () => {
  const vouchers = await prisma.journalVoucher.findMany({
    where: { jvNumber: { in: JV_NUMBERS } },
    select: { id: true, jvNumber: true, status: true },
  });
  console.log(`vouchers: ${vouchers.map((v) => `${v.jvNumber}(${v.status})`).join(', ')}`);

  const txns = await prisma.cashTransaction.findMany({
    where: { referenceId: { in: vouchers.map((v) => v.id) }, type: 'IN', status: 'POSTED' },
  });
  if (txns.length !== 3) {
    console.log(`expected 3 IN txns, found ${txns.length} — aborting`);
    for (const t of txns) console.log(`  ${t.id} ${t.type} ${t.amount} ${t.description}`);
    await prisma.$disconnect();
    return;
  }

  for (const t of txns) {
    await prisma.cashTransaction.update({ where: { id: t.id }, data: { type: 'REVERSAL_IN' } });
    console.log(`  ${t.id.slice(0, 8)} IN -> REVERSAL_IN (amt=${t.amount})`);
  }

  // Verify: recompute dashboard figures
  const cashReceiptTransactions = await prisma.cashTransaction.findMany({
    where: {
      status: 'POSTED',
      type: { in: ['IN', 'REVERSAL_OUT'] },
      cashAccount: { projectId: PROJECT_ID, deletedAt: null },
      referenceId: { not: null },
    },
    select: { type: true, referenceId: true, amount: true },
  });
  const voucherIds = cashReceiptTransactions.map((t) => t.referenceId).filter((id): id is string => !!id);
  const loanEntries = await prisma.ledgerEntry.findMany({
    where: {
      journalVoucherId: { in: voucherIds },
      credit: { gt: 0 },
      ledger: { group: { contains: 'loan', mode: 'insensitive' }, projectId: PROJECT_ID, deletedAt: null },
      journalVoucher: { status: 'POSTED', deletedAt: null },
    },
    select: { journalVoucherId: true },
  });
  const loanVoucherIds = new Set(loanEntries.map((e) => e.journalVoucherId));
  let shortAdvance = 0;
  for (const t of cashReceiptTransactions) {
    if (!loanVoucherIds.has(t.referenceId ?? '')) continue;
    shortAdvance += t.type === 'REVERSAL_OUT' ? -Number(t.amount) : Number(t.amount);
  }

  const [cashOut, cashRevIn] = await Promise.all([
    prisma.cashTransaction.aggregate({
      where: { status: 'POSTED', type: 'OUT', cashAccount: { projectId: PROJECT_ID, deletedAt: null } },
      _sum: { amount: true },
    }),
    prisma.cashTransaction.aggregate({
      where: { status: 'POSTED', type: 'REVERSAL_IN', cashAccount: { projectId: PROJECT_ID, deletedAt: null } },
      _sum: { amount: true },
    }),
  ]);

  console.log(`\nshortAdvance = ${shortAdvance}`);
  console.log(`cashExpenditure = ${Number(cashOut._sum.amount ?? 0) - Number(cashRevIn._sum.amount ?? 0)} (OUT=${cashOut._sum.amount} - REVERSAL_IN=${cashRevIn._sum.amount})`);

  await prisma.$disconnect();
})();
