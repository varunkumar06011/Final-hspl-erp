import { prisma } from '../src/config/prisma';

// The refund deposit from VGH-RCPT0041 (advance returned by Steel on Call) is
// real money in, but it is NOT new inward income — it's our own advance back.
// Retyping DEPOSIT -> REVERSAL_IN nets it off the dashboard's expenditure side
// and keeps it out of pure inward funds, matching "net off both sides".
const TXN_ID = '26f3c4be-0000-0000-0000-000000000000'; // placeholder, resolved below
const RCPT_VOUCHER_ID = '5dcf0eae-1a65-4d74-afd5-6be9caaa394a';

(async () => {
  const txn = await prisma.bankTransaction.findFirst({
    where: { referenceId: RCPT_VOUCHER_ID, type: 'DEPOSIT', status: 'POSTED' },
  });
  if (!txn) throw new Error('DEPOSIT txn for VGH-RCPT0041 not found');
  console.log(`found txn ${txn.id} type=${txn.type} amt=${txn.amount} bh=${txn.budgetHeadId} desc=${txn.description}`);

  const updated = await prisma.bankTransaction.update({
    where: { id: txn.id },
    data: { type: 'REVERSAL_IN' },
  });
  console.log(`updated: ${updated.id} type=${updated.type}`);

  // Verify dashboard math for this account pair
  const [inflow, outflow, revIn] = await Promise.all([
    prisma.bankTransaction.aggregate({
      where: { status: 'POSTED', type: { in: ['DEPOSIT', 'MANUAL_DEPOSIT'] } },
      _sum: { amount: true },
    }),
    prisma.bankTransaction.aggregate({
      where: { status: 'POSTED', type: { in: ['WITHDRAWAL', 'PAYMENT'] } },
      _sum: { amount: true },
    }),
    prisma.bankTransaction.aggregate({
      where: { status: 'POSTED', type: 'REVERSAL_IN' },
      _sum: { amount: true },
    }),
  ]);
  console.log(`\nproject-wide: inward=${inflow._sum.amount} outflow=${outflow._sum.amount} reversalIn=${revIn._sum.amount}`);
  console.log(`bankExpenditure=${Number(outflow._sum.amount ?? 0) - Number(revIn._sum.amount ?? 0)}`);

  await prisma.$disconnect();
})();
