import { prisma } from '../src/config/prisma';
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const nullPays = await prisma.payment.count({ where: { paymentRequest: { projectId: pid, poId: null, vendorId: { not: null }, deletedAt: null } } });
  const nullPRs = await prisma.paymentRequest.findMany({ where: { projectId: pid, poId: null, vendorId: { not: null }, deletedAt: null }, select: { requestNumber: true, amount: true, status: true } });
  console.log('Payments via PR with poId NULL:', nullPays, '| PRs with poId NULL:', nullPRs.length);
  nullPRs.forEach((x) => console.log('  PR no-PO:', x.requestNumber, x.status, String(x.amount)));
  const pos = await prisma.purchaseOrder.findMany({ where: { projectId: pid, deletedAt: null }, select: { poNumber: true, grandTotal: true, netPayable: true } });
  const mism = pos.filter((x) => Number(x.netPayable) === 0 && Number(x.grandTotal) > 0);
  console.log('POs with netPayable=0 but grandTotal>0:', mism.length, mism.map((x) => x.poNumber).join(','));
  const ded = pos.filter((x) => Number(x.netPayable) !== Number(x.grandTotal));
  ded.forEach((x) => console.log(`  netPayable≠grandTotal: ${x.poNumber} gt=${x.grandTotal} net=${x.netPayable}`));
  await prisma.$disconnect();
})();
