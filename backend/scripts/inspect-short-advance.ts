import { prisma } from '../src/config/prisma';

const PROJECT_ID = '78996889-e6d1-4f54-aa5e-8f62f5027394'; // V Grand Health Care

(async () => {
  const ledgers = await prisma.ledger.findMany({
    where: {
      projectId: PROJECT_ID,
      OR: [
        { name: { contains: 'Vinod', mode: 'insensitive' } },
        { name: { contains: 'Ashok', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, group: true, currentBalance: true },
  });
  console.log('=== LEDGERS ===');
  for (const l of ledgers) console.log(`  ${l.id} | ${l.name} | ${l.group} | bal=${l.currentBalance}`);

  const ledgerIds = ledgers.map((l) => l.id);
  for (const l of ledgers) {
    console.log(`\n=== ENTRIES: ${l.name} (bal=${l.currentBalance}) ===`);
    const entries = await prisma.ledgerEntry.findMany({
      where: { ledgerId: l.id },
      orderBy: [{ voucherDate: 'asc' }, { createdAt: 'asc' }],
    });
    for (const e of entries) {
      console.log(`  ${e.voucherDate.toISOString().slice(0, 10)} ${e.voucherNumber} jv=${e.journalVoucherId.slice(0, 8)} Dr=${e.debit} Cr=${e.credit} ${e.description ?? ''}`);
    }
  }

  const jvIds = (await prisma.ledgerEntry.findMany({
    where: { ledgerId: { in: ledgerIds } },
    select: { journalVoucherId: true },
    distinct: ['journalVoucherId'],
  })).map((e) => e.journalVoucherId);

  const vouchers = await prisma.journalVoucher.findMany({
    where: { id: { in: jvIds } },
    select: { id: true, jvNumber: true, status: true, voucherType: true, date: true, deletedAt: true },
    orderBy: { date: 'asc' },
  });
  console.log('\n=== VOUCHERS ===');
  for (const v of vouchers) {
    console.log(`  ${v.jvNumber} ${v.id.slice(0, 8)} status=${v.status} type=${v.voucherType} ${v.date.toISOString().slice(0, 10)} deleted=${!!v.deletedAt}`);
    for (const t of await prisma.cashTransaction.findMany({ where: { referenceId: v.id }, orderBy: { createdAt: 'asc' } })) {
      console.log(`    cash ${t.id.slice(0, 8)} type=${t.type} amt=${t.amount} status=${t.status} date=${t.date.toISOString().slice(0, 10)} ${t.description ?? ''}`);
    }
    for (const t of await prisma.bankTransaction.findMany({ where: { referenceId: v.id }, orderBy: { createdAt: 'asc' } })) {
      console.log(`    bank ${t.id.slice(0, 8)} type=${t.type} amt=${t.amount} status=${t.status} ${t.description ?? ''}`);
    }
  }

  // Recompute shortAdvance exactly like dashboard admin-summary
  const cashReceiptTransactions = await prisma.cashTransaction.findMany({
    where: {
      status: 'POSTED',
      type: { in: ['IN', 'REVERSAL_OUT'] },
      cashAccount: { projectId: PROJECT_ID, deletedAt: null },
      referenceId: { not: null },
    },
    select: { type: true, referenceId: true, amount: true, description: true, date: true },
  });
  const voucherIds = cashReceiptTransactions.map((t) => t.referenceId).filter((id): id is string => !!id);
  const loanEntries = await prisma.ledgerEntry.findMany({
    where: {
      journalVoucherId: { in: voucherIds },
      credit: { gt: 0 },
      ledger: { group: { contains: 'loan', mode: 'insensitive' }, projectId: PROJECT_ID, deletedAt: null },
      journalVoucher: { status: 'POSTED', deletedAt: null },
    },
    select: { journalVoucherId: true, credit: true, ledger: { select: { name: true } } },
  });
  const loanVoucherIds = new Set(loanEntries.map((e) => e.journalVoucherId));
  console.log('\n=== SHORT ADVANCE CONTRIBUTORS ===');
  let shortAdvance = 0;
  for (const t of cashReceiptTransactions) {
    if (!loanVoucherIds.has(t.referenceId ?? '')) continue;
    const signed = t.type === 'REVERSAL_OUT' ? -Number(t.amount) : Number(t.amount);
    shortAdvance += signed;
    const jv = await prisma.journalVoucher.findUnique({ where: { id: t.referenceId! }, select: { jvNumber: true, status: true } });
    console.log(`  ${t.date.toISOString().slice(0, 10)} ${t.type.padEnd(12)} amt=${String(t.amount).padStart(10)} signed=${signed} ${jv?.jvNumber} (${jv?.status}) ${t.description ?? ''}`);
  }
  console.log(`\nshortAdvance = ${shortAdvance}`);

  await prisma.$disconnect();
})();
