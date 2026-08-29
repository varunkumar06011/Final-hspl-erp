/**
 * Scenario 13: GST Records
 *
 * Tests the GST records report endpoint which aggregates GST data
 * from invoices and purchase orders, with vendor-wise summary.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, makeReporter } from './_helpers';

const RUN_ID = `gst-${Date.now()}`;
const { record, printReport } = makeReporter('GST RECORDS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[GST] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('GST Records', () => {
  it('GET /gst-records returns all GST records with summary', async () => {
    const res = await request.get('/api/gst-records').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('summary');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.summary).toHaveProperty('gstRecorded');
    expect(res.body.summary).toHaveProperty('gstPaid');
    expect(res.body.summary).toHaveProperty('gstOutstanding');
    expect(res.body.summary).toHaveProperty('vendorWise');
    record('gst.all', true, `records=${res.body.data.length} vendors=${res.body.summary.vendorWise.length}`);
  });

  it('GET /gst-records filters by status=OUTSTANDING', async () => {
    const res = await request.get('/api/gst-records?status=OUTSTANDING').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const r of res.body.data) {
      expect(r.paymentStatus).toBe('OUTSTANDING');
    }
    record('gst.outstanding', true, `records=${res.body.data.length}`);
  });

  it('GET /gst-records filters by status=PAID', async () => {
    const res = await request.get('/api/gst-records?status=PAID').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const r of res.body.data) {
      expect(r.paymentStatus).toBe('PAID');
    }
    record('gst.paid', true, `records=${res.body.data.length}`);
  });

  it('GET /gst-records filters by status=UNBILLED', async () => {
    const res = await request.get('/api/gst-records?status=UNBILLED').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const r of res.body.data) {
      expect(r.paymentStatus).toBe('UNBILLED');
      expect(r.sourceType).toBe('PURCHASE_ORDER');
    }
    record('gst.unbilled', true, `records=${res.body.data.length}`);
  });

  it('GET /gst-records summary has vendor-wise breakdown', async () => {
    const res = await request.get('/api/gst-records').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const vendors = res.body.summary.vendorWise;
    for (const v of vendors) {
      expect(v).toHaveProperty('vendorId');
      expect(v).toHaveProperty('vendorName');
      expect(v).toHaveProperty('vendorCode');
      expect(v).toHaveProperty('gstRecorded');
      expect(v).toHaveProperty('gstPaid');
      expect(v).toHaveProperty('gstOutstanding');
    }
    record('gst.vendorWise', true, `vendors=${vendors.length}`);
  });
});
