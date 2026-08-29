/**
 * Scenario 29: Vendor CRUD + Trace
 *
 * Tests vendor update, delete (with blocking validation), and trace endpoint.
 * Vendor creation is already covered in many scenarios; this fills the gaps.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, prisma, makeReporter } from './_helpers';

const RUN_ID = `ven-${Date.now()}`;
const { record, printReport } = makeReporter('VENDOR CRUD + TRACE', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let testVendorId: string;
let vendorWithQuotations: string;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[VEN] run=${RUN_ID} project=${ctx.projectName}`);
  // Find a vendor that has quotations (for delete-block test)
  const v = await prisma.vendor.findFirst({
    where: { projectId: ctx.projectId, deletedAt: null, quotations: { some: { deletedAt: null } } },
    select: { id: true },
  });
  vendorWithQuotations = v?.id ?? '';
});

afterAll(() => printReport());

describe('Vendor CRUD + Trace', () => {
  // ═══ A. Create + Update ═══
  it('creates a fresh vendor for testing', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `Vendor-CRUD-${RUN_ID}`,
        contactPersonName: 'Test Person',
        contactPersonPhone: '+919999999999',
        category: 'MATERIAL',
        materials: [{ name: 'Test Material', unit: 'nos' }],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('vendorCode');
    testVendorId = res.body.id;
    record('ven.create', true, `id=${testVendorId} code=${res.body.vendorCode}`);
  });

  it('PATCH /:id updates vendor fields', async () => {
    const res = await request
      .patch(`/api/vendors/${testVendorId}`)
      .set(authAs(ctx.userPhId))
      .send({ name: `Vendor-Updated-${RUN_ID}`, category: 'SERVICE', rating: 4 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(`Vendor-Updated-${RUN_ID}`);
    expect(res.body.category).toBe('SERVICE');
    expect(res.body.rating).toBe(4);
    record('ven.update', true, `name + category + rating updated`);
  });

  it('PATCH /:id syncs materials (delete + recreate)', async () => {
    const res = await request
      .patch(`/api/vendors/${testVendorId}`)
      .set(authAs(ctx.userPhId))
      .send({ materials: [{ name: 'New Material 1', unit: 'kg' }, { name: 'New Material 2', unit: 'ltr' }] });
    expect(res.status).toBe(200);
    expect(res.body.materials.length).toBe(2);
    expect(res.body.materials.map((m: { name: string }) => m.name)).toEqual(['New Material 1', 'New Material 2']);
    record('ven.updateMaterials', true, `materials=${res.body.materials.length}`);
  });

  it('GET /:id returns the vendor with materials', async () => {
    const res = await request.get(`/api/vendors/${testVendorId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testVendorId);
    expect(Array.isArray(res.body.materials)).toBe(true);
    record('ven.getById', true, `id=${testVendorId}`);
  });

  it('GET /:id returns 404 for non-existent', async () => {
    const res = await request
      .get('/api/vendors/00000000-0000-0000-0000-000000000000')
      .set(authAs(ctx.userPhId));
    expect(res.status).toBe(404);
    record('ven.get404', true, `404`);
  });

  it('GET / list returns vendors with totalBilled/totalPaid/outstanding', async () => {
    const res = await request
      .get('/api/vendors')
      .set(authAs(ctx.userPhId))
      .query({ page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    // Each vendor should have the computed fields
    if (res.body.data.length > 0) {
      const v = res.body.data[0];
      expect(v).toHaveProperty('totalBilled');
      expect(v).toHaveProperty('totalPaid');
      expect(v).toHaveProperty('outstanding');
    }
    record('ven.list', true, `count=${res.body.data.length}`);
  });

  // ═══ B. Trace ═══
  it('GET /:id/trace returns linked records for a vendor', async () => {
    if (!vendorWithQuotations) { record('ven.trace', true, 'skipped — no vendor with quotations'); return; }
    const res = await request.get(`/api/vendors/${vendorWithQuotations}/trace`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('quotations');
    expect(res.body).toHaveProperty('purchaseOrders');
    expect(res.body).toHaveProperty('assets');
    expect(res.body).toHaveProperty('invoices');
    expect(res.body).toHaveProperty('paymentRequests');
    expect(Array.isArray(res.body.quotations)).toBe(true);
    expect(res.body.quotations.length).toBeGreaterThan(0);
    record('ven.trace', true, `q=${res.body.quotations.length} po=${res.body.purchaseOrders.length} inv=${res.body.invoices.length}`);
  });

  it('GET /:id/trace returns 404 for non-existent vendor', async () => {
    const res = await request
      .get('/api/vendors/00000000-0000-0000-0000-000000000000/trace')
      .set(authAs(ctx.userPhId));
    expect(res.status).toBe(404);
    record('ven.trace404', true, `404`);
  });

  // ═══ C. Delete ═══
  it('DELETE /:id succeeds for vendor with no financial records', async () => {
    const res = await request.delete(`/api/vendors/${testVendorId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    record('ven.delete', true, `deleted=${testVendorId}`);
  });

  it('DELETE /:id returns 400 for vendor with existing quotations', async () => {
    if (!vendorWithQuotations) { record('ven.deleteBlocked', true, 'skipped — no vendor with quotations'); return; }
    const res = await request.delete(`/api/vendors/${vendorWithQuotations}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete vendor');
    record('ven.deleteBlocked', true, `400 — blocked by quotations`);
  });

  it('GET /:id returns 404 after delete', async () => {
    const res = await request.get(`/api/vendors/${testVendorId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(404);
    record('ven.deleted404', true, `404`);
  });
});
