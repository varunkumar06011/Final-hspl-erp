import { prisma } from '../src/config/prisma';

(async () => {
  const vouchers = await prisma.journalVoucher.findMany({
    where: { jvNumber: { in: ['VGH-PAY0064', 'VGH-RCPT0041'] } },
    include: {
      ledgerEntries: {
        include: { ledger: { select: { name: true, linkedEntityType: true, linkedEntityId: true, currentBalance: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  for (const v of vouchers) {
    console.log(`\n=== VOUCHER ${v.jvNumber} ===`);
    console.log(`  id=${v.id} status=${v.status} type=${v.voucherType} date=${v.date.toISOString()} deletedAt=${v.deletedAt}`);
    for (const e of v.ledgerEntries) {
      console.log(
        `    entry ${e.id.slice(0, 8)} | ${e.ledger.name.padEnd(38)} | Dr=${String(e.debit).padStart(12)} Cr=${String(e.credit).padStart(12)} | bh=${e.budgetHeadId ?? '-'} | ${e.description ?? ''}`,
      );
      console.log(`        ledgerId=${e.ledgerId} linked=${e.ledger.linkedEntityType}:${e.ledger.linkedEntityId} bal=${e.ledger.currentBalance}`);
    }

    const bankTxns = await prisma.bankTransaction.findMany({
      where: { referenceId: v.id },
      orderBy: { createdAt: 'asc' },
    });
    for (const t of bankTxns) {
      console.log(`    bankTxn ${t.id.slice(0, 8)} acct=${t.bankAccountId.slice(0, 8)} type=${t.type} amt=${t.amount} balAfter=${t.balanceAfter} status=${t.status} date=${t.date.toISOString()} ${t.description ?? ''}`);
    }
    const cashTxns = await prisma.cashTransaction.findMany({
      where: { referenceId: v.id },
      orderBy: { createdAt: 'asc' },
    });
    for (const t of cashTxns) {
      console.log(`    cashTxn ${t.id.slice(0, 8)} acct=${t.cashAccountId.slice(0, 8)} type=${t.type} amt=${t.amount} balAfter=${t.balanceAfter} status=${t.status} ${t.description ?? ''}`);
    }
  }

  // The vendor ledger's full recent history
  const vendor = await prisma.ledger.findFirst({
    where: { name: { contains: 'Steel on Call', mode: 'insensitive' } },
    select: { id: true, name: true, currentBalance: true },
  });
  if (vendor) {
    console.log(`\n=== VENDOR LEDGER: ${vendor.name} bal=${vendor.currentBalance} ===`);
    const entries = await prisma.ledgerEntry.findMany({
      where: { ledgerId: vendor.id },
      orderBy: [{ voucherDate: 'asc' }, { createdAt: 'asc' }],
    });
    for (const e of entries) {
      console.log(`  ${e.voucherDate.toISOString().slice(0, 10)} ${e.voucherNumber} Dr=${e.debit} Cr=${e.credit} ${e.description ?? ''}`);
    }
  }

  await prisma.$disconnect();
})();
