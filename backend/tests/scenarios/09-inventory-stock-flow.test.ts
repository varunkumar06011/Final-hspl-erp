/**
 * Scenario 9: Inventory Stock Flow
 *
 * consumable item (with initial stock) → stock OUT → stock ADJUST → verify final stock
 *
 * Note: Manual stock IN is not allowed (must come from goods receipt).
 * ADJUST sets the absolute stock value (not a delta) and requires ADMIN role.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `inv-${Date.now()}`;
const { record, printReport } = makeReporter('INVENTORY STOCK FLOW', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let itemId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[INVENTORY] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Inventory Stock Flow', () => {
  it('creates a consumable inventory item (stock starts at 0)', async () => {
    const res = await request
      .post('/api/inventory/items')
      .set(authAs(ctx.userPhId))
      .send({ name: `Paint Buckets ${RUN_ID}`, unit: 'pcs', itemType: 'CONSUMABLE', currentStock: 0, minStockLevel: 10, location: 'Store A' });
    expect(res.status).toBe(201);
    itemId = res.body.id;
    // Opening stock must come from a goods receipt — simulate by setting directly in DB
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { currentStock: 100 } });
    const db = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(Number(db!.currentStock)).toBe(100);
    record('item.create', true, `item=${itemId} stock=100 (set via DB)`);
  });

  it('rejects manual stock IN (must come from goods receipt)', async () => {
    const res = await request
      .post('/api/inventory/transactions')
      .set(authAs(ctx.userPhId))
      .send({ itemId, type: 'IN', quantity: 50, notes: 'Should fail' });
    expect(res.status).toBe(400);
    record('stock.inRejected', true, `400 as expected (IN must come from GRN)`);
  });

  it('stocks OUT 30 units', async () => {
    const res = await request
      .post('/api/inventory/transactions')
      .set(authAs(ctx.userPhId))
      .send({ itemId, type: 'OUT', quantity: 30, notes: `Used for site ${RUN_ID}` });
    expect(res.status).toBe(201);
    const db = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(Number(db!.currentStock)).toBe(70);
    record('stock.out', true, `stock=70`);
  });

  it('rejects stock OUT exceeding available', async () => {
    const res = await request
      .post('/api/inventory/transactions')
      .set(authAs(ctx.userPhId))
      .send({ itemId, type: 'OUT', quantity: 999, notes: 'Should fail' });
    expect(res.status).toBe(400);
    record('stock.overoutRejected', true, `400 as expected`);
  });

  it('rejects ADJUST from non-admin (PH cannot adjust)', async () => {
    const res = await request
      .post('/api/inventory/transactions')
      .set(authAs(ctx.userPhId))
      .send({ itemId, type: 'ADJUST', quantity: 80, notes: 'Should fail' });
    expect(res.status).toBe(403);
    record('stock.adjustRejected', true, `403 as expected (ADMIN only)`);
  });

  it('adjusts stock to 80 units (ADMIN — sets absolute value)', async () => {
    const res = await request
      .post('/api/inventory/transactions')
      .set(authAs(ctx.userAdminId))
      .send({ itemId, type: 'ADJUST', quantity: 80, notes: `Stock count adjustment ${RUN_ID}` });
    expect(res.status).toBe(201);
    const db = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(Number(db!.currentStock)).toBe(80);
    record('stock.adjust', true, `stock=80`);
  });

  it('verifies item + transactions persisted in DB', async () => {
    const [item, txns] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id: itemId } }),
      prisma.inventoryTransaction.findMany({ where: { itemId } }),
    ]);
    expect(item).not.toBeNull();
    expect(txns.length).toBe(2); // 1 OUT + 1 ADJUST (IN was rejected)
    record('all.persisted', true, `item + ${txns.length} txns verified`);
  });
});
