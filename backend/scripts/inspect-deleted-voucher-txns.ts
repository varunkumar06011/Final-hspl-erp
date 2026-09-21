import { prisma } from '../src/config/prisma';

(async () => {
  const deleted = await prisma.journalVoucher.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true, jvNumber: true },
  });
  const ids = deleted.map((v) => v.id);

  const entries = await prisma.ledgerEntry.findMany({
    where: { journalVoucherId: { in: ids } },
    include: { ledger: { select: { name: true } } },
    orderBy: [{ journalVoucherId: 'asc' }, { createdAt: 'asc' }],
  });
  console.log('=== LEDGER ENTRIES ON DELETED VOUCHERS ===');
  let cur = '';
  for (const e of entries) {
    if (e.journalVoucherId !== cur) {
      cur = e.journalVoucherId;
      console.log(`\n  voucher ${e.voucherNumber} (${e.journalVoucherId.slice(0, 8)})`);
    }
    console.log(
      `    ${e.ledger.name.padEnd(30)} Dr=${String(e.debit).padStart(10)} Cr=${String(e.credit).padStart(10)} ${e.description ?? ''}`,
    );
  }

  const cashTxns = await prisma.cashTransaction.findMany({
    where: { referenceId: { in: ids } },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n=== CASH TXNS ===');
  for (const t of cashTxns) {
    console.log(
      `  ref=${t.referenceId?.slice(0, 8)} type=${t.type} amt=${t.amount} status=${t.status} balAfter=${t.balanceAfter} ${t.description ?? ''}`,
    );
  }
  const bankTxns = await prisma.bankTransaction.findMany({
    where: { referenceId: { in: ids } },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n=== BANK TXNS ===');
  for (const t of bankTxns) {
    console.log(
      `  ref=${t.referenceId?.slice(0, 8)} type=${t.type} amt=${t.amount} status=${t.status} ${t.description ?? ''}`,
    );
  }

  await prisma.$disconnect();
})();
