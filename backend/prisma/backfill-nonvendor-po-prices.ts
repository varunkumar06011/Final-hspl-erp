/**
 * One-off: non-vendor POs raised from an approved MPR were created at ₹0 instead of
 * inheriting the MPR's rates. This copies the MPR item rates onto the PO lines of the
 * given PO numbers and recomputes the totals.
 *
 * Only POs that are still PENDING_APPROVAL are touched (nothing has been booked to
 * the budget or ledger yet), and only lines whose price is still 0.
 *
 *   npx tsx prisma/backfill-nonvendor-po-prices.ts VGH-PO045 VGH-PO046 ...         (dry run)
 *   npx tsx prisma/backfill-nonvendor-po-prices.ts --apply VGH-PO045 VGH-PO046 ...
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const numbers = args.filter((a) => !a.startsWith('--'));
  if (numbers.length === 0) throw new Error('Pass the PO numbers to fix');

  for (const poNumber of numbers) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { poNumber, deletedAt: null },
      include: { items: true, mpr: { include: { items: true } } },
    });
    if (!po) { console.log(`${poNumber}: not found`); continue; }
    if (!po.mpr) { console.log(`${poNumber}: no MPR linked, skipped`); continue; }
    if (po.status !== 'PENDING_APPROVAL') { console.log(`${poNumber}: status ${po.status}, skipped`); continue; }

    const rateByName = new Map(po.mpr.items.map((i) => [i.materialName, Number(i.estimatedRate)]));
    let total = 0;
    const updates: { id: string; unitPrice: number; amount: number }[] = [];
    for (const it of po.items) {
      let unitPrice = Number(it.unitPrice);
      if (unitPrice === 0) unitPrice = rateByName.get(it.materialName) ?? 0;
      const amount = r2(Number(it.quantity) * unitPrice);
      total += amount * (1 + Number(it.gstRate ?? 0) / 100);
      updates.push({ id: it.id, unitPrice, amount });
    }
    const totalAmount = r2(updates.reduce((s, u) => s + u.amount, 0));
    const grandTotal = r2(total);
    console.log(`${poNumber} (${po.mpr.mprNumber}): ${po.items.length} lines, ${Number(po.grandTotal)} -> ${grandTotal}`);

    if (apply && grandTotal > 0) {
      await prisma.$transaction([
        ...updates.map((u) => prisma.pOItem.update({ where: { id: u.id }, data: { unitPrice: u.unitPrice, amount: u.amount } })),
        prisma.purchaseOrder.update({
          where: { id: po.id },
          data: { totalAmount, gstAmount: r2(grandTotal - totalAmount), grandTotal, netPayable: grandTotal },
        }),
      ]);
    }
  }
  console.log(apply ? 'Applied.' : 'Dry run only. Re-run with --apply to save.');
}

main().finally(() => prisma.$disconnect());
