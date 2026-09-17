import { prisma } from '../src/config/prisma';
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const logs = await prisma.auditLog.findMany({
    where: { projectId: p!.id, entityType: 'PURCHASE_ORDER', action: { in: ['UPDATE', 'DELETE', 'RESTORE'] } },
    select: { timestamp: true, action: true, entityId: true, oldValue: true, newValue: true },
    orderBy: { timestamp: 'asc' },
  });
  for (const l of logs) {
    const nv = l.newValue as any, ov = l.oldValue as any;
    const o = ov?.grandTotal, n = nv?.grandTotal;
    const po = await prisma.purchaseOrder.findUnique({ where: { id: l.entityId }, select: { poNumber: true } });
    console.log(`${l.timestamp.toISOString().slice(0,16)} ${l.action} ${po?.poNumber} | gt ${o ?? '-'} → ${n ?? '-'}${o !== undefined && n !== undefined && Number(o) !== Number(n) ? '  *** Δ' + (Number(n) - Number(o)) : ''}`);
  }
  await prisma.$disconnect();
})();
