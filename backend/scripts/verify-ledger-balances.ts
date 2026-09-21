import { prisma } from '../src/config/prisma';

(async () => {
  const names = [
    'Main Cash',
    'USL - T Vinod Kumar',
    'Printing & Stationery',
    'Varun (office)',
    'Reliance Retail Ltd',
    'Staff Welfare',
    'Pooja Expenses',
  ];
  const ledgers = await prisma.ledger.findMany({ where: { name: { in: names } } });
  for (const l of ledgers) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { ledgerId: l.id },
      _sum: { debit: true, credit: true },
    });
    const computed = Number(l.openingBalance) + Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
    const cached = Number(l.currentBalance);
    const ok = Math.abs(cached - computed) < 0.005 ? 'OK' : '*** MISMATCH ***';
    console.log(`${l.name.padEnd(28)} cached=${cached} computed=${computed.toFixed(2)} ${ok}`);
  }

  // Full-project consistency sweep: every active ledger
  const all = await prisma.ledger.findMany({ where: { deletedAt: null } });
  let mismatches = 0;
  for (const l of all) {
    const agg = await prisma.ledgerEntry.aggregate({
      where: { ledgerId: l.id },
      _sum: { debit: true, credit: true },
    });
    const computed = Number(l.openingBalance) + Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
    if (Math.abs(Number(l.currentBalance) - computed) >= 0.005) {
      mismatches++;
      console.log(`MISMATCH ${l.name} cached=${l.currentBalance} computed=${computed.toFixed(2)}`);
    }
  }
  console.log(`\nChecked ${all.length} ledgers, ${mismatches} mismatches`);
  await prisma.$disconnect();
})();
