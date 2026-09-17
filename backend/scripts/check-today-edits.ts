import { prisma } from '../src/config/prisma';
(async () => {
  const logs = await prisma.auditLog.findMany({
    where: { timestamp: { gte: new Date('2026-09-16T00:00:00+05:30') }, entityType: { contains: 'PURCHASE' } },
    select: { timestamp: true, action: true, entityType: true, oldValue: true, newValue: true },
    orderBy: { timestamp: 'desc' }, take: 15,
  });
  logs.forEach((l) => {
    const nv = l.newValue as any, ov = l.oldValue as any;
    console.log(`${l.timestamp.toISOString().slice(11,16)}Z ${l.action} ${l.entityType} | ${ov?.grandTotal ?? ov?.poNumber ?? ''} → ${nv?.grandTotal ?? nv?.poNumber ?? ''}`);
  });
  await prisma.$disconnect();
})();
