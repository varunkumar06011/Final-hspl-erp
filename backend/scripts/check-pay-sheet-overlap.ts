import { prisma } from '../src/config/prisma';
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const payments = await prisma.payment.findMany({
    where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null, status: { not: 'DELETED' } } },
    select: { amount: true, status: true, date: true, paymentRequest: { select: { poId: true, requestNumber: true, vendorId: true } } },
  });
  const sheets = await prisma.paymentSheet.findMany({
    where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' }, purchaseOrder: { status: { not: 'DELETED' } } },
    select: { amount: true, status: true, date: true, poId: true, purchaseOrder: { select: { poNumber: true, vendorId: true } } },
  });
  console.log('=== PAIRING CHECK (paid sheets vs payments, same PO+amount) ===');
  const payKey = new Set(payments.filter((x) => x.status === 'PAID').map((x) => `${x.paymentRequest.poId}|${Number(x.amount)}`));
  for (const s of sheets) {
    const covered = s.status !== 'PENDING' && payKey.has(`${s.poId}|${Number(s.amount)}`);
    console.log(`  ${s.date.toISOString().slice(0,10)} ${fmt(Number(s.amount)).padStart(12)} ${s.status.padEnd(8)} ${s.purchaseOrder.poNumber} ${covered ? '← ALSO a Payment record (dup)' : '← sheet only'}`);
  }
  await prisma.$disconnect();
})();
