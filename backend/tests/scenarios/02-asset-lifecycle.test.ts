/**
 * Scenario 2: Asset Lifecycle Management
 *
 * asset item → create asset → issue → return → relocate
 *   → maintenance → complete → scan → retire
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `ast-${Date.now()}`;
const { record, printReport } = makeReporter('ASSET LIFECYCLE', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let assetItemId = '';
let assetId = '';
let assetIdCode = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[ASSET] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Asset Lifecycle', () => {
  it('creates an ASSET-type inventory item', async () => {
    const res = await request
      .post('/api/inventory/items')
      .set(authAs(ctx.userPhId))
      .send({ name: `Crane ${RUN_ID}`, unit: 'pcs', itemType: 'ASSET', currentStock: 0, minStockLevel: 0, location: 'Main Store' });
    expect(res.status).toBe(201);
    assetItemId = res.body.id;
    record('assetItem.create', true, `item=${assetItemId}`);
  });

  it('creates an individual asset unit', async () => {
    const res = await request
      .post(`/api/assets/${assetItemId}`)
      .set(authAs(ctx.userPhId))
      .send({ location: 'Main Store', notes: `Asset ${RUN_ID}` });
    expect(res.status).toBe(201);
    assetId = res.body.id;
    assetIdCode = res.body.assetId;
    expect(assetIdCode).toMatch(/^VGH-AST-\d+$/);
    record('asset.create', true, `asset=${assetId} code=${assetIdCode}`);
  });

  it('issues the asset to a person', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/issue`)
      .set(authAs(ctx.userPhId))
      .send({ issuedToPerson: 'Ravi Kumar', location: 'Site A', notes: 'For construction' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ISSUED');
    record('asset.issue', true, `status=ISSUED`);
  });

  it('returns the asset to store', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/return`)
      .set(authAs(ctx.userPhId))
      .send({ location: 'Main Store' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ACTIVE');
    record('asset.return', true, `status=ACTIVE`);
  });

  it('relocates the asset', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/relocate`)
      .set(authAs(ctx.userPhId))
      .send({ location: 'Warehouse B', reason: 'Reorganization' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.location).toBe('Warehouse B');
    record('asset.relocate', true, `location=Warehouse B`);
  });

  it('sends the asset for maintenance', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/maintenance`)
      .set(authAs(ctx.userPhId))
      .send({ reason: 'Routine service', maintenanceVendor: 'TechFix', cost: 5000 });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('UNDER_MAINTENANCE');
    record('asset.maintenance', true, `status=UNDER_MAINTENANCE`);
  });

  it('completes maintenance', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/maintenance/complete`)
      .set(authAs(ctx.userPhId))
      .send({ completionNotes: 'Fixed and tested', finalCost: 4500, returnToLocation: 'Warehouse B' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ACTIVE');
    record('asset.maintenanceComplete', true, `status=ACTIVE`);
  });

  it('scans the asset (public QR endpoint)', async () => {
    const res = await request.get(`/api/assets/scan/${assetIdCode}`).set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(200);
    expect(res.body.assetId).toBe(assetIdCode);
    record('asset.scan', true, `scanned=${assetIdCode}`);
  });

  it('retires the asset', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/retire`)
      .set(authAs(ctx.userAdminId))
      .send({ reason: 'End of life' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('RETIRED');
    record('asset.retire', true, `status=RETIRED`);
  });

  it('verifies asset + item persisted in DB', async () => {
    const [item, asset] = await Promise.all([
      prisma.inventoryItem.findUnique({ where: { id: assetItemId } }),
      prisma.asset.findUnique({ where: { id: assetId } }),
    ]);
    expect(item).not.toBeNull();
    expect(asset).not.toBeNull();
    record('all.persisted', true, 'item + asset verified');
  });
});
