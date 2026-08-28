/**
 * Scenario 1: Procurement-to-Payment (P2P)
 *
 * Full procurement lifecycle:
 *   vendor → quotation → approve (HEAD_GROUPS) → PO → approve (PO_SINGLE_APPROVER)
 *   → gate pass → DB approve → goods receipt → inspect → post
 *   → invoice → verify → payment request → approve → pay
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `p2p-${Date.now()}`;
const { record, printReport } = makeReporter('PROCUREMENT-TO-PAYMENT', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let quotationId = '';
let poId = '';
let gatePassId = '';
let goodsReceiptId = '';
let invoiceId = '';
let paymentRequestId = '';
let paymentId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[P2P] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Procurement-to-Payment', () => {
  it('creates a vendor with materials', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `P2P Vendor ${RUN_ID}`,
        vendorCode: `P2P-${RUN_ID}`,
        phone: '+919900000001',
        email: `p2p-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [{ name: `Cement ${RUN_ID}`, unit: 'bag' }, { name: `Drill ${RUN_ID}`, unit: 'pcs' }],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    const db = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { materials: true } });
    expect(db!.materials.length).toBe(2);
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates a quotation for the vendor', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [
          { materialName: `Cement ${RUN_ID}`, quantity: 100, unit: 'bag', unitPrice: 350 },
          { materialName: `Drill ${RUN_ID}`, quantity: 2, unit: 'pcs', unitPrice: 4500 },
        ],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    quotationId = res.body.id;
    const db = await prisma.quotation.findUnique({ where: { id: quotationId } });
    expect(db!.status).toBe('SUBMITTED');
    record('quotation.create', true, `quotation=${quotationId} status=${db!.status}`);
  });

  it('approves the quotation (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('quotation.approve', true, `status=APPROVED`);
  });

  it('creates a PO from the approved quotation', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(201);
    poId = res.body.id;
    const db = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    expect(db!.status).toBe('PENDING_APPROVAL');
    record('po.create', true, `po=${poId} status=${db!.status}`);
  });

  it('approves the PO (PO_SINGLE_APPROVER: ADMIN)', async () => {
    const res = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    record('po.approve', true, `status=APPROVED`);
  });

  it('creates a gate pass for the approved PO', async () => {
    const res = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB1234')
      .field('driverName', 'Suresh')
      .field('driverMobile', '+919999999998');
    expect(res.status).toBe(201);
    gatePassId = res.body.id;
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId } });
    expect(db!.status).toBe('PENDING');
    record('gatepass.create', true, `gatePass=${gatePassId} status=PENDING`);
  });

  it('approves the gate pass directly in DB (OTP bypass)', async () => {
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId } });
    expect(db!.status).toBe('APPROVED');
    record('gatepass.approve', true, `status=APPROVED`);
  });

  it('creates a goods receipt from the approved gate pass', async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({
        gatePassId,
        items: po!.items.map((it) => ({ materialName: it.materialName, deliveredQty: Number(it.quantity), unit: it.unit })),
      });
    expect(res.status).toBe(201);
    goodsReceiptId = res.body.id;
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } });
    expect(db!.status).toBe('PENDING_INSPECTION');
    record('goodsreceipt.create', true, `receipt=${goodsReceiptId}`);
  });

  it('inspects the goods receipt (mark items CONSUMABLE + ASSET)', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { items: true } });
    const res = await request
      .post(`/api/goods-receipts/${goodsReceiptId}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({
        items: gr!.items.map((it, idx) => ({
          id: it.id,
          acceptedQty: Number(it.deliveredQty),
          rejectedQty: 0,
          itemType: idx === 0 ? 'CONSUMABLE' : 'ASSET',
        })),
      });
    expect(res.status).toBe(200);
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } });
    expect(db!.status).toBe('READY_TO_POST');
    record('goodsreceipt.inspect', true, `status=READY_TO_POST`);
  });

  it('posts the goods receipt → inventory IN + assets created', async () => {
    const posterId = ctx.userAdmin2Id || ctx.userPhId;
    const res = await request.post(`/api/goods-receipts/${goodsReceiptId}/post`).set(authAs(posterId)).send({});
    expect(res.status).toBe(200);
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } });
    expect(db!.status).toBe('POSTED');
    record('goodsreceipt.post', true, `status=POSTED`);
  });

  it('creates an invoice for the PO (amount ≤ accepted goods value)', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        poId,
        invoiceNumber: `INV-${RUN_ID}`,
        amount: 44000,
        taxAmount: 0,
        totalAmount: 44000,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    invoiceId = res.body.id;
    const db = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
    expect(db!.verificationStatus).toBe('PENDING');
    record('invoice.create', true, `invoice=${invoiceId}`);
  });

  it('verifies the invoice (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.verificationStatus).toBe('VERIFIED');
    record('invoice.verify', true, `verify=VERIFIED`);
  });

  it('creates a payment request against the verified invoice', async () => {
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({
        invoiceId,
        vendorId,
        requestNumber: `PR-${RUN_ID}`,
        amount: 44000,
        paymentMode: 'BANK_TRANSFER',
        notes: 'P2P scenario payment',
      });
    expect(res.status).toBe(201);
    paymentRequestId = res.body.id;
    record('paymentrequest.create', true, `pr=${paymentRequestId}`);
  });

  it('approves the payment request (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('paymentrequest.approve', true, `status=APPROVED`);
  });

  it('records the payment (via cash account)', async () => {
    // Always create a fresh cash account with sufficient balance to avoid
    // using a depleted account from a previous scenario run.
    const cashAcct = await prisma.cashAccount.create({
      data: { projectId: ctx.projectId, name: `Cash-P2P-${RUN_ID}`, currentBalance: 500000, isActive: true },
    });
    const res = await request
      .post(`/api/payments/${paymentRequestId}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 44000, mode: 'CASH', cashAccountId: cashAcct.id, reference: `PAY-${RUN_ID}` });
    expect(res.status).toBe(201);
    paymentId = res.body.id;
    const db = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    expect(db!.status).toBe('PAID');
    record('payment.record', true, `payment=${paymentId} prStatus=PAID`);
  });

  it('verifies all entities are persisted in DB', async () => {
    const checks = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId } }),
      prisma.quotation.findUnique({ where: { id: quotationId } }),
      prisma.purchaseOrder.findUnique({ where: { id: poId } }),
      prisma.gatePass.findUnique({ where: { id: gatePassId } }),
      prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } }),
      prisma.vendorInvoice.findUnique({ where: { id: invoiceId } }),
      prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } }),
      prisma.payment.findUnique({ where: { id: paymentId } }),
    ]);
    expect(checks.every((c) => c !== null)).toBe(true);
    record('all.persisted', true, '8 entities verified');
  });
});
