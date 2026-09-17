import { prisma } from '../src/config/prisma';

const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const monthOf = (d: Date) => Number(monthFmt.format(d)) - 1;

async function main() {
  const project = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } }, select: { id: true, name: true } });
  if (!project) throw new Error('no project');
  const projectId = project.id;
  const year = 2026;
  const inYear = { gte: new Date(`${year}-01-01T00:00:00+05:30`), lt: new Date(`${year + 1}-01-01T00:00:00+05:30`) };

  const [vendorsCreated, quotations, pos, invoices, payReqs, payments, sheets, settlements, receipts] = await Promise.all([
    prisma.vendor.findMany({ where: { projectId, deletedAt: null, createdAt: inYear }, select: { id: true, createdAt: true, status: true } }),
    prisma.quotation.findMany({ where: { projectId, deletedAt: null, date: inYear }, select: { vendorId: true, date: true, grandTotal: true, status: true } }),
    prisma.purchaseOrder.findMany({ where: { projectId, deletedAt: null, date: inYear }, select: { vendorId: true, date: true, grandTotal: true, status: true, budgetHeadId: true, budgetHead: { select: { particulars: true } } } }),
    prisma.vendorInvoice.findMany({ where: { projectId, deletedAt: null, date: inYear }, select: { vendorId: true, date: true, totalAmount: true, paymentStatus: true, purchaseOrder: { select: { budgetHeadId: true, budgetHead: { select: { particulars: true } } } } } }),
    prisma.paymentRequest.findMany({ where: { projectId, deletedAt: null, createdAt: inYear, vendorId: { not: null } }, select: { vendorId: true, createdAt: true, amount: true, status: true, type: true, budgetHeadId: true, budgetHead: { select: { particulars: true } }, payments: { select: { id: true } } } }),
    prisma.payment.findMany({ where: { date: inYear, paymentRequest: { projectId, vendorId: { not: null }, deletedAt: null } }, select: { date: true, amount: true, status: true, budgetHeadId: true, budgetHead: { select: { particulars: true } }, paymentRequest: { select: { vendorId: true } } } }),
    prisma.paymentSheet.findMany({ where: { projectId, deletedAt: null, date: inYear }, select: { date: true, amount: true, status: true, purchaseOrder: { select: { vendorId: true, budgetHeadId: true, budgetHead: { select: { particulars: true } } } } } }),
    prisma.billSettlement.findMany({ where: { projectId, createdAt: inYear }, select: { vendorId: true, createdAt: true, amount: true } }),
    prisma.goodsReceipt.findMany({ where: { projectId, deletedAt: null, createdAt: inYear }, select: { status: true, createdAt: true, postedAt: true, purchaseOrder: { select: { vendorId: true } } } }),
  ]);

  console.log(`Project: ${project.name}`);
  console.log(`Rows: vendors=${vendorsCreated.length} q=${quotations.length} po=${pos.length} inv=${invoices.length} pr=${payReqs.length} pay=${payments.length} sheets=${sheets.length} settle=${settlements.length} gr=${receipts.length}`);

  // Month histogram
  const hist = new Array(12).fill(0);
  const bump = (d: Date) => hist[monthOf(d)]++;
  vendorsCreated.forEach((v) => bump(v.createdAt));
  quotations.forEach((q) => bump(q.date));
  pos.forEach((p) => bump(p.date));
  invoices.forEach((i) => bump(i.date));
  payReqs.forEach((p) => bump(p.createdAt));
  payments.forEach((p) => bump(p.date));
  sheets.forEach((s) => bump(s.date));
  settlements.forEach((s) => bump(s.createdAt));
  receipts.forEach((g) => bump(g.postedAt ?? g.createdAt));
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  hist.forEach((c, i) => { if (c) console.log(`  ${names[i]}: ${c} events`); });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
