import { prisma } from '../src/config/prisma';
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const dead = await prisma.purchaseOrder.findMany({
    where: { projectId: p!.id, OR: [{ deletedAt: { not: null } }, { status: 'DELETED' }] },
    select: { poNumber: true, grandTotal: true, status: true, deletedAt: true, date: true },
  });
  console.log('Deleted POs:', dead.length);
  dead.forEach((d) => console.log(' ', d.poNumber, d.status, String(d.grandTotal), 'date:', d.date.toISOString().slice(0, 10), 'deletedAt:', d.deletedAt?.toISOString() ?? 'null'));
  await prisma.$disconnect();
})();
