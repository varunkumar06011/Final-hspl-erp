import { prisma } from '../src/config/prisma';

(async () => {
  const ledgers = await prisma.ledger.findMany({
    where: {
      projectId: '78996889-e6d1-4f54-aa5e-8f62f5027394',
      deletedAt: null,
      group: { contains: 'loan', mode: 'insensitive' },
    },
    select: { name: true, group: true, currentBalance: true },
  });
  let outstanding = 0;
  for (const l of ledgers) {
    outstanding -= Number(l.currentBalance);
    console.log(`${l.name} | ${l.group} | bal=${l.currentBalance}`);
  }
  console.log(`outstandingLoans = ${outstanding}`);
  await prisma.$disconnect();
})();
