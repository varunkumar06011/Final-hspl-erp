/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Daily site material slips. The user's example: 100 bags of cement in stock,
 * 50 taken to site in the morning → stock 50, 50 at site. Evening: 40 used,
 * 10 returned → stock 60, 40 used today. Prisma and the valuation SQL are mocked
 * with a tiny in-memory stock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    stock: new Map<string, number>(),
    items: [] as any[],
    slips: [] as any[],
    lines: [] as any[],
    txns: [] as any[],
  },
}));

vi.mock('../src/services/sequence.service', () => ({
  generateProjectSequenceNumber: vi.fn(async () => `VGH-SLIP00${db.slips.length + 1}`),
}));
vi.mock('../src/services/inventory-valuation.service', () => ({
  applyOutbound: vi.fn(async (_tx: any, itemId: string, qty: number) => {
    db.stock.set(itemId, (db.stock.get(itemId) ?? 0) - qty);
    return { balance: db.stock.get(itemId), unitCost: 400, totalCost: qty * 400, avgCost: 400 };
  }),
  applyReturn: vi.fn(async (_tx: any, itemId: string, qty: number) => {
    db.stock.set(itemId, (db.stock.get(itemId) ?? 0) + qty);
    return { balance: db.stock.get(itemId), unitCost: 400, totalCost: qty * 400, avgCost: 400 };
  }),
}));
vi.mock('../src/config/prisma', () => {
  const withLines = (s: any) => ({
    ...s,
    takenBy: { id: s.takenById, name: 'Ravi' },
    lines: db.lines.filter((l) => l.slipId === s.id).map((l) => ({ ...l, inventoryItem: db.items.find((i) => i.id === l.inventoryItemId) })),
  });
  const client: any = {
    inventoryItem: {
      findMany: vi.fn(async ({ where }: any) =>
        db.items.filter((i) => where.id.in.includes(i.id)).map((i) => ({ ...i, currentStock: db.stock.get(i.id) })),
      ),
    },
    siteMaterialSlip: {
      findFirst: vi.fn(async ({ where }: any) => {
        const s = db.slips.find((x) => (where.id ? x.id === where.id : x.takenById === where.takenById && x.status === where.status));
        return s ? withLines(s) : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const s = { id: `slip-${db.slips.length + 1}`, status: 'OPEN', ...data };
        db.slips.push(s);
        return s;
      }),
      update: vi.fn(async ({ where }: any) => db.slips.find((x) => x.id === where.id)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = db.slips.find((x) => x.id === where.id && x.status === where.status);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => withLines(db.slips.find((x) => x.id === where.id))),
      findMany: vi.fn(async () => db.slips.map(withLines)),
      count: vi.fn(async () => 0),
    },
    siteMaterialSlipLine: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.slipId_inventoryItemId;
        const l = db.lines.find((x) => x.slipId === key.slipId && x.inventoryItemId === key.inventoryItemId);
        if (l) l.takenQty += update.takenQty.increment;
        else db.lines.push({ id: `line-${db.lines.length + 1}`, usedQty: null, returnedQty: null, ...create });
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.lines.find((x) => x.id === where.id), data)),
    },
    inventoryTransaction: { create: vi.fn(async ({ data }: any) => db.txns.push(data)) },
  };
  client.$transaction = vi.fn(async (fn: any) => fn(client));
  return { prisma: client };
});

import { takeMaterial, closeSlip, listSlips, siteToday, usageHistory, SlipError } from '../src/services/site-slip.service';

const ravi = { id: 'u-ravi', name: 'Ravi', role: 'SITE_SUPERVISOR' };
const other = { id: 'u-x', name: 'X', role: 'SITE_SUPERVISOR' };

describe('site material slips', () => {
  beforeEach(() => {
    db.items = [{ id: 'cement', name: 'Cement', unit: 'bags', itemType: 'CONSUMABLE' }];
    db.stock = new Map([['cement', 100]]);
    db.slips = [];
    db.lines = [];
    db.txns = [];
  });

  it('morning: taking 50 of 100 bags leaves 50 in stock and 50 at site', async () => {
    const slip = await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 50 }], work: 'Slab' });
    expect(db.stock.get('cement')).toBe(50);
    expect(slip.lines[0]).toMatchObject({ takenQty: 50, usedQty: null });
    expect(db.txns[0]).toMatchObject({ type: 'OUT', quantity: 50, purpose: 'Taken to site', issuedTo: 'Ravi' });

    const day = await listSlips('p', siteToday());
    expect(day.totals[0]).toMatchObject({ name: 'Cement', taken: 50, open: 50, used: 0 });
  });

  it('evening: 40 used + 10 returned puts stock at 60 and shows 40 used today', async () => {
    const slip = await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 50 }] });
    const closed = await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    expect(closed.status).toBe('CLOSED');
    expect(db.stock.get('cement')).toBe(60);
    expect(db.txns[1]).toMatchObject({ type: 'RETURN', quantity: 10 });

    const day = await listSlips('p', siteToday());
    expect(day.totals[0]).toMatchObject({ taken: 50, used: 40, returned: 10, open: 0 });
  });

  it('day-wise usage shows 40 used on the day, and the range total', async () => {
    const slip = await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 50 }] });
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    const day = siteToday();
    const h = await usageHistory('p', new Date(day.getTime() - 6 * 86_400_000), day);
    expect(h.days).toEqual([
      expect.objectContaining({ date: day.toISOString().slice(0, 10), name: 'Cement', taken: 50, used: 40, returned: 10, open: 0 }),
    ]);
    expect(h.totals[0]).toMatchObject({ used: 40, returned: 10 });
    await expect(usageHistory('p', day, new Date(day.getTime() - 86_400_000))).rejects.toBeInstanceOf(SlipError);
  });

  it('taking more the same day adds to the same slip', async () => {
    await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 20 }] });
    await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 15 }] });
    expect(db.slips).toHaveLength(1);
    expect(db.lines[0].takenQty).toBe(35);
    expect(db.stock.get('cement')).toBe(65);
  });

  it('refuses taking more than the store has', async () => {
    await expect(takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 120 }] })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(db.stock.get('cement')).toBe(100);
  });

  it('used + returned must equal taken; slip closes once; only the taker or a head', async () => {
    const slip = await takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity: 50 }] });
    const lineId = slip.lines[0].id;
    await expect(closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 5 }] })).rejects.toMatchObject({ code: 'SLIP_MISMATCH' });
    await expect(closeSlip('p', other, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] })).rejects.toMatchObject({ status: 403 });
    await closeSlip('p', { id: 'u-head', name: 'Head', role: 'PROJECT_HEAD' }, slip.id, { lines: [{ lineId, usedQty: 50, returnedQty: 0 }] });
    expect(db.stock.get('cement')).toBe(50);
    await expect(closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 50, returnedQty: 0 }] })).rejects.toBeInstanceOf(SlipError);
  });
});
