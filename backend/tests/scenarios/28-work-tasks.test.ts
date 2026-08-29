/**
 * Scenario 28: Work Tasks
 *
 * Tests the full work-task module:
 *   CRUD (list/get/create/update/delete)
 *   GET /calendar, /assignable-users, /linkable-quotations, /linkable-pos
 *   POST /:id/generate-quotation
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, prisma, makeReporter } from './_helpers';

const RUN_ID = `wt-${Date.now()}`;
const { record, printReport } = makeReporter('WORK TASKS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let workTaskId: string;
let vendorId: string;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[WT] run=${RUN_ID} project=${ctx.projectName}`);
  // Find an existing vendor for generate-quotation test
  const vendor = await prisma.vendor.findFirst({
    where: { projectId: ctx.projectId, deletedAt: null },
    select: { id: true },
  });
  vendorId = vendor?.id ?? '';
});

afterAll(() => printReport());

describe('Work Tasks', () => {
  // ═══ A. CRUD ═══
  it('POST / creates a work task', async () => {
    const res = await request
      .post('/api/work-tasks')
      .set(authAs(ctx.userPhId))
      .send({
        title: `WT-Test-${RUN_ID}`,
        description: 'Test work task',
        type: 'SITE_WORK',
        priority: 'HIGH',
        scheduledDate: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe(`WT-Test-${RUN_ID}`);
    expect(res.body.status).toBe('PLANNED');
    workTaskId = res.body.id;
    record('wt.create', true, `id=${workTaskId}`);
  });

  it('GET / lists work tasks with pagination', async () => {
    const res = await request
      .get('/api/work-tasks')
      .set(authAs(ctx.userPhId))
      .query({ page: '1', pageSize: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
    record('wt.list', true, `count=${res.body.data.length}`);
  });

  it('GET / filters by status', async () => {
    const res = await request
      .get('/api/work-tasks')
      .set(authAs(ctx.userPhId))
      .query({ status: 'PLANNED', page: '1', pageSize: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((t: { status: string }) => t.status === 'PLANNED')).toBe(true);
    record('wt.filterStatus', true, `planned=${res.body.data.length}`);
  });

  it('GET /:id returns the work task', async () => {
    const res = await request.get(`/api/work-tasks/${workTaskId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(workTaskId);
    record('wt.getById', true, `id=${workTaskId}`);
  });

  it('GET /:id returns 404 for non-existent', async () => {
    const res = await request
      .get('/api/work-tasks/00000000-0000-0000-0000-000000000000')
      .set(authAs(ctx.userPhId));
    expect(res.status).toBe(404);
    record('wt.get404', true, `404`);
  });

  it('PATCH /:id updates the work task', async () => {
    const res = await request
      .patch(`/api/work-tasks/${workTaskId}`)
      .set(authAs(ctx.userPhId))
      .send({ title: `WT-Updated-${RUN_ID}`, status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(`WT-Updated-${RUN_ID}`);
    expect(res.body.status).toBe('IN_PROGRESS');
    record('wt.update', true, `title updated, status=IN_PROGRESS`);
  });

  // ═══ B. Calendar ═══
  it('GET /calendar returns tasks in date range', async () => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const end = new Date();
    end.setDate(end.getDate() + 7);
    const res = await request
      .get('/api/work-tasks/calendar')
      .set(authAs(ctx.userPhId))
      .query({ startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    record('wt.calendar', true, `count=${res.body.data.length}`);
  });

  it('GET /calendar requires startDate and endDate', async () => {
    const res = await request.get('/api/work-tasks/calendar').set(authAs(ctx.userPhId));
    expect(res.status).toBe(400);
    record('wt.calendarValidation', true, `400`);
  });

  // ═══ C. Dropdowns ═══
  it('GET /assignable-users returns active users', async () => {
    const res = await request.get('/api/work-tasks/assignable-users').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    record('wt.assignableUsers', true, `users=${res.body.data.length}`);
  });

  it('GET /linkable-quotations returns quotations', async () => {
    const res = await request.get('/api/work-tasks/linkable-quotations').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    record('wt.linkableQuotations', true, `quotations=${res.body.data.length}`);
  });

  it('GET /linkable-pos returns purchase orders', async () => {
    const res = await request.get('/api/work-tasks/linkable-pos').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    record('wt.linkablePOs', true, `pos=${res.body.data.length}`);
  });

  // ═══ D. Generate Quotation ═══
  it('POST /:id/generate-quotation creates a quotation from the work task', async () => {
    if (!vendorId) { record('wt.genQuote', true, 'skipped — no vendor'); return; }
    const res = await request
      .post(`/api/work-tasks/${workTaskId}/generate-quotation`)
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `WT-Material-${RUN_ID}`, quantity: 5, unit: 'nos', unitPrice: 500, gstRate: 18 }],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('quotationNumber');
    record('wt.genQuote', true, `quotation=${res.body.quotationNumber}`);
  });

  it('POST /:id/generate-quotation returns 404 for non-existent work task', async () => {
    if (!vendorId) { record('wt.genQuote404', true, 'skipped — no vendor'); return; }
    const res = await request
      .post('/api/work-tasks/00000000-0000-0000-0000-000000000000/generate-quotation')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: 'TEST', quantity: 1, unit: 'nos', unitPrice: 100, gstRate: 0 }],
      });
    expect(res.status).toBe(404);
    record('wt.genQuote404', true, `404`);
  });

  it('POST /:id/generate-quotation returns 400 for non-existent vendor', async () => {
    const res = await request
      .post(`/api/work-tasks/${workTaskId}/generate-quotation`)
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: '00000000-0000-0000-0000-000000000000',
        items: [{ materialName: 'TEST', quantity: 1, unit: 'nos', unitPrice: 100, gstRate: 0 }],
      });
    expect(res.status).toBe(400);
    record('wt.genQuoteBadVendor', true, `400`);
  });

  // ═══ E. Delete ═══
  it('DELETE /:id soft-deletes the work task', async () => {
    const res = await request.delete(`/api/work-tasks/${workTaskId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    record('wt.delete', true, `deleted=${workTaskId}`);
  });

  it('GET /:id returns 404 after delete', async () => {
    const res = await request.get(`/api/work-tasks/${workTaskId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(404);
    record('wt.deleted404', true, `404`);
  });
});
