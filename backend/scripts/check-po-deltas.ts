import { prisma } from '../src/config/prisma';
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pos = await prisma.purchaseOrder.findMany({ where: { projectId: p!.id, deletedAt: null }, select: { id: true, poNumber: true, grandTotal: true, netPayable: true } });
  for (const po of pos) {
    const create = await prisma.auditLog.findFirst({ where: { entityId: po.id, action: 'CREATE' }, orderBy: { timestamp: 'asc' } });
    const nv = create?.newValue as any;
    const orig = nv?.grandTotal ?? nv?.po?.grandTotal;
    if (orig !== undefined && Number(orig) !== Number(po.grandTotal)) {
      console.log(`${po.poNumber}: created ${orig} → now ${po.grandTotal} (Δ ${Number(po.grandTotal) - Number(orig)})`);
    }
  }
  console.log('done');
  await prisma.$disconnect();
})();
