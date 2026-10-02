/**
 * One-off backfill: give stock that was received BEFORE inventory valuation
 * existed a unit cost, so "Total stock value" is correct for old stock too.
 *
 * For every inventory item with stock but no average cost, the cost is taken from
 * the PO unit price of the goods receipts that brought the stock in (weighted by
 * accepted quantity). Items with no PO price (e.g. added by hand) are left at 0
 * and reported, so someone can enter an adjustment/opening entry for them.
 *
 * Dry run by default. Nothing is written unless --apply is passed:
 *   npx tsx prisma/backfill-inventory-valuation.ts            (preview)
 *   npx tsx prisma/backfill-inventory-valuation.ts --apply    (write)
 *
 * It points at whatever DATABASE_URL is in backend/.env, i.e. the shared hosted
 * database. Run the preview first and check the numbers.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null, currentStock: { gt: 0 }, weightedAvgCost: 0 },
    include: { transactions: { where: { type: 'IN', goodsReceiptId: { not: null } } } },
  });

  let updated = 0;
  const unpriced: string[] = [];
  for (const item of items) {
    let qtySum = 0;
    let valueSum = 0;
    const txnCosts: { id: string; unitCost: number; totalCost: number }[] = [];

    for (const txn of item.transactions) {
      const line = await prisma.goodsReceiptItem.findFirst({
        where: { goodsReceiptId: txn.goodsReceiptId!, materialName: { equals: item.name, mode: 'insensitive' } },
        include: { poItem: { select: { unitPrice: true } } },
      });
      const price = line?.poItem ? Number(line.poItem.unitPrice) : 0;
      const qty = Number(txn.quantity);
      qtySum += qty;
      valueSum += qty * price;
      txnCosts.push({ id: txn.id, unitCost: price, totalCost: round2(qty * price) });
    }

    const avg = qtySum > 0 ? round2(valueSum / qtySum) : 0;
    if (avg <= 0) {
      unpriced.push(item.name);
      continue;
    }
    const totalValue = round2(Number(item.currentStock) * avg);
    console.log(`${apply ? 'UPDATE' : 'would update'}  ${item.name}: avg ${avg}, stock ${item.currentStock}, value ${totalValue}`);
    if (apply) {
      await prisma.$transaction([
        prisma.inventoryItem.update({ where: { id: item.id }, data: { weightedAvgCost: avg, totalValue } }),
        ...txnCosts.map((c) =>
          prisma.inventoryTransaction.update({ where: { id: c.id }, data: { unitCost: c.unitCost, totalCost: c.totalCost } }),
        ),
      ]);
    }
    updated += 1;
  }

  console.log(`\n${updated} item(s) ${apply ? 'updated' : 'would be updated'}.`);
  if (unpriced.length) {
    console.log(`${unpriced.length} item(s) have stock but no PO price to derive a cost from:\n  - ${unpriced.join('\n  - ')}`);
  }
  if (!apply) console.log('\nDry run only. Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
