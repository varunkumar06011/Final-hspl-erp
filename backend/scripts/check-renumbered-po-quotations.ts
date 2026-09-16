import { prisma } from '../src/config/prisma';

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: ['VGH-PO019', 'VGH-PO020', 'VGH-PO021'] } },
    select: {
      poNumber: true, quotationId: true,
      quotation: { select: { id: true, quotationNumber: true, status: true, deletedAt: true, grandTotal: true } },
    },
    orderBy: { poNumber: 'asc' },
  });
  for (const p of pos) {
    console.log(`${p.poNumber} -> quotation ${p.quotation?.quotationNumber ?? 'NONE'} (id=${p.quotationId}) status=${p.quotation?.status} deleted=${p.quotation?.deletedAt ?? 'null'} total=${p.quotation?.grandTotal}`);
  }
  // surrounding quotation numbers for context
  const qs = await prisma.quotation.findMany({
    where: { quotationNumber: { in: ['VGH-Q018','VGH-Q019','VGH-Q020','VGH-Q021','VGH-Q022','VGH-Q023','VGH-Q024'] } },
    select: { quotationNumber: true, status: true, grandTotal: true },
    orderBy: { quotationNumber: 'asc' },
  });
  console.log('\nAll quotations Q018-Q024:');
  for (const q of qs) console.log(` ${q.quotationNumber} status=${q.status} total=${q.grandTotal}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
