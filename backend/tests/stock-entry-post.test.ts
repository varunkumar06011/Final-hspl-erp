/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Stock entries without a PO (opening stock, cash buys, returns from site...): when an
 * entry is approved, postEntry puts every line into stock at its own unit cost, on the
 * matching stock item (or a new one), with an IN movement tied to the entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { found, inbound } = vi.hoisted(() => ({
  found: new Map<string, any>(),
  inbound: [] as any[],
}));

vi.mock('../src/config/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/inventory-match.service', () => ({
  findInventoryItemForMaterial: vi.fn(async (_tx: any, _p: string, name: string) => found.get(name) ?? null),
  materialCodeForName: vi.fn(async () => 'VGH-MAT-0001'),
}));
vi.mock('../src/services/inventory-valuation.service', () => ({
  applyInbound: vi.fn(async (_tx: any, itemId: string, qty: number, cost: number) => {
    inbound.push({ itemId, qty, cost });
    return { balance: qty, unitCost: cost, totalCost: qty * cost, avgCost: cost };
  }),
}));
vi.mock('../src/routes/asset.routes', () => ({ generateAssetId: vi.fn(async () => 'AST-1') }));

import { postEntry } from '../src/routes/stock-entry.routes';

const entry = (items: any[]) => ({
  id: 'se-1',
  projectId: 'p',
  entryNumber: 'VGH-SE001',
  sourceType: 'CASH_PURCHASE',
  supplierName: 'Local shop',
  referenceNo: 'B-12',
  items,
});
const line = (over: Record<string, unknown>) => ({
  id: 'l', materialName: 'Cement', itemId: null, specification: null, unit: 'bags', quantity: 20, unitCost: 410, itemType: 'CONSUMABLE', category: null, ...over,
});

describe('posting a stock entry', () => {
  let tx: any;
  beforeEach(() => {
    found.clear();
    inbound.length = 0;
    tx = {
      inventoryItem: {
        create: vi.fn(async ({ data }: any) => ({ id: 'new-item', ...data })),
        findMany: vi.fn(async () => []),
      },
      inventoryTransaction: { create: vi.fn(async () => ({})) },
      catalogItem: { findUnique: vi.fn(async () => null) },
      asset: { create: vi.fn() },
      assetMovement: { create: vi.fn() },
    };
  });

  it('adds each line to the matching stock item at its own cost, with an IN tied to the entry', async () => {
    found.set('Cement', { id: 'cement', itemType: 'CONSUMABLE' });
    await postEntry(tx, entry([line({})]) as any, { id: 'u1', name: 'Head' });
    expect(inbound).toEqual([{ itemId: 'cement', qty: 20, cost: 410 }]);
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ itemId: 'cement', stockEntryId: 'se-1', type: 'IN', quantity: 20, unitCost: 410, totalCost: 8200 }),
    });
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('creates the stock item when the material is not in stock yet', async () => {
    await postEntry(tx, entry([line({ materialName: 'River sand', unit: 'cft', quantity: 100, unitCost: 60 })]) as any, { id: 'u1', name: 'Head' });
    expect(tx.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p', name: 'River sand', unit: 'cft', itemType: 'CONSUMABLE', currentStock: 0 }),
    });
    expect(inbound).toEqual([{ itemId: 'new-item', qty: 100, cost: 60 }]);
  });

  it('refuses a line whose stock type differs from the existing item, and a fractional asset', async () => {
    found.set('Cement', { id: 'cement', itemType: 'ASSET' });
    await expect(postEntry(tx, entry([line({})]) as any, { id: 'u1', name: 'Head' })).rejects.toThrow(/already exists in inventory as asset/);
    await expect(
      postEntry(tx, entry([line({ materialName: 'Mixer', itemType: 'ASSET', quantity: 1.5 })]) as any, { id: 'u1', name: 'Head' }),
    ).rejects.toThrow(/whole-number/);
    expect(inbound).toEqual([]);
  });
});
