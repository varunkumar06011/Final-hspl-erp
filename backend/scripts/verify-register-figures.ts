import { prisma } from '../src/config/prisma';

const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const inMonth = (d: Date, m: number) => Number(monthFmt.format(d)) - 1 === m;
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

(async () => {
  const project = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = project!.id;
  const M = 8; // September (0-based)

  const [qs, pos, invs, prs, pays, sheets, settles, grs, vendors] = await Promise.all([
    prisma.quotation.findMany({ where: { projectId: pid, deletedAt: null }, select: { vendorId: true, date: true, grandTotal: true, quotationNumber: true } }),
    prisma.purchaseOrder.findMany({ where: { projectId: pid, deletedAt: null }, select: { vendorId: true, date: true, grandTotal: true, poNumber: true } }),
    prisma.vendorInvoice.findMany({ where: { projectId: pid, deletedAt: null }, select: { vendorId: true, date: true, totalAmount: true } }),
    prisma.paymentRequest.findMany({ where: { projectId: pid, deletedAt: null, vendorId: { not: null } }, select: { vendorId: true, createdAt: true, amount: true, status: true, requestNumber: true, payments: { select: { id: true, amount: true, date: true, status: true } } } }),
    prisma.payment.findMany({ where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null } }, select: { date: true, amount: true, status: true, paymentRequest: { select: { vendorId: true, requestNumber: true } } } }),
    prisma.paymentSheet.findMany({ where: { projectId: pid, deletedAt: null }, select: { date: true, amount: true, status: true, purchaseOrder: { select: { vendorId: true, poNumber: true } } } }),
    prisma.billSettlement.findMany({ where: { projectId: pid }, select: { vendorId: true, createdAt: true, amount: true } }),
    prisma.goodsReceipt.findMany({ where: { projectId: pid, deletedAt: null }, select: { createdAt: true, postedAt: true, purchaseOrder: { select: { vendorId: true } } } }),
    prisma.vendor.findMany({ where: { projectId: pid, deletedAt: null }, select: { id: true, name: true, createdAt: true } }),
  ]);

  // September slices
  const mQs = qs.filter((x) => inMonth(x.date, M));
  const mPos = pos.filter((x) => inMonth(x.date, M));
  const mInvs = invs.filter((x) => inMonth(x.date, M));
  const mPrs = prs.filter((x) => inMonth(x.createdAt, M));
  const mPays = pays.filter((x) => inMonth(x.date, M));
  const mSheets = sheets.filter((x) => inMonth(x.date, M));
  const mSettles = settles.filter((x) => inMonth(x.createdAt, M));
  const mGrs = grs.filter((x) => inMonth(x.postedAt ?? x.createdAt, M));
  const mVendors = vendors.filter((x) => inMonth(x.createdAt, M));

  const sum = (a: { [k: string]: unknown }[], k: string) => a.reduce((s, r) => s + Number(r[k]), 0);

  // paidAmount = payments(PAID) + PAID PRs w/o payments + non-PENDING sheets
  const paidFromPayments = mPays.filter((p) => p.status === 'PAID').reduce((s, p) => s + Number(p.amount), 0);
  const paidFromOrphanPRs = mPrs.filter((p) => p.status === 'PAID' && p.payments.length === 0).reduce((s, p) => s + Number(p.amount), 0);
  const paidFromSheets = mSheets.filter((s2) => s2.status !== 'PENDING').reduce((s, x) => s + Number(x.amount), 0);
  const paidTotal = paidFromPayments + paidFromOrphanPRs + paidFromSheets;
  const sheetPending = mSheets.filter((s2) => s2.status === 'PENDING').reduce((s, x) => s + Number(x.amount), 0);

  // vendor universe for the month
  const vset = new Set<string>();
  mQs.forEach((x) => vset.add(x.vendorId)); mPos.forEach((x) => vset.add(x.vendorId));
  mInvs.forEach((x) => vset.add(x.vendorId)); mPrs.forEach((x) => vset.add(x.vendorId!));
  mPays.forEach((x) => vset.add(x.paymentRequest.vendorId!)); mSheets.forEach((x) => vset.add(x.purchaseOrder.vendorId));
  mSettles.forEach((x) => vset.add(x.vendorId)); mGrs.forEach((x) => vset.add(x.purchaseOrder.vendorId));
  mVendors.forEach((x) => vset.add(x.id));

  console.log('=== SEPTEMBER 2026 (IST) — direct DB recompute ===');
  console.log(`Active vendors : ${vset.size}`);
  console.log(`Quotations     : ${fmt(sum(mQs, 'grandTotal'))}  (${mQs.length})`);
  console.log(`POs            : ${fmt(sum(mPos, 'grandTotal'))}  (${mPos.length})`);
  console.log(`Invoiced       : ${fmt(sum(mInvs, 'totalAmount'))}  (${mInvs.length})`);
  console.log(`Paid           : ${fmt(paidTotal)}  (payments ${mPays.length}=${fmt(paidFromPayments)}, orphan-PAID PRs=${fmt(paidFromOrphanPRs)}, sheets-paid=${fmt(paidFromSheets)})`);
  console.log(`Outstanding    : ${fmt(Math.max(0, sum(mInvs, 'totalAmount') - paidTotal))}`);
  console.log(`Sheet payable  : ${fmt(sheetPending)}`);
  console.log(`Events         : q=${mQs.length} po=${mPos.length} inv=${mInvs.length} pr=${mPrs.length} pay=${mPays.length} sheet=${mSheets.length} settle=${mSettles.length} gr=${mGrs.length} vendorCreated=${mVendors.length}`);
  console.log('Payments+Sheets count shown on chip:', mPays.length + mSheets.length);

  // breakdown: which PRs are PAID w/o payments (advances marked paid)
  const orphans = mPrs.filter((p) => p.status === 'PAID' && p.payments.length === 0);
  orphans.forEach((o) => console.log('  orphan PAID PR:', o.requestNumber, fmt(Number(o.amount))));
  // pending sheets detail
  mSheets.filter((s2) => s2.status === 'PENDING').forEach((s2) => console.log('  pending sheet:', s2.purchaseOrder.poNumber, fmt(Number(s2.amount)), s2.date.toISOString().slice(0, 10)));
  // non-Sept rows that might be expected
  const otherQs = qs.filter((x) => !inMonth(x.date, M)).map((x) => `${x.quotationNumber}@${x.date.toISOString().slice(0,10)}`);
  const otherPos = pos.filter((x) => !inMonth(x.date, M)).map((x) => `${x.poNumber}@${x.date.toISOString().slice(0,10)}`);
  console.log('Quotations outside Sept:', otherQs.join(', ') || 'none');
  console.log('POs outside Sept:', otherPos.join(', ') || 'none');
  await prisma.$disconnect();
})();
