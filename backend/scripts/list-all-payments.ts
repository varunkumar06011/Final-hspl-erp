import { prisma } from '../src/config/prisma';
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const payments = await prisma.payment.findMany({
    where: { paymentRequest: { projectId: p!.id, vendorId: { not: null }, deletedAt: null } },
    select: { amount: true, status: true, date: true, paymentRequest: { select: { requestNumber: true, type: true, poId: true, purchaseOrder: { select: { poNumber: true } } } } },
    orderBy: { date: 'asc' },
  });
  console.log('ALL payments:', payments.length);
  payments.forEach((x) => console.log(`  ${x.date.toISOString().slice(0,10)} ${fmt(Number(x.amount)).padStart(12)} ${x.status.padEnd(8)} ${x.paymentRequest.requestNumber} → ${x.paymentRequest.purchaseOrder?.poNumber ?? 'no-PO'} (${x.paymentRequest.type})`));
  await prisma.$disconnect();
})();
