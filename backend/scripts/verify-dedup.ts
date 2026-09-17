import { prisma } from '../src/config/prisma';
const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const inM = (d: Date) => Number(monthFmt.format(d)) - 1 === 8;
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const payments = await prisma.payment.findMany({
    where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null, status: { not: 'DELETED' } } },
    select: { date: true, amount: true, status: true, paymentRequest: { select: { vendorId: true, poId: true } } },
  });
  const sheets = await prisma.paymentSheet.findMany({
    where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' }, purchaseOrder: { status: { not: 'DELETED' } } },
    select: { date: true, amount: true, status: true, poId: true, purchaseOrder: { select: { vendorId: true, poNumber: true } } },
  });
  // mirror route logic
  const coverage = new Map<string, number>();
  const cover = (poId: string | null | undefined, amt: number) => { if (!poId) return; const k = `${poId}|${amt}`; coverage.set(k, (coverage.get(k) ?? 0) + 1); };
  const consume = (poId: string | null | undefined, amt: number) => { if (!poId) return false; const k = `${poId}|${amt}`; const n = coverage.get(k) ?? 0; if (n <= 0) return false; coverage.set(k, n - 1); return true; };
  payments.filter((x) => x.status === 'PAID').forEach((x) => cover(x.paymentRequest.poId, Number(x.amount)));
  let paid = 0, sheetOnlyPaid = 0, steelPaid = 0;
  for (const x of payments) if (x.status === 'PAID' && inM(x.date)) { paid += Number(x.amount); if (x.paymentRequest.vendorId) {} }
  for (const s of sheets) {
    if (s.status === 'PENDING' || !inM(s.date)) continue;
    const covered = consume(s.poId, Number(s.amount));
    if (!covered) { sheetOnlyPaid += Number(s.amount); if (s.purchaseOrder.poNumber === 'VGH-PO020') steelPaid += Number(s.amount); }
  }
  const steelPayments = payments.filter((x) => x.status === 'PAID' && inM(x.date) && x.paymentRequest.poId === sheets.find((s) => s.purchaseOrder.poNumber === 'VGH-PO020')?.poId);
  const steelTotal = steelPayments.reduce((s, x) => s + Number(x.amount), 0) + steelPaid;
  console.log(`Sept paid (deduped): ${fmt(paid + sheetOnlyPaid)}  [payments ${fmt(paid)} + uncovered sheets ${fmt(sheetOnlyPaid)}]`);
  console.log(`Steel on Call paid : ${fmt(steelTotal)}  (was showing ${fmt(steelTotal * 2)} before dedup)`);
  await prisma.$disconnect();
})();
