import { prisma } from '../src/config/prisma';
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const payments = await prisma.payment.findMany({
    where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null } },
    select: { date: true, amount: true, status: true, createdAt: true, paymentRequest: { select: { requestNumber: true, vendorId: true } } },
    orderBy: { date: 'asc' },
  });
  console.log('=== ALL PAYMENTS ===');
  payments.forEach((x) => console.log(`  ${x.date.toISOString().slice(0,10)} ${fmt(Number(x.amount))} ${x.status} via ${x.paymentRequest.requestNumber} (created ${x.createdAt.toISOString().slice(0,10)})`));
  const sheets = await prisma.paymentSheet.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { date: true, amount: true, status: true, purchaseOrder: { select: { poNumber: true, vendor: { select: { name: true } } } } },
    orderBy: { date: 'asc' },
  });
  console.log('=== ALL PAYMENT SHEETS ===');
  sheets.forEach((x) => console.log(`  ${x.date.toISOString().slice(0,10)} ${fmt(Number(x.amount))} ${x.status} ${x.purchaseOrder.poNumber} ${x.purchaseOrder.vendor.name}`));
  const pos = await prisma.purchaseOrder.findMany({
    where: { projectId: pid, deletedAt: null },
    select: { poNumber: true, grandTotal: true, date: true },
    orderBy: { poNumber: 'asc' },
  });
  console.log('=== ALL POs ===');
  pos.forEach((x) => console.log(`  ${x.poNumber} ${x.date.toISOString().slice(0,10)} ${fmt(Number(x.grandTotal))}`));
  console.log('PO sum:', fmt(pos.reduce((s, x) => s + Number(x.grandTotal), 0)));
  await prisma.$disconnect();
})();
