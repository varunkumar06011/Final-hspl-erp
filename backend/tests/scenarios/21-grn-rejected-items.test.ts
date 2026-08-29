/**
 * Scenario 21: GRN with Rejected Items + Inspection Fail
 *
 * Tests the goods receipt inspection flow when some items are rejected:
 *   vendor → quotation → approve → PO → approve → gate pass → approve
 *   → goods receipt → inspect (partial rejection with reason) → post
 *   → verify only accepted qty enters inventory
 *
 * Also tests that rejected items require a rejection reason.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `grn-${Date.now()}`;
const { record, printReport } = makeReporter('GRN REJECTED ITEMS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let quotationId = '';
let poId = '';
let gatePassId = '';
let goodsReceiptId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[GRN] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('GRN with Rejected Items', () => {
  it('creates a vendor with two materials types', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `GRN Reject Vendor ${RUN_ID}`,
        vendorCode: `GRN-${RUN_ID}`,
        phone: '+919900000021',
        email: `grn-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [
          { name: `Good Cement ${RUN_ID}`, unit: 'bag' },
          { name: `Bad Cement ${RUN_ID}`, unit: 'bag' },
        ],
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
        items: [
          { materialName: `Good Cement ${RUN_ID}`, quantity: 100, unit: 'bag', unitPrice: 350 },
          { materialName: `Bad Cement ${RUN_ID}`, quantity: 50, unit: 'bag', unitPrice: 350 },
        ],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(qRes.status).toBe(201);
    quotationId = qRes.body.id;
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    record('quotation.approve', true, `quotation=${quotationId}`);
  });

  it('creates and approves a PO', async () => {
    const poRes = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(poRes.status).toBe(201);
    poId = poRes.body.id;
    await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    record('po.approve', true, `po=${poId}`);
  });

  it('creates and approves a gate pass (DB bypass)', async () => {
    const gpRes = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB7777')
      .field('driverName', 'Suresh')
      .field('driverMobile', '+919999999996');
    expect(gpRes.status).toBe(201);
    gatePassId = gpRes.body.id;
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });
    record('gatepass.approve', true, `gp=${gatePassId}`);
  });

  it('creates a goods receipt with full delivery', async () => {
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
    expect(res.body.status).toBe('PENDING_INSPECTION');
    record('grn.create', true, `grn=${goodsReceiptId}`);
  });

  it('rejects inspection without rejection reason for rejected items', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { items: true } });
    const res = await request
      .post(`/api/goods-receipts/${goodsReceiptId}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({
        items: gr!.items.map((it) => ({
          id: it.id,
          acceptedQty: Number(it.deliveredQty) / 2,
          rejectedQty: Number(it.deliveredQty) / 2,
          // Missing rejectionReason — should fail
          itemType: 'CONSUMABLE',
        })),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('rejection reason');
    record('inspect.missingReason', true, `400 as expected`);
  });

  it('inspects with partial rejection (50% accepted, 50% rejected with reason)', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { items: true } });
    const res = await request
      .post(`/api/goods-receipts/${goodsReceiptId}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({
        items: gr!.items.map((it) => ({
          id: it.id,
          acceptedQty: Math.floor(Number(it.deliveredQty) / 2),
          rejectedQty: Math.ceil(Number(it.deliveredQty) / 2),
          rejectionReason: 'Damaged in transit',
          itemType: 'CONSUMABLE',
        })),
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READY_TO_POST');

    // Verify inspection status is DEFECTS_FOUND
    const inspection = await prisma.inspection.findFirst({ where: { goodsReceiptId: goodsReceiptId } });
    expect(inspection!.status).toBe('DEFECTS_FOUND');
    record('inspect.partialReject', true, `status=READY_TO_POST inspection=DEFECTS_FOUND`);
  });

  it('posts the goods receipt — only accepted qty enters inventory', async () => {
    const posterId = ctx.userAdmin2Id || ctx.userPhId;
    const res = await request.post(`/api/goods-receipts/${goodsReceiptId}/post`).set(authAs(posterId)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('POSTED');
    record('grn.post', true, `status=POSTED`);

    // Verify inventory has only accepted quantities (50 + 25 = 75 total)
    const items = await prisma.inventoryItem.findMany({
      where: { name: { in: [`Good Cement ${RUN_ID}`, `Bad Cement ${RUN_ID}`] } },
    });
    const goodCement = items.find((i) => i.name === `Good Cement ${RUN_ID}`);
    const badCement = items.find((i) => i.name === `Bad Cement ${RUN_ID}`);
    expect(goodCement).toBeDefined();
    expect(badCement).toBeDefined();
    expect(Number(goodCement!.currentStock)).toBe(50); // 100 delivered, 50 accepted
    expect(Number(badCement!.currentStock)).toBe(25); // 50 delivered, 25 accepted
    record('inventory.verified', true, `good=50 bad=25 (only accepted qty)`);
  });

  it('verifies rejected quantities are recorded in DB', async () => {
    const gr = await prisma.goodsReceipt.findUnique({
      where: { id: goodsReceiptId },
      include: { items: true },
    });
    for (const item of gr!.items) {
      expect(Number(item.rejectedQty)).toBeGreaterThan(0);
      expect(item.rejectionReason).toBe('Damaged in transit');
    }
    record('rejected.recorded', true, `all items have rejectedQty + reason`);
  });
});
