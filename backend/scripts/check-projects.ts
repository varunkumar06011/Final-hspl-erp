import { prisma } from '../src/config/prisma';
(async () => {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  for (const p of projects) {
    const [v, q, po, inv, pay] = await Promise.all([
      prisma.vendor.count({ where: { projectId: p.id, deletedAt: null } }),
      prisma.quotation.count({ where: { projectId: p.id, deletedAt: null } }),
      prisma.purchaseOrder.count({ where: { projectId: p.id, deletedAt: null } }),
      prisma.vendorInvoice.count({ where: { projectId: p.id, deletedAt: null } }),
      prisma.paymentRequest.count({ where: { projectId: p.id, deletedAt: null } }),
    ]);
    console.log(p.name, '| vendors:', v, 'q:', q, 'po:', po, 'inv:', inv, 'payReq:', pay);
  }
  const pos = await prisma.purchaseOrder.findMany({ where: { deletedAt: null }, select: { date: true, poNumber: true, projectId: true }, orderBy: { date: 'desc' }, take: 5 });
  console.log('Latest POs:', pos.map(p => `${p.poNumber} @ ${p.date.toISOString()}`).join(' | '));
  await prisma.$disconnect();
})();
