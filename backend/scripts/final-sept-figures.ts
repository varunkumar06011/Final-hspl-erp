import { prisma } from '../src/config/prisma';
const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const inM = (d: Date) => Number(monthFmt.format(d)) - 1 === 8;
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const [qs, pos, pays, sheets] = await Promise.all([
    prisma.quotation.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' } }, select: { vendorId: true, date: true, grandTotal: true } }),
    prisma.purchaseOrder.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' } }, select: { vendorId: true, date: true, grandTotal: true } }),
    prisma.payment.findMany({ where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null, status: { not: 'DELETED' } } }, select: { date: true, amount: true, status: true, paymentRequest: { select: { vendorId: true } } } }),
    prisma.paymentSheet.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' }, purchaseOrder: { status: { not: 'DELETED' } } }, select: { date: true, amount: true, status: true, purchaseOrder: { select: { vendorId: true } } } }),
  ]);
  const mQ = qs.filter((x) => inM(x.date)), mP = pos.filter((x) => inM(x.date));
  const mPay = pays.filter((x) => inM(x.date)), mS = sheets.filter((x) => inM(x.date));
  const paid = mPay.filter((x) => x.status === 'PAID').reduce((s, x) => s + Number(x.amount), 0) + mS.filter((x) => x.status !== 'PENDING').reduce((s, x) => s + Number(x.amount), 0);
  const payable = mS.filter((x) => x.status === 'PENDING').reduce((s, x) => s + Number(x.amount), 0);
  console.log('=== SEPTEMBER — corrected register figures (excl. DELETED) ===');
  console.log(`Quotations : ${fmt(mQ.reduce((s, x) => s + Number(x.grandTotal), 0))} · ${mQ.length}`);
  console.log(`POs        : ${fmt(mP.reduce((s, x) => s + Number(x.grandTotal), 0))} · ${mP.length}`);
  console.log(`Paid       : ${fmt(paid)} · ${mPay.length + mS.length}`);
  console.log(`Sheet paybl: ${fmt(payable)}`);
  const vs = new Set([...mQ.map(x=>x.vendorId), ...mP.map(x=>x.vendorId), ...mPay.map(x=>x.paymentRequest.vendorId!), ...mS.map(x=>x.purchaseOrder.vendorId)]);
  console.log('Vendors with Sept financial activity:', vs.size);
  await prisma.$disconnect();
})();
