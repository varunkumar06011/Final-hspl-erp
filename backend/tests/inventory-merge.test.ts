import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = vi.hoisted(() => ({
  inventoryItem: { findFirst: vi.fn(), update: vi.fn() },
  inventoryTransaction: { updateMany: vi.fn() },
  asset: { updateMany: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  inventoryItem: { findMany: vi.fn() },
  materialPurchaseRequestItem: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: prismaMock }));

import { mergeInventoryItems, findDuplicateGroups } from '../src/services/inventory-match.service';

const item = (over: Record<string, unknown>) => ({
  id: 'x', name: 'Cement', sku: 'CON-0001', materialCode: null, aliases: [], unit: 'bag', itemType: 'CONSUMABLE',
  category: 'CONSUMABLE', location: null, currentStock: 10, totalValue: 1000, weightedAvgCost: 100, minStockLevel: 0, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('mergeInventoryItems', () => {
  it('moves history, adds stock and value, retires the source and remembers its name', async () => {
    tx.inventoryItem.findFirst
      .mockResolvedValueOnce(item({ id: 'src', name: 'Cemnt', materialCode: 'VGH-MAT-0007', currentStock: 5, totalValue: 400 }))
      .mockResolvedValueOnce(item({ id: 'tgt', name: 'Cement', currentStock: 10, totalValue: 1000 }));
    tx.inventoryTransaction.updateMany.mockResolvedValue({ count: 3 });
    tx.asset.updateMany.mockResolvedValue({ count: 0 });
    tx.inventoryItem.update.mockImplementation(async ({ data }: { data: unknown }) => data);

    const res = await mergeInventoryItems('p1', 'src', 'tgt');

    expect(tx.inventoryTransaction.updateMany).toHaveBeenCalledWith({ where: { itemId: 'src' }, data: { itemId: 'tgt' } });
    const targetUpdate = tx.inventoryItem.update.mock.calls[0][0].data;
    expect(targetUpdate.currentStock).toBe(15);
    expect(targetUpdate.totalValue).toBe(1400);
    expect(targetUpdate.weightedAvgCost).toBe(93.33);
    expect(targetUpdate.materialCode).toBe('VGH-MAT-0007');
    expect(targetUpdate.aliases).toEqual(expect.arrayContaining(['cemnt', 'vgh-mat-0007']));
    const sourceUpdate = tx.inventoryItem.update.mock.calls[1][0].data;
    expect(sourceUpdate.currentStock).toBe(0);
    expect(sourceUpdate.deletedAt).toBeInstanceOf(Date);
    expect(res.summary.movedTransactions).toBe(3);
  });

  it('refuses to merge an asset into a consumable, or an item into itself', async () => {
    tx.inventoryItem.findFirst
      .mockResolvedValueOnce(item({ id: 'a', itemType: 'ASSET' }))
      .mockResolvedValueOnce(item({ id: 'b', itemType: 'CONSUMABLE' }));
    await expect(mergeInventoryItems('p1', 'a', 'b')).rejects.toThrow(/Cannot merge/);
    await expect(mergeInventoryItems('p1', 'a', 'a')).rejects.toThrow(/different items/);
  });
});

describe('findDuplicateGroups', () => {
  it('groups misspelt names and same-code items, but not different materials', async () => {
    const row = (id: string, name: string, materialCode: string | null, itemType = 'CONSUMABLE') => ({
      id, name, sku: null, materialCode, unit: 'nos', itemType, category: null, currentStock: 1, totalValue: 1, _count: { transactions: 1 },
    });
    prismaMock.inventoryItem.findMany.mockResolvedValue([
      row('1', 'Cement', null), row('2', 'Cemnt', null), row('3', 'River Sand', null),
      row('4', 'Steel TMT 12mm', 'C-1'), row('5', 'TMT Bar 12', 'C-1'), row('6', 'Cement', null, 'ASSET'), row('7', 'TMT 16mm', null), row('8', 'TMT 12mm', null),
    ]);
    prismaMock.materialPurchaseRequestItem.findMany.mockResolvedValue([]);
    const groups = await findDuplicateGroups('p1');
    const names = groups.map((g) => g.map((i) => i.id).sort().join(','));
    expect(names).toContain('1,2');
    expect(names).toContain('4,5');
    expect(names.some((n) => n.includes('3'))).toBe(false);
    expect(names.some((n) => n.includes('7'))).toBe(false);
    expect(names.some((n) => n.includes('6'))).toBe(false);
  });
});
