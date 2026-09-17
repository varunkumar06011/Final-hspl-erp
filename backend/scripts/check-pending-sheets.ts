import { prisma } from '../src/config/prisma';
(async () => {
  const p = await prisma.project.findFirst({ where: { name: { contains: 'V Grand' } } });
  const sheets = await prisma.paymentSheet.findMany({
    where: { projectId: p!.id, deletedAt: null },
    select: { id: true, date: true, amount: true, status: true, updatedAt: true, createdAt: true,
      purchaseOrder: { select: { poNumber: true, vendor: { select: { name: true } } } } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  for (const s of sheets) {
    console.log(`${s.date.toISOString().slice(0,10)} ${String(s.amount).padStart(10)} ${s.status.padEnd(8)} ${s.purchaseOrder.poNumber} ${s.purchaseOrder.vendor.name.slice(0,28)} | created ${s.createdAt.toISOString().slice(0,16)} updated ${s.updatedAt.toISOString().slice(0,16)} id=${s.id.slice(0,8)}`);
  }
  const pend = sheets.filter((x) => x.status === 'PENDING');
  console.log(`\nStill PENDING: ${pend.length} entries, ₹${pend.reduce((s, x) => s + Number(x.amount), 0).toLocaleString('en-IN')}`);
  await prisma.$disconnect();
})();
