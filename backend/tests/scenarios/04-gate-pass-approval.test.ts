/**
 * Scenario 4: Gate Pass Approval (OTP bypass)
 *
 * Creates a vendor + quotation + PO + approves them, then creates a gate pass
 * and approves it directly in DB (bypassing Firebase OTP).
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `gp-${Date.now()}`;
const { record, printReport } = makeReporter('GATE PASS APPROVAL', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let quotationId = '';
let poId = '';
let gatePassId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[GATEPASS] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Gate Pass Approval', () => {
  it('creates a vendor', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `GP Vendor ${RUN_ID}`,
        vendorCode: `GP-${RUN_ID}`,
        phone: '+919900000002',
        email: `gp-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [{ name: `Steel Rods ${RUN_ID}`, unit: 'kg' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates + approves a quotation', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `Steel Rods ${RUN_ID}`, quantity: 500, unit: 'kg', unitPrice: 80 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    quotationId = res.body.id;
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('quotation.approve', true, `status=APPROVED`);
  });

  it('creates + approves a PO', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(201);
    poId = res.body.id;
    const res2 = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('po.approve', true, `status=APPROVED`);
  });

  it('creates a gate pass (OTP requested for HoC)', async () => {
    const res = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'LORRY')
      .field('vehicleNumber', 'AP28XY5678')
      .field('driverName', 'Mahesh')
      .field('driverMobile', '+919888888888');
    expect(res.status).toBe(201);
    gatePassId = res.body.id;
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId }, include: { items: true } });
    expect(db!.status).toBe('PENDING');
    expect(db!.items.length).toBeGreaterThan(0);
    expect(db!.otpRequestedFor).toBe(ctx.userHocId);
    record('gatepass.create', true, `gatePass=${gatePassId} items=${db!.items.length}`);
  });

  it('rejects OTP verification without a valid Firebase token', async () => {
    const res = await request
      .post(`/api/gate-passes/${gatePassId}/verify-otp`)
      .set(authAs(ctx.userPhId))
      .send({ idToken: 'invalid-token' });
    expect(res.status).toBe(400);
    record('gatepass.otpRejected', true, `400 as expected (no Firebase token)`);
  });

  it('approves the gate pass directly in DB (OTP bypass)', async () => {
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId } });
    expect(db!.status).toBe('APPROVED');
    expect(db!.otpApprovedBy).toBe(ctx.userHocId);
    record('gatepass.approve', true, `status=APPROVED approvedBy=HoC`);
  });

  it('verifies gate pass + PO persisted in DB', async () => {
    const [gp, po] = await Promise.all([
      prisma.gatePass.findUnique({ where: { id: gatePassId } }),
      prisma.purchaseOrder.findUnique({ where: { id: poId } }),
    ]);
    expect(gp).not.toBeNull();
    expect(po).not.toBeNull();
    record('all.persisted', true, 'gatePass + PO verified');
  });
});
