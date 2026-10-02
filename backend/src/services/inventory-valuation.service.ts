import { Prisma } from '@prisma/client';

/**
 * Weighted-average inventory valuation.
 *
 * Every stock movement goes through one of these helpers so quantity, average
 * cost and total value always change together, in one atomic UPDATE (the new
 * values are computed by the database from the row's current values, so two
 * concurrent receipts/issues cannot overwrite each other).
 */

export interface ValuedMovement {
  /** Stock after the movement. */
  balance: number;
  /** Unit cost the movement was recorded at (purchase price for IN, average for OUT). */
  unitCost: number;
  /** quantity * unitCost. */
  totalCost: number;
  /** Weighted average cost per unit after the movement. */
  avgCost: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface ValuationRow {
  currentStock: Prisma.Decimal | number;
  weightedAvgCost: Prisma.Decimal | number;
}

/** Inbound stock at a known unit cost (goods receipt, direct entry). */
export async function applyInbound(
  tx: Prisma.TransactionClient,
  itemId: string,
  quantity: number,
  unitCost: number,
): Promise<ValuedMovement> {
  const qty = Math.abs(quantity);
  const cost = Math.max(0, unitCost);
  const addValue = qty * cost;
  const rows = await tx.$queryRaw<ValuationRow[]>`
    UPDATE "inventory_items"
    SET "totalValue" = ROUND(COALESCE("totalValue", 0) + ${addValue}::numeric, 2),
        "currentStock" = "currentStock" + ${qty}::numeric,
        "weightedAvgCost" = CASE
          WHEN "currentStock" + ${qty}::numeric > 0
            THEN ROUND((COALESCE("totalValue", 0) + ${addValue}::numeric) / ("currentStock" + ${qty}::numeric), 2)
          ELSE "weightedAvgCost" END,
        "updatedAt" = NOW()
    WHERE "id" = ${itemId}::uuid
    RETURNING "currentStock", "weightedAvgCost"`;
  const row = rows[0];
  return {
    balance: Number(row.currentStock),
    unitCost: cost,
    totalCost: round2(addValue),
    avgCost: Number(row.weightedAvgCost),
  };
}

/** Inbound stock at the item's current average (returns to store): value follows the average. */
export async function applyReturn(
  tx: Prisma.TransactionClient,
  itemId: string,
  quantity: number,
): Promise<ValuedMovement> {
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { weightedAvgCost: true },
  });
  return applyInbound(tx, itemId, quantity, Number(item.weightedAvgCost));
}

/** Outbound stock, valued at the current weighted average. Caller checks availability first. */
export async function applyOutbound(
  tx: Prisma.TransactionClient,
  itemId: string,
  quantity: number,
): Promise<ValuedMovement> {
  const qty = Math.abs(quantity);
  const rows = await tx.$queryRaw<(ValuationRow & { unitCost: Prisma.Decimal | number })[]>`
    UPDATE "inventory_items" AS i
    SET "currentStock" = i."currentStock" - ${qty}::numeric,
        "totalValue" = CASE
          WHEN i."currentStock" - ${qty}::numeric <= 0 THEN 0
          ELSE GREATEST(0, ROUND(COALESCE(i."totalValue", 0) - ${qty}::numeric * i."weightedAvgCost", 2)) END,
        "updatedAt" = NOW()
    WHERE i."id" = ${itemId}::uuid
    RETURNING i."currentStock", i."weightedAvgCost", i."weightedAvgCost" AS "unitCost"`;
  const row = rows[0];
  const unitCost = Number(row.unitCost);
  return {
    balance: Number(row.currentStock),
    unitCost,
    totalCost: round2(qty * unitCost),
    avgCost: Number(row.weightedAvgCost),
  };
}

/** Admin stock-count correction: sets the quantity, keeps the average, re-derives the value. */
export async function applyAdjustment(
  tx: Prisma.TransactionClient,
  itemId: string,
  newStock: number,
): Promise<ValuedMovement & { previousStock: number }> {
  const before = await tx.inventoryItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { currentStock: true, weightedAvgCost: true },
  });
  const avg = Number(before.weightedAvgCost);
  await tx.inventoryItem.update({
    where: { id: itemId },
    data: { currentStock: newStock, totalValue: round2(newStock * avg) },
  });
  const delta = newStock - Number(before.currentStock);
  return {
    previousStock: Number(before.currentStock),
    balance: newStock,
    unitCost: avg,
    totalCost: round2(Math.abs(delta) * avg),
    avgCost: avg,
  };
}
