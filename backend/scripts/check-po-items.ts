import { prisma } from '../src/config/prisma';
(async () => {
  const pos = await prisma.purchaseOrder.findMany({ where: { poNumber: { in: ['VGH-PO010', 'VGH-PO011', 'VGH-PO012'] } }, include: { items: true } });
  for (const p of pos) {
    const itemSum = p.items.reduce((s, i) => s + Number(i.amount), 0);
    console.log(p.poNumber, 'status:', p.status, 'grandTotal:', String(p.grandTotal), 'itemsSum:', itemSum, 'items:', p.items.map(i => `${i.materialName}:${i.quantity}x${i.unitPrice}`).join(', '));
  }
  await prisma.$disconnect();
})();
