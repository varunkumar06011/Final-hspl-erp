/**
 * Stock valuation: quantity, average cost and value change together in one SQL UPDATE.
 * The database is mocked; these tests pin the numbers each function sends and the
 * movement it reports (cost per unit, total cost) so value cannot silently drift.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyInbound, applyOutbound, applyOutboundAtCost, applyReturn } from '../src/services/inventory-valuation.service';

/** A fake transaction that records the values passed to $queryRaw and answers with `row`. */
const fakeTx = (row: Record<string, number>, item?: Record<string, number>) => {
  const calls: unknown[][] = [];
  const tx = {
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return [row];
    }),
    inventoryItem: { findUniqueOrThrow: vi.fn(async () => item) },
  };
  return { tx: tx as never, calls };
};

describe('inventory valuation', () => {
  it('inbound: adds quantity × cost to the value and reports the movement at that cost', async () => {
    const { tx, calls } = fakeTx({ currentStock: 150, weightedAvgCost: 420 });
    const moved = await applyInbound(tx, 'item-1', 50, 460);
    expect(calls[0]).toContain(23000); // 50 × ₹460 added to value
    expect(calls[0]).toContain(50);
    expect(moved).toEqual({ balance: 150, unitCost: 460, totalCost: 23000, avgCost: 420 });
  });

  it('inbound never values stock below zero cost', async () => {
    const { tx } = fakeTx({ currentStock: 10, weightedAvgCost: 0 });
    const moved = await applyInbound(tx, 'item-1', 10, -5);
    expect(moved).toMatchObject({ unitCost: 0, totalCost: 0 });
  });

  it('outbound: leaves at the current average cost', async () => {
    const { tx } = fakeTx({ currentStock: 50, weightedAvgCost: 400, unitCost: 400 });
    const moved = await applyOutbound(tx, 'item-1', 50);
    expect(moved).toEqual({ balance: 50, unitCost: 400, totalCost: 20000, avgCost: 400 });
  });

  it('outbound at a known cost: takes value off at that cost, not the average', async () => {
    const { tx, calls } = fakeTx({ currentStock: 55, weightedAvgCost: 403.5 });
    const moved = await applyOutboundAtCost(tx, 'item-1', 15, 400);
    expect(calls[0]).toContain(6000); // 15 × ₹400 taken off
    expect(moved).toMatchObject({ balance: 55, unitCost: 400, totalCost: 6000 });
  });

  it('return: comes back at the item’s current average', async () => {
    const { tx, calls } = fakeTx({ currentStock: 60, weightedAvgCost: 400 }, { weightedAvgCost: 400 });
    const moved = await applyReturn(tx, 'item-1', 10);
    expect(calls[0]).toContain(4000);
    expect(moved).toMatchObject({ unitCost: 400, totalCost: 4000, balance: 60 });
  });
});
