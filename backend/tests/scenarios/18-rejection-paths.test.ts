/**
 * Scenario 18: Rejection Paths
 *
 * Tests rejection workflows for quotations, POs, invoices, and payment requests.
 * Each entity is created, then rejected via the /reject endpoint.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `rej-${Date.now()}`;
const { record, printReport } = makeReporter('REJECTION PATHS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[REJ] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Rejection Paths', () => {
  // ── Quotation rejection ──
  it('creates a vendor for rejection tests', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `Rejection Vendor ${RUN_ID}`,
        vendorCode: `REJ-${RUN_ID}`,
        phone: '+919900000018',
        email: `rej-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [{ name: `Rej Material ${RUN_ID}`, unit: 'bag' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('rejects a quotation (2 rejections: PH + HOC)', async () => {
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `Rej Material ${RUN_ID}`, quantity: 10, unit: 'bag', unitPrice: 100 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(qRes.status).toBe(201);
    const quotationId = qRes.body.id;

    // minApprovers=2, so need 2 rejections to fully reject
    await request
      .post(`/api/quotations/${quotationId}/reject`)
      .set(authAs(ctx.userPhId))
      .send({ reason: 'Price too high', acknowledged: true });
    const rejRes = await request
      .post(`/api/quotations/${quotationId}/reject`)
      .set(authAs(ctx.userHocId))
      .send({ reason: 'Price too high', acknowledged: true });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.status).toBe('REJECTED');
    const db = await prisma.quotation.findUnique({ where: { id: quotationId } });
    expect(db!.status).toBe('REJECTED');
    record('quotation.reject', true, `status=REJECTED (2 rejections)`);
  });

  // ── PO rejection ──
  it('rejects a purchase order (ADMIN)', async () => {
    // Create + approve a quotation first
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `Rej Material ${RUN_ID}`, quantity: 10, unit: 'bag', unitPrice: 100 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(qRes.status).toBe(201);
    const quotationId = qRes.body.id;

    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });

    // Create PO from approved quotation
    const poRes = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(poRes.status).toBe(201);
    const poId = poRes.body.id;

    // Reject the PO
    const rejRes = await request
      .post(`/api/purchase-orders/${poId}/reject`)
      .set(authAs(ctx.userAdminId))
      .send({ reason: 'Budget not available', acknowledged: true });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.status).toBe('REJECTED');
    const db = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    expect(db!.status).toBe('REJECTED');
    record('po.reject', true, `status=REJECTED`);
  });

  // ── Invoice rejection (requires full P2P chain) ──
  it('rejects an invoice (2 rejections: PH + HOC)', { timeout: 60000 }, async () => {
    // Create + approve quotation
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [{ materialName: `Rej Material ${RUN_ID}`, quantity: 10, unit: 'bag', unitPrice: 100 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(qRes.status).toBe(201);
    const quotationId = qRes.body.id;
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });

    // Create + approve PO
    const poRes = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(poRes.status).toBe(201);
    const poId = poRes.body.id;
    await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });

    // Create + approve gate pass (DB bypass)
    const gpRes = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB9999')
      .field('driverName', 'Ramesh')
      .field('driverMobile', '+919999999997');
    expect(gpRes.status).toBe(201);
    const gatePassId = gpRes.body.id;
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });

    // Create + inspect + post goods receipt
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    const grRes = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({
        gatePassId,
        items: po!.items.map((it) => ({ materialName: it.materialName, deliveredQty: Number(it.quantity), unit: it.unit })),
      });
    expect(grRes.status).toBe(201);
    const grnId = grRes.body.id;

    const gr = await prisma.goodsReceipt.findUnique({ where: { id: grnId }, include: { items: true } });
    await request
      .post(`/api/goods-receipts/${grnId}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({
        items: gr!.items.map((it) => ({ id: it.id, acceptedQty: Number(it.deliveredQty), rejectedQty: 0, itemType: 'CONSUMABLE' })),
      });

    const posterId = ctx.userAdmin2Id || ctx.userPhId;
    await request.post(`/api/goods-receipts/${grnId}/post`).set(authAs(posterId)).send({});

    // Create invoice
    const invRes = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        poId,
        invoiceNumber: `INV-REJ-${RUN_ID}`,
        amount: 1000,
        taxAmount: 0,
        totalAmount: 1000,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(invRes.status).toBe(201);
    const invoiceId = invRes.body.id;

    // Reject the invoice (minApprovers=2, need 2 rejections)
    await request
      .post(`/api/invoices/${invoiceId}/reject`)
      .set(authAs(ctx.userPhId))
      .send({ reason: 'Incorrect pricing', acknowledged: true });
    const rejRes = await request
      .post(`/api/invoices/${invoiceId}/reject`)
      .set(authAs(ctx.userHocId))
      .send({ reason: 'Incorrect pricing', acknowledged: true });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.verificationStatus).toBe('REJECTED');
    const db = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
    expect(db!.verificationStatus).toBe('REJECTED');
    record('invoice.reject', true, `status=REJECTED (2 rejections)`);
  });

  // ── Payment request rejection ──
  it('rejects a payment request (2 rejections: PH + HOC)', async () => {
    const expRes = await request
      .post('/api/payments/expense')
      .set(authAs(ctx.userPhId))
      .send({
        description: `Rejection Expense ${RUN_ID}`,
        amount: 5000,
        category: 'MISC',
        paymentMode: 'CASH',
      });
    expect(expRes.status).toBe(201);
    const prId = expRes.body.id;

    // minApprovers=2 for amount <= 100000, need 2 rejections
    await request
      .post(`/api/payments/${prId}/reject`)
      .set(authAs(ctx.userPhId))
      .send({ reason: 'Not approved', acknowledged: true });
    const rejRes = await request
      .post(`/api/payments/${prId}/reject`)
      .set(authAs(ctx.userHocId))
      .send({ reason: 'Not approved', acknowledged: true });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.status).toBe('REJECTED');
    const db = await prisma.paymentRequest.findUnique({ where: { id: prId } });
    expect(db!.status).toBe('REJECTED');
    record('payment.reject', true, `status=REJECTED (2 rejections)`);
  });
});
