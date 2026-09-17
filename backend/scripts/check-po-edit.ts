import { prisma } from '../src/config/prisma';
(async () => {
  const l = await prisma.auditLog.findFirst({
    where: { timestamp: { gte: new Date('2026-09-16T00:00:00+05:30') }, action: 'UPDATE', entityType: 'PURCHASE_ORDER' },
    orderBy: { timestamp: 'asc' },
  });
  if (!l) { console.log('none'); return; }
  console.log('newValue:', JSON.stringify(l.newValue).slice(0, 1500));
  const po = await prisma.purchaseOrder.findUnique({ where: { id: l.entityId }, select: { poNumber: true, grandTotal: true } });
  console.log('current:', po?.poNumber, po?.grandTotal);
  await prisma.$disconnect();
})();
