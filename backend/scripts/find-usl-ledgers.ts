import { prisma } from '../src/config/prisma';

(async () => {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  console.log('=== PROJECTS ===');
  for (const p of projects) console.log(`  ${p.id} ${p.name}`);

  const ledgers = await prisma.ledger.findMany({
    where: {
      OR: [
        { name: { contains: 'Vinod', mode: 'insensitive' } },
        { name: { contains: 'Ashok', mode: 'insensitive' } },
        { name: { contains: 'USL', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, group: true, currentBalance: true, projectId: true, deletedAt: true },
  });
  console.log('\n=== MATCHING LEDGERS (all projects) ===');
  for (const l of ledgers) {
    console.log(`  ${l.id} | ${l.name} | group=${l.group} | bal=${l.currentBalance} | proj=${l.projectId.slice(0, 8)} | deleted=${!!l.deletedAt}`);
  }

  // Also: any ledger in a loan-ish group
  const loanLedgers = await prisma.ledger.findMany({
    where: { group: { contains: 'loan', mode: 'insensitive' } },
    select: { id: true, name: true, group: true, projectId: true },
  });
  console.log('\n=== LOAN-GROUP LEDGERS ===');
  for (const l of loanLedgers) console.log(`  ${l.name} | group=${l.group} | proj=${l.projectId.slice(0, 8)}`);

  await prisma.$disconnect();
})();
