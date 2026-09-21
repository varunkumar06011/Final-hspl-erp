import { prisma } from '../src/config/prisma';

(async () => {
  // All soft-deleted vouchers
  const deleted = await prisma.journalVoucher.findMany({
    where: { deletedAt: { not: null } },
    select: {
      id: true,
      jvNumber: true,
      voucherType: true,
      status: true,
      date: true,
      deletedAt: true,
      totalDebit: true,
      totalCredit: true,
      projectId: true,
    },
    orderBy: { deletedAt: 'desc' },
  });

  console.log(`=== SOFT-DELETED VOUCHERS: ${deleted.length} ===`);
  for (const v of deleted) {
    const [leCount, jeCount, bsCount, bankCount, cashCount, poPostCount, paymentCount, sheetCount] =
      await Promise.all([
        prisma.ledgerEntry.count({ where: { journalVoucherId: v.id } }),
        prisma.journalEntry.count({ where: { journalVoucherId: v.id } }),
        prisma.billSettlement.count({ where: { journalVoucherId: v.id } }),
        prisma.bankTransaction.count({ where: { referenceId: v.id } }),
        prisma.cashTransaction.count({ where: { referenceId: v.id } }),
        prisma.pOItemLedgerPost.count({ where: { journalVoucherId: v.id } }),
        prisma.payment.count({ where: { journalVoucherId: v.id } }),
        prisma.paymentSheet.count({ where: { voucherId: v.id } }),
      ]);
    const leSums = await prisma.ledgerEntry.aggregate({
      where: { journalVoucherId: v.id },
      _sum: { debit: true, credit: true },
    });
    console.log(
      `  ${v.jvNumber} | type=${v.voucherType} | status=${v.status} | date=${v.date.toISOString().slice(0, 10)} | deletedAt=${v.deletedAt?.toISOString().slice(0, 10)}`,
    );
    console.log(
      `    ledgerEntries=${leCount} (sumDr=${leSums._sum.debit} sumCr=${leSums._sum.credit}) | journalEntries=${jeCount} | billSettlements=${bsCount} | bankTxns=${bankCount} | cashTxns=${cashCount} | poPosts=${poPostCount} | payments=${paymentCount} | sheets=${sheetCount}`,
    );
  }

  // Also: cancelled-but-not-deleted vouchers (their reversal entries are legit)
  const cancelled = await prisma.journalVoucher.count({
    where: { status: 'CANCELLED', deletedAt: null },
  });
  console.log(`\nCancelled (not deleted) vouchers: ${cancelled}`);

  await prisma.$disconnect();
})();
