/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Daily site material slips. The user's example: 100 bags of cement in stock,
 * 50 taken to site in the morning → stock 50, 50 at site. Evening: 40 used,
 * 10 returned → stock 60, 40 used today. Prisma is mocked with a tiny in-memory
 * store; the valuation functions keep quantity and value so price drift shows up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { db } = vi.hoisted(() => ({
  db: {
    stock: new Map<string, number>(),
    value: new Map<string, number>(),
    items: [] as any[],
    slips: [] as any[],
    lines: [] as any[],
    txns: [] as any[],
    raceOnce: false,
  },
}));

vi.mock('../src/services/sequence.service', () => ({
  generateProjectSequenceNumber: vi.fn(async () => `VGH-SLIP00${db.slips.length + 1}`),
}));
vi.mock('../src/services/inventory-valuation.service', () => {
  const avg = (id: string) => ((db.stock.get(id) ?? 0) > 0 ? (db.value.get(id) ?? 0) / (db.stock.get(id) ?? 1) : 0);
  const move = (id: string, qty: number, cost: number) => {
    db.stock.set(id, (db.stock.get(id) ?? 0) + qty);
    db.value.set(id, (db.value.get(id) ?? 0) + qty * cost);
    return { balance: db.stock.get(id), unitCost: cost, totalCost: Math.abs(qty) * cost, avgCost: avg(id) };
  };
  return {
    applyOutbound: vi.fn(async (_tx: any, id: string, qty: number) => move(id, -qty, avg(id))),
    applyOutboundAtCost: vi.fn(async (_tx: any, id: string, qty: number, cost: number) => move(id, -qty, cost)),
    applyInbound: vi.fn(async (_tx: any, id: string, qty: number, cost: number) => move(id, qty, cost)),
  };
});
vi.mock('../src/config/prisma', () => {
  const withLines = (s: any) => ({
    ...s,
    takenBy: { id: s.takenById, name: 'Ravi' },
    phase: s.phaseId ? { id: s.phaseId, name: 'Slab' } : null,
    budgetHead: null,
    lines: db.lines
      .filter((l) => l.slipId === s.id)
      .map((l) => ({ ...l, inventoryItem: { ...db.items.find((i) => i.id === l.inventoryItemId), weightedAvgCost: 0 } })),
  });
  const client: any = {
    inventoryItem: {
      findMany: vi.fn(async ({ where }: any) =>
        db.items.filter((i) => where.id.in.includes(i.id)).map((i) => ({ ...i, currentStock: db.stock.get(i.id) })),
      ),
    },
    phase: { findFirst: vi.fn(async ({ where }: any) => (where.id === 'ph-slab' ? { id: 'ph-slab' } : null)) },
    budgetHead: { findFirst: vi.fn(async () => null) },
    siteMaterialSlip: {
      findFirst: vi.fn(async ({ where }: any) => {
        const s = db.slips.find((x) => (where.id ? x.id === where.id : x.takenById === where.takenById && x.status === where.status));
        return s ? withLines(s) : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        if (db.raceOnce) {
          // A second request (double-tap) created today's slip a moment earlier.
          db.raceOnce = false;
          db.slips.push({ id: 'slip-winner', status: 'OPEN', ...data, slipNumber: 'VGH-SLIP-W' });
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const s = { id: `slip-${db.slips.length + 1}`, status: 'OPEN', ...data };
        db.slips.push(s);
        return s;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.slips.find((x) => x.id === where.id), data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = db.slips.find((x) => x.id === where.id && x.status === where.status);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => withLines(db.slips.find((x) => x.id === where.id))),
      findMany: vi.fn(async () => db.slips.map(withLines)),
    },
    siteMaterialSlipLine: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const key = where.slipId_inventoryItemId;
        const l = db.lines.find((x) => x.slipId === key.slipId && x.inventoryItemId === key.inventoryItemId);
        if (l) {
          l.takenQty += update.takenQty.increment;
          l.takenValue += update.takenValue.increment;
        } else db.lines.push({ id: `line-${db.lines.length + 1}`, usedQty: null, returnedQty: null, ...create });
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(db.lines.find((x) => x.id === where.id), data)),
    },
    inventoryTransaction: { create: vi.fn(async ({ data }: any) => db.txns.push(data)) },
  };
  client.$transaction = vi.fn(async (fn: any) => fn(client));
  return { prisma: client };
});

import { takeMaterial, closeSlip, correctSlip, listSlips, siteToday, usageHistory, SlipError } from '../src/services/site-slip.service';

const ravi = { id: 'u-ravi', name: 'Ravi', role: 'SITE_SUPERVISOR' };
const other = { id: 'u-x', name: 'X', role: 'SITE_SUPERVISOR' };
const head = { id: 'u-head', name: 'Head', role: 'PROJECT_HEAD' };
const take = (quantity: number, extra: Record<string, unknown> = { work: 'Slab' }) =>
  takeMaterial('p', ravi, { lines: [{ itemId: 'cement', quantity }], ...extra });

describe('site material slips', () => {
  beforeEach(() => {
    db.items = [{ id: 'cement', name: 'Cement', unit: 'bags', itemType: 'CONSUMABLE' }];
    db.stock = new Map([['cement', 100]]);
    db.value = new Map([['cement', 40000]]); // ₹400 a bag
    db.slips = [];
    db.lines = [];
    db.txns = [];
    db.raceOnce = false;
  });

  it('morning: taking 50 of 100 bags leaves 50 in stock and 50 at site', async () => {
    const slip = await take(50);
    expect(db.stock.get('cement')).toBe(50);
    expect(slip.lines[0]).toMatchObject({ takenQty: 50, usedQty: null, takenValue: 20000 });
    expect(db.txns[0]).toMatchObject({ type: 'OUT', quantity: 50, purpose: 'Taken to site', issuedTo: 'Ravi' });

    const day = await listSlips('p', siteToday());
    expect(day.totals[0]).toMatchObject({ name: 'Cement', taken: 50, open: 50, used: 0 });
  });

  it('evening: 40 used + 10 returned puts stock at 60 and shows 40 used today', async () => {
    const slip = await take(50);
    const closed = await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    expect(closed.status).toBe('CLOSED');
    expect(db.stock.get('cement')).toBe(60);
    expect(db.txns[1]).toMatchObject({ type: 'RETURN', quantity: 10 });

    const day = await listSlips('p', siteToday());
    expect(day.totals[0]).toMatchObject({ taken: 50, used: 40, returned: 10, open: 0 });
  });

  it('a return comes back at the price it left at, even if the average moved during the day', async () => {
    const slip = await take(50); // leaves at ₹400
    // A purchase at ₹460 arrives during the day: 50 → 100 bags, average ₹430.
    db.stock.set('cement', 100);
    db.value.set('cement', 20000 + 50 * 460);
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    expect(db.txns[1]).toMatchObject({ type: 'RETURN', unitCost: 400, totalCost: 4000 });
    expect(db.value.get('cement')).toBe(20000 + 23000 + 4000);
  });

  it('records the phase on the slip and on both stock movements, so phase totals see it', async () => {
    const slip = await take(50, { phaseId: 'ph-slab' });
    expect(slip.phaseId).toBe('ph-slab');
    expect(db.txns[0]).toMatchObject({ type: 'OUT', phaseId: 'ph-slab' });
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    expect(db.txns[1]).toMatchObject({ type: 'RETURN', phaseId: 'ph-slab' });
  });

  it('a new slip must say what the material is for; an unknown phase is refused', async () => {
    await expect(take(10, {})).rejects.toMatchObject({ code: 'SLIP_PURPOSE_REQUIRED' });
    await expect(take(10, { phaseId: 'ph-x' })).rejects.toThrow(/Phase not found/);
    expect(db.stock.get('cement')).toBe(100);
  });

  it('taking for another phase while today’s slip is open is refused', async () => {
    await take(10, { phaseId: 'ph-slab' });
    await expect(take(5, { phaseId: 'ph-wall' })).rejects.toMatchObject({ code: 'SLIP_OTHER_PHASE' });
    // Adding without naming a phase goes onto the open slip (and its phase).
    await take(5, {});
    expect(db.lines[0].takenQty).toBe(15);
    expect(db.txns[1]).toMatchObject({ phaseId: 'ph-slab' });
  });

  it('correcting a saved evening update moves only the difference, at the line’s price', async () => {
    const slip = await take(50);
    const lineId = slip.lines[0].id;
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] });
    expect(db.stock.get('cement')).toBe(60);

    // Really 30 used and 20 returned: 10 more back into stock.
    await correctSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 30, returnedQty: 20 }] });
    expect(db.stock.get('cement')).toBe(70);
    expect(db.txns[2]).toMatchObject({ type: 'RETURN', quantity: 10, unitCost: 400 });
    expect(db.lines[0]).toMatchObject({ usedQty: 30, returnedQty: 20 });

    // Then 45 used, 5 returned: 15 taken back out of stock.
    await correctSlip('p', head, slip.id, { lines: [{ lineId, usedQty: 45, returnedQty: 5 }] });
    expect(db.stock.get('cement')).toBe(55);
    expect(db.txns[3]).toMatchObject({ type: 'OUT', quantity: 15, unitCost: 400 });
  });

  it('a correction needs a closed slip, a change, and the taker or a head', async () => {
    const slip = await take(50);
    const lineId = slip.lines[0].id;
    await expect(correctSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] })).rejects.toMatchObject({ status: 409 });
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] });
    await expect(correctSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] })).rejects.toMatchObject({ code: 'SLIP_NO_CHANGE' });
    await expect(correctSlip('p', other, slip.id, { lines: [{ lineId, usedQty: 30, returnedQty: 20 }] })).rejects.toMatchObject({ status: 403 });
    await expect(correctSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 30, returnedQty: 10 }] })).rejects.toMatchObject({ code: 'SLIP_MISMATCH' });
  });

  it('day-wise usage shows 40 used on the day, and the range total', async () => {
    const slip = await take(50);
    await closeSlip('p', ravi, slip.id, { lines: [{ lineId: slip.lines[0].id, usedQty: 40, returnedQty: 10 }] });
    const day = siteToday();
    const h = await usageHistory('p', new Date(day.getTime() - 6 * 86_400_000), day);
    expect(h.days).toEqual([
      expect.objectContaining({ date: day.toISOString().slice(0, 10), name: 'Cement', taken: 50, used: 40, returned: 10, open: 0 }),
    ]);
    expect(h.totals[0]).toMatchObject({ used: 40, returned: 10 });
    await expect(usageHistory('p', day, new Date(day.getTime() - 86_400_000))).rejects.toBeInstanceOf(SlipError);
  });

  it('a double-tap on the first take adds to the slip the other request created (no 500, no second slip)', async () => {
    db.raceOnce = true;
    const slip = await take(20);
    expect(slip.id).toBe('slip-winner');
    expect(slip.created).toBe(false);
    expect(db.slips).toHaveLength(1);
    expect(db.stock.get('cement')).toBe(80);
  });

  it('reports whether a take started the day’s slip (audit CREATE) or added to it (UPDATE)', async () => {
    const first = await take(10);
    const second = await take(5);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('taking more the same day adds to the same slip', async () => {
    await take(20);
    await take(15);
    expect(db.slips).toHaveLength(1);
    expect(db.lines[0].takenQty).toBe(35);
    expect(db.stock.get('cement')).toBe(65);
  });

  it('refuses taking more than the store has', async () => {
    await expect(take(120)).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(db.stock.get('cement')).toBe(100);
  });

  it('used + returned must equal taken; slip closes once; only the taker or a head', async () => {
    const slip = await take(50);
    const lineId = slip.lines[0].id;
    await expect(closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 5 }] })).rejects.toMatchObject({ code: 'SLIP_MISMATCH' });
    await expect(closeSlip('p', other, slip.id, { lines: [{ lineId, usedQty: 40, returnedQty: 10 }] })).rejects.toMatchObject({ status: 403 });
    await closeSlip('p', head, slip.id, { lines: [{ lineId, usedQty: 50, returnedQty: 0 }] });
    expect(db.stock.get('cement')).toBe(50);
    await expect(closeSlip('p', ravi, slip.id, { lines: [{ lineId, usedQty: 50, returnedQty: 0 }] })).rejects.toBeInstanceOf(SlipError);
  });
});
