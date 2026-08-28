/**
 * Scenario 10: Site Construction Operations
 *
 * phase → activity (linked to vendor) → update progress → photo
 *   → issue → close → inspection → update checklist
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `site-${Date.now()}`;
const { record, printReport } = makeReporter('SITE OPERATIONS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let phaseId = '';
let activityId = '';
let photoId = '';
let issueId = '';
let inspectionId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[SITEOPS] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Site Operations', () => {
  it('creates a vendor for activity assignment', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `Site Vendor ${RUN_ID}`,
        vendorCode: `SV-${RUN_ID}`,
        phone: '+919900000003',
        email: `site-${RUN_ID}@test.com`,
        address: 'Site Address',
        materials: [{ name: `Bricks ${RUN_ID}`, unit: 'pcs' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates a phase', async () => {
    const res = await request
      .post('/api/phases')
      .set(authAs(ctx.userPhId))
      .send({ name: `Phase 1 Foundation ${RUN_ID}`, budgetAmount: 5000000, status: 'NOT_STARTED' });
    expect(res.status).toBe(201);
    phaseId = res.body.id;
    record('phase.create', true, `phase=${phaseId}`);
  });

  it('creates an activity linked to the vendor', async () => {
    const res = await request
      .post('/api/activities')
      .set(authAs(ctx.userPhId))
      .send({ phaseId, name: `Excavation ${RUN_ID}`, assignedVendorId: vendorId, budgetAmount: 500000, status: 'NOT_STARTED' });
    expect(res.status).toBe(201);
    activityId = res.body.id;
    record('activity.create', true, `activity=${activityId} vendor=${vendorId}`);
  });

  it('updates the activity to IN_PROGRESS with 40% progress', async () => {
    const res = await request
      .patch(`/api/activities/${activityId}`)
      .set(authAs(ctx.userPhId))
      .send({ status: 'IN_PROGRESS', progressPercent: 40 });
    expect(res.status).toBe(200);
    const db = await prisma.activity.findUnique({ where: { id: activityId } });
    expect(db!.status).toBe('IN_PROGRESS');
    expect(Number(db!.progressPercent)).toBe(40);
    record('activity.update', true, `status=IN_PROGRESS progress=40`);
  });

  it('uploads a site photo (with URL)', async () => {
    const res = await request
      .post('/api/photos')
      .set(authAs(ctx.userPhId))
      .send({ phaseId, activityId, imageUrl: `https://example.com/photo-${RUN_ID}.jpg`, caption: `Excavation progress ${RUN_ID}`, tag: 'DURING' });
    expect(res.status).toBe(201);
    photoId = res.body.id;
    record('photo.create', true, `photo=${photoId}`);
  });

  it('raises an issue addressed to heads', async () => {
    const res = await request
      .post('/api/issues')
      .set(authAs(ctx.userPhId))
      .send({
        category: 'Safety',
        severity: 'HIGH',
        title: `Waterlogging at site ${RUN_ID}`,
        description: 'Water accumulation in excavation area',
        addressTo: [ctx.userHocId, ctx.userAdminId],
      });
    expect(res.status).toBe(201);
    issueId = res.body.id;
    const db = await prisma.issue.findUnique({ where: { id: issueId } });
    expect(db!.status).toBe('OPEN');
    record('issue.create', true, `issue=${issueId} status=OPEN`);
  });

  it('closes the issue with closure notes', async () => {
    const res = await request
      .post(`/api/issues/${issueId}/close`)
      .set(authAs(ctx.userHocId))
      .send({ closureNotes: 'Pumps deployed, water cleared' });
    expect(res.status).toBe(200);
    const db = await prisma.issue.findUnique({ where: { id: issueId } });
    expect(db!.status).toBe('CLOSED');
    record('issue.close', true, `status=CLOSED`);
  });

  it('creates a standalone inspection', async () => {
    const res = await request
      .post('/api/inspections')
      .set(authAs(ctx.userPhId))
      .send({ name: `Foundation Inspection ${RUN_ID}`, scheduledDate: new Date().toISOString().slice(0, 10) });
    expect(res.status).toBe(201);
    inspectionId = res.body.id;
    const db = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(db!.status).toBe('SCHEDULED');
    record('inspection.create', true, `inspection=${inspectionId}`);
  });

  it('updates the inspection with checklist + marks PASSED', async () => {
    const res = await request
      .patch(`/api/inspections/${inspectionId}`)
      .set(authAs(ctx.userPhId))
      .send({
        status: 'PASSED',
        checklist: [
          { item: 'Reinforcement spacing', result: 'PASS' },
          { item: 'Concrete strength', result: 'PASS' },
          { item: 'Curing period', result: 'PASS' },
        ],
      });
    expect(res.status).toBe(200);
    const db = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(db!.status).toBe('PASSED');
    record('inspection.update', true, `status=PASSED checklist=3`);
  });

  it('verifies all site ops entities persisted in DB', async () => {
    const checks = await Promise.all([
      prisma.phase.findUnique({ where: { id: phaseId } }),
      prisma.activity.findUnique({ where: { id: activityId } }),
      prisma.sitePhoto.findUnique({ where: { id: photoId } }),
      prisma.issue.findUnique({ where: { id: issueId } }),
      prisma.inspection.findUnique({ where: { id: inspectionId } }),
    ]);
    expect(checks.every((c) => c !== null)).toBe(true);
    record('all.persisted', true, '5 entities verified');
  });
});
