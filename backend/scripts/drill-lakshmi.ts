import { prisma } from '../src/config/prisma';
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const v = await prisma.vendor.findFirst({ where: { name: { contains: 'Lakshmi Anjana' } } });
  if (!v) { console.log('vendor not found'); return; }
  console.log(`Vendor: ${v.name} (${v.vendorCode})`);
  const pos = await prisma.purchaseOrder.findMany({
    where: { vendorId: v.id },
    select: { id: true, poNumber: true, grandTotal: true, netPayable: true, totalDeductions: true, advanceAmount: true, status: true, date: true, deletedAt: true },
  });
  for (const p of pos) {
    console.log(`\nPO ${p.poNumber} status=${p.status} deletedAt=${p.deletedAt?.toISOString().slice(0,10) ?? 'null'} date=${p.date.toISOString().slice(0,10)}`);
    console.log(`  grandTotal=${fmt(Number(p.grandTotal))} deductions=${fmt(Number(p.totalDeductions))} netPayable=${fmt(Number(p.netPayable))} advance=${p.advanceAmount ?? '-'}`);
    const prs = await prisma.paymentRequest.findMany({
      where: { OR: [{ poId: p.id }, { requestNumber: { contains: p.poNumber } }] },
      select: { requestNumber: true, amount: true, status: true, type: true, poId: true, vendorId: true, deletedAt: true,
        payments: { select: { amount: true, date: true, status: true } } },
    });
    prs.forEach((pr) => {
      console.log(`  PR ${pr.requestNumber} ${fmt(Number(pr.amount))} ${pr.status} poId=${pr.poId ? 'set' : 'NULL'} deleted=${pr.deletedAt ? 'YES' : 'no'}`);
      pr.payments.forEach((pay) => console.log(`    └ payment ${fmt(Number(pay.amount))} ${pay.date.toISOString().slice(0,10)} ${pay.status}`));
    });
    const sheets = await prisma.paymentSheet.findMany({
      where: { poId: p.id },
      select: { date: true, amount: true, status: true, deletedAt: true },
    });
    sheets.forEach((s) => console.log(`  Sheet ${s.date.toISOString().slice(0,10)} ${fmt(Number(s.amount))} ${s.status} deleted=${s.deletedAt ? 'YES' : 'no'}`));
  }
  // anything else linked to vendor?
  const allPrs = await prisma.paymentRequest.findMany({ where: { vendorId: v.id }, select: { requestNumber: true, amount: true, status: true, poId: true, payments: { select: { amount: true, status: true } } } });
  console.log('\nAll PRs for vendor:', allPrs.map((x) => `${x.requestNumber}:${x.status}:${fmt(Number(x.amount))}:poId=${x.poId?'Y':'N'}`).join(' | '));
  await prisma.$disconnect();
})();
