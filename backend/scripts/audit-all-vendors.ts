import { prisma } from '../src/config/prisma';
const IST = 'Asia/Kolkata';
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, month: 'numeric' });
const inM = (d: Date) => Number(monthFmt.format(d)) - 1 === 8;
const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const pid = p!.id;
  const [pos, pays, sheets, prs] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' } }, select: { vendorId: true, date: true, grandTotal: true, netPayable: true, poNumber: true } }),
    prisma.payment.findMany({ where: { paymentRequest: { projectId: pid, vendorId: { not: null }, deletedAt: null, status: { not: 'DELETED' } } }, select: { date: true, amount: true, status: true, paymentRequest: { select: { vendorId: true, poId: true } } } }),
    prisma.paymentSheet.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' }, purchaseOrder: { status: { not: 'DELETED' } } }, select: { date: true, amount: true, status: true, poId: true, purchaseOrder: { select: { vendorId: true } } } }),
    prisma.paymentRequest.findMany({ where: { projectId: pid, deletedAt: null, status: { not: 'DELETED' }, vendorId: { not: null } }, select: { vendorId: true, createdAt: true, amount: true, status: true, poId: true, payments: { select: { id: true } } } }),
  ]);
  const vNames = new Map((await prisma.vendor.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));

  // coverage multiset (payments + orphan PRs)
  const cov = new Map<string, number>();
  const cover = (k: string) => cov.set(k, (cov.get(k) ?? 0) + 1);
  const consume = (k: string) => { const n = cov.get(k) ?? 0; if (n <= 0) return false; cov.set(k, n - 1); return true; };
  pays.filter((x) => x.status === 'PAID').forEach((x) => cover(`${x.paymentRequest.poId}|${Number(x.amount)}`));
  prs.filter((x) => x.status === 'PAID' && x.payments.length === 0).forEach((x) => cover(`${x.poId}|${Number(x.amount)}`));

  const vAgg = new Map<string, { po: number; paid: number; sheetOnly: number }>();
  const add = (vid: string, k: 'po' | 'paid' | 'sheetOnly', n: number) => { const a = vAgg.get(vid) ?? { po: 0, paid: 0, sheetOnly: 0 }; a[k] += n; vAgg.set(vid, a); };
  pos.filter((x) => inM(x.date)).forEach((x) => add(x.vendorId, 'po', Number(x.netPayable) > 0 ? Number(x.netPayable) : Number(x.grandTotal)));
  pays.filter((x) => inM(x.date) && x.status === 'PAID').forEach((x) => add(x.paymentRequest.vendorId!, 'paid', Number(x.amount)));
  prs.filter((x) => inM(x.createdAt) && x.status === 'PAID' && x.payments.length === 0).forEach((x) => add(x.vendorId!, 'paid', Number(x.amount)));
  for (const s of sheets) {
    if (!inM(s.date) || s.status === 'PENDING') continue;
    if (!consume(`${s.poId}|${Number(s.amount)}`)) { add(s.purchaseOrder.vendorId, 'paid', Number(s.amount)); add(s.purchaseOrder.vendorId, 'sheetOnly', Number(s.amount)); }
  }
  console.log('=== VENDOR SEPT AUDIT (deduped) ===');
  for (const [vid, a] of vAgg) {
    const flag = a.paid > a.po ? '  ⚠️ PAID > PO' : '';
    console.log(`${(vNames.get(vid) ?? vid).slice(0, 34).padEnd(36)} PO ${fmt(a.po).padStart(13)}  Paid ${fmt(a.paid).padStart(13)}  sheetOnly ${fmt(a.sheetOnly)}${flag}`);
  }
  // payments duplicated within Payment records themselves (same po+amount twice)
  const dupCheck = new Map<string, number>();
  pays.forEach((x) => { const k = `${x.paymentRequest.poId}|${Number(x.amount)}`; dupCheck.set(k, (dupCheck.get(k) ?? 0) + 1); });
  const dups = [...dupCheck].filter(([, n]) => n > 1);
  console.log('\nDuplicate payment records (same PO+amount>1):', dups.length ? dups : 'none');
  await prisma.$disconnect();
})();
