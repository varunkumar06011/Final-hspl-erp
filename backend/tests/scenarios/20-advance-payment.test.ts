/**
 * Scenario 20: Advance Payment Flow
 *
 * Tests the PO advance payment lifecycle:
 *   vendor → quotation → approve → PO (ADVANCE type) → approve
 *   → advance payment request → approve → pay
 *   → verify pending-pos list shows paid advance
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `adv-${Date.now()}`;
const { record, printReport } = makeReporter('ADVANCE PAYMENT', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let quotationId = '';
let poId = '';
let advanceRequestId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[ADV] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Advance Payment Flow', () => {
  it('creates a vendor with materials', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `Advance Vendor ${RUN_ID}`,
        vendorCode: `ADV-${RUN_ID}`,
        phone: '+919900000020',
        email: `adv-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [{ name: `Advance Material ${RUN_ID}`, unit: 'bag' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates and approves a quotation', async () => {
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `Advance Material ${RUN_ID}`, quantity: 100, unit: 'bag', unitPrice: 500 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(qRes.status).toBe(201);
    quotationId = qRes.body.id;

    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    record('quotation.approve', true, `quotation=${quotationId}`);
  });

  it('creates a PO with ADVANCE payment type', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'ADVANCE', acknowledged: true });
    expect(res.status).toBe(201);
    poId = res.body.id;
    expect(res.body.paymentType).toBe('ADVANCE');
    record('po.create', true, `po=${poId} type=ADVANCE`);
  });

  it('approves the PO', async () => {
    const res = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    record('po.approve', true, `status=APPROVED`);
  });

  it('GET /payments/pending-pos lists the approved PO', async () => {
    const res = await request.get('/api/payments/pending-pos').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { id: string }) => p.id === poId)).toBe(true);
    record('pending-pos.list', true, `PO found in pending list`);
  });

  it('creates an advance payment request against the PO', async () => {
    const res = await request
      .post('/api/payments/po-advance')
      .set(authAs(ctx.userPhId))
      .send({
        poId,
        vendorId,
        requestNumber: `ADV-PR-${RUN_ID}`,
        amount: 25000,
        paymentMode: 'BANK_TRANSFER',
        notes: 'Advance payment for PO',
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    advanceRequestId = res.body.id;
    expect(res.body.type).toBe('ADVANCE');
    record('advance.create', true, `pr=${advanceRequestId} amount=25000`);
  });

  it('rejects a second active advance request for the same PO', async () => {
    const res = await request
      .post('/api/payments/po-advance')
      .set(authAs(ctx.userPhId))
      .send({
        poId,
        vendorId,
        requestNumber: `ADV-PR2-${RUN_ID}`,
        amount: 5000,
        paymentMode: 'BANK_TRANSFER',
        acknowledged: true,
      });
    expect(res.status).toBe(409);
    record('advance.duplicate', true, `409 as expected`);
  });

  it('approves the advance payment request (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/payments/${advanceRequestId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/payments/${advanceRequestId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('advance.approve', true, `status=APPROVED`);
  });

  it('records the advance payment (via bank account)', async () => {
    const bankAcct = await prisma.bankAccount.create({
      data: { projectId: ctx.projectId, accountName: `Bank-ADV-${RUN_ID}`, bankName: 'Test', accountNumber: '3333', ifscCode: 'TEST', currentBalance: 500000, isActive: true },
    });
    const res = await request
      .post(`/api/payments/${advanceRequestId}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 25000, mode: 'BANK_TRANSFER', bankAccountId: bankAcct.id, reference: `ADV-PAY-${RUN_ID}` });
    expect(res.status).toBe(201);
    const db = await prisma.paymentRequest.findUnique({ where: { id: advanceRequestId } });
    expect(db!.status).toBe('PAID');
    record('advance.pay', true, `status=PAID`);
  });

  it('verifies the advance payment is reflected in pending-pos', async () => {
    const res = await request.get('/api/payments/pending-pos').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const po = res.body.data.find((p: { id: string }) => p.id === poId);
    expect(po).toBeDefined();
    expect(Number(po.advancePaidToDate)).toBe(25000);
    record('advance.verified', true, `paidToDate=25000`);
  });
});
