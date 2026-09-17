import { prisma } from '../src/config/prisma';
(async () => {
  const po = await prisma.purchaseOrder.findFirst({ where: { poNumber: 'VGH-PO010' } });
  const logs = await prisma.auditLog.findMany({ where: { entityId: po!.id }, orderBy: { timestamp: 'asc' }, select: { timestamp: true, action: true, oldValue: true, newValue: true } });
  for (const l of logs) {
    const nv = l.newValue as any, ov = l.oldValue as any;
    console.log(`${l.timestamp.toISOString()} ${l.action} | old.gt=${ov?.grandTotal ?? '-'} new.gt=${nv?.grandTotal ?? '-'} | old.net=${ov?.netPayable ?? '-'} new.net=${nv?.netPayable ?? '-'}`);
  }
  console.log('current:', po?.poNumber, 'grandTotal', po?.grandTotal?.toString(), 'netPayable', po?.netPayable?.toString());
  await prisma.$disconnect();
})();
