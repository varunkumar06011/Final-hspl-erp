/**
 * Scenario 25: Full Regenerate PO Lifecycle with Payment + Budget Calculations
 *
 * Tests the COMPLETE financial flow of a regenerated PO, verifying that
 * budget head committed/paid amounts are correctly calculated at every step:
 *
 *   1. Create vendor + quotation (CEMENT 200 bags + GRAVEL 50 tons)
 *   2. PO linked to CEMENT budget head → approve (committedAmount += grandTotal)
 *   3. Partial delivery (only 100 bags CEMENT) → PARTIALLY_DELIVERED
 *   4. Edit PO (reduce CEMENT to 100, drop GRAVEL) → commitment adjusted
 *   5. Re-approve edited PO → DELIVERED (no additional commitment)
 *   6. Regenerate child PO for remaining GRAVEL
 *   7. Approve child PO → committedAmount += child grandTotal
 *   8. Deliver child PO (full GRAVEL delivery) → DELIVERED
 *   9. Create invoice against child PO → verify
 *  10. Payment request → approve → pay (full payment)
 *  11. Verify budget head paidAmount increased by payment amount
 *  12. Verify parent + child PO totals are consistent
 *  13. Verify invoice payment status = PAID
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `regenpay-${Date.now()}`;
const { record, printReport } = makeReporter('REGEN PO + FULL PAYMENT', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let vendorId = '';
let quotationId = '';
let poId = '';
let gatePassId1 = '';
let goodsReceiptId1 = '';
let regeneratedPoId = '';
let gatePassId2 = '';
let goodsReceiptId2 = '';
let invoiceId = '';
let paymentRequestId = '';
let paymentId = '';

// Budget head
let cementHeadId = '';

// Snapshot of budget head committed amount at various stages
let committedBeforeOriginal = 0;
let committedAfterOriginal = 0;
let committedAfterGrn1 = 0;
let committedAfterEdit = 0;
let committedAfterRegen = 0;
let committedAfterRegenApprove = 0;
let committedAfterGrn2 = 0;
let paidBeforePayment = 0;
let paidAfterPayment = 0;

// PO totals
let originalGrandTotal = 0;
let editedGrandTotal = 0;
let regenGrandTotal = 0;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[REGEN-PAY] run=${RUN_ID} project=${ctx.projectName}`);

  // Find or create CEMENT budget head
  let head = await prisma.budgetHead.findFirst({
    where: { projectId: ctx.projectId, deletedAt: null, particulars: 'CEMENT' },
  });
  if (!head) {
    head = await prisma.budgetHead.create({
      data: { projectId: ctx.projectId, particulars: 'CEMENT', allocatedAmount: 5000000 },
    });
  }
  cementHeadId = head.id;
  console.log(`[REGEN-PAY] CEMENT budget head: ${cementHeadId}`);
});

afterAll(() => printReport());

describe('Full Regenerate PO Lifecycle with Payment', () => {
  // ─── Step 1: Vendor + Quotation ───────────────────────────
  it('creates a vendor supplying CEMENT + GRAVEL', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(ctx.userPhId))
      .send({
        name: `RegenPay Vendor ${RUN_ID}`,
        vendorCode: `RPY-${RUN_ID}`,
        phone: '+919900000025',
        email: `rpy-${RUN_ID}@test.com`,
        address: 'Test Address',
        materials: [
          { name: 'CEMENT', unit: 'bag' },
          { name: 'GRAVEL', unit: 'ton' },
        ],
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    record('vendor.create', true, `vendor=${vendorId}`);
  });

  it('creates a quotation: CEMENT 200 bags @350 + GRAVEL 50 tons @1200 (gst 5%)', async () => {
    // CEMENT: 200 * 350 = 70000, GRAVEL: 50 * 1200 = 60000
    // total = 130000, gst = 60000*5% = 3000, grand = 133000
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        items: [
          { materialName: 'CEMENT', quantity: 200, unit: 'bag', unitPrice: 350, gstRate: 0 },
          { materialName: 'GRAVEL', quantity: 50, unit: 'ton', unitPrice: 1200, gstRate: 5 },
        ],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    quotationId = res.body.id;
    record('quotation.create', true, `q=${quotationId} CEMENT+GRAVEL`);
  });

  it('approves the quotation (3 approvers — grandTotal > 100000)', async () => {
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    const res = await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(ctx.userAdmin2Id)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    record('quotation.approve', true, `3 approvers`);
  });

  // ─── Step 2: Original PO + Approve ───────────────────────────
  it('creates PO linked to CEMENT budget head', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', budgetHeadId: cementHeadId, acknowledged: true });
    expect(res.status).toBe(201);
    poId = res.body.id;
    originalGrandTotal = Number(res.body.grandTotal);
    // CEMENT 70000 + GRAVEL 60000 + GST 3000 = 133000
    expect(originalGrandTotal).toBe(133000);
    record('po.create', true, `po=${poId} grandTotal=${originalGrandTotal}`);
  });

  it('snapshots budget head committed before PO approval', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedBeforeOriginal = Number(head!.committedAmount);
    record('budget.snapshot1', true, `committedBefore=${committedBeforeOriginal}`);
  });

  it('approves the PO (ADMIN) — committedAmount increases by grandTotal', async () => {
    const res = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterOriginal = Number(head!.committedAmount);
    expect(committedAfterOriginal).toBe(committedBeforeOriginal + originalGrandTotal);
    record('po.approve', true, `committed: ${committedBeforeOriginal} → ${committedAfterOriginal} (delta=${originalGrandTotal})`);
  });

  // ─── Step 3: Partial Delivery ───────────────────────────
  it('creates + approves gate pass for partial delivery (100 bags CEMENT)', async () => {
    const gpRes = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB5555')
      .field('driverName', 'Test Driver')
      .field('driverMobile', '+919999999993');
    expect(gpRes.status).toBe(201);
    gatePassId1 = gpRes.body.id;
    await prisma.gatePass.update({
      where: { id: gatePassId1 },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });
    record('gatepass1.approve', true, `gp=${gatePassId1}`);
  });

  it('delivers 100 bags CEMENT (partial — GRAVEL not delivered)', async () => {
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({ gatePassId: gatePassId1, items: [{ materialName: 'CEMENT', deliveredQty: 100, unit: 'bag' }] });
    expect(res.status).toBe(201);
    goodsReceiptId1 = res.body.id;
    record('grn1.partial', true, `grn=${goodsReceiptId1} CEMENT=100bags`);
  });

  it('inspects + posts the goods receipt — committed decreases by GRN value', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId1 }, include: { items: true } });
    await request
      .post(`/api/goods-receipts/${goodsReceiptId1}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({ items: gr!.items.map((it) => ({ id: it.id, acceptedQty: 100, rejectedQty: 0, itemType: 'CONSUMABLE' })) });
    const posterId = ctx.userAdmin2Id || ctx.userPhId;
    const postRes = await request.post(`/api/goods-receipts/${goodsReceiptId1}/post`).set(authAs(posterId)).send({});
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('POSTED');
    // GRN posting converts committed → actual: committed -= 35000 (100 bags * 350, no GST)
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterGrn1 = Number(head!.committedAmount);
    const grn1Value = 100 * 350; // 35000 (CEMENT, no GST)
    expect(committedAfterGrn1).toBe(committedAfterOriginal - grn1Value);
    record('grn1.post', true, `status=POSTED committed: ${committedAfterOriginal} → ${committedAfterGrn1} (delta=-${grn1Value})`);
  });

  it('verifies PO is PARTIALLY_DELIVERED', async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    expect(po!.status).toBe('PARTIALLY_DELIVERED');
    record('po.partiallyDelivered', true, `status=PARTIALLY_DELIVERED`);
  });

  // ─── Step 4: Edit PO ───────────────────────────
  it('edits PO: keep CEMENT 100 bags, drop GRAVEL', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/edit`)
      .set(authAs(ctx.userPhId))
      .send({
        items: [{ materialName: 'CEMENT', quantity: 100, unit: 'bag', unitPrice: 350, gstRate: 0 }],
        editReason: 'GRAVEL not delivered, will regenerate',
      });
    expect(res.status).toBe(200);
    editedGrandTotal = Number(res.body.grandTotal);
    // CEMENT 100 * 350 = 35000, no GST = 35000
    expect(editedGrandTotal).toBe(35000);
    record('po.edit', true, `editedGrandTotal=${editedGrandTotal}`);
  });

  it('verifies budget head committed adjusted correctly after edit', async () => {
    // After GRN1: committed = committedAfterOriginal - 35000
    // Edit adjustment = (newGrandTotal - oldGrandTotal) + deliveredForDeselected
    //   = (35000 - 133000) + 0 = -98000 (GRAVEL not delivered, so deliveredForDeselected=0)
    // committedAfterEdit = committedAfterGrn1 + (-98000)
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterEdit = Number(head!.committedAmount);
    const expectedAdjustment = editedGrandTotal - originalGrandTotal; // -98000
    expect(committedAfterEdit).toBe(committedAfterGrn1 + expectedAdjustment);
    record('budget.afterEdit', true, `committed=${committedAfterEdit} (from ${committedAfterGrn1}, delta=${expectedAdjustment})`);
  });

  // ─── Step 5: Re-approve Edited PO ───────────────────────────
  it('re-approves the edited PO — committedAmount unchanged (editedAt set)', async () => {
    const res = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'edited ok' });
    expect(res.body.status).toBe('DELIVERED');
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    const committedAfterReapprove = Number(head!.committedAmount);
    // Should be same as after edit — re-approval does NOT add commitment for edited POs
    expect(committedAfterReapprove).toBe(committedAfterEdit);
    record('po.reapprove', true, `committed unchanged=${committedAfterReapprove}`);
  });

  // ─── Step 6: Regenerate Child PO ───────────────────────────
  it('snapshots budget head committed before regeneration', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterRegen = Number(head!.committedAmount);
    // Regeneration creates the child PO but does NOT change committedAmount yet
    record('budget.snapshot2', true, `committedBeforeRegen=${committedAfterRegen}`);
  });

  it('regenerates child PO for remaining CEMENT 100 + GRAVEL 50', async () => {
    const res = await request.post(`/api/purchase-orders/${poId}/regenerate`).set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(200);
    regeneratedPoId = res.body.id;
    regenGrandTotal = Number(res.body.grandTotal);
    // Remaining: CEMENT 100*350=35000 (no GST) + GRAVEL 50*1200=60000 + GST 5%=3000 → 98000
    expect(regenGrandTotal).toBe(98000);
    expect(res.body.parentPoId).toBe(poId);
    expect(res.body.budgetHeadId).toBe(cementHeadId);
    expect(res.body.items.length).toBe(2);
    const materials = res.body.items.map((i: { materialName: string }) => i.materialName);
    expect(materials).toContain('CEMENT');
    expect(materials).toContain('GRAVEL');
    record('po.regenerate', true, `childPO=${regeneratedPoId} grandTotal=${regenGrandTotal} items=CEMENT100+GRAVEL50`);
  });

  it('verifies committedAmount unchanged after regeneration (before child approval)', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    const committed = Number(head!.committedAmount);
    expect(committed).toBe(committedAfterRegen);
    record('budget.afterRegen', true, `committed unchanged=${committed}`);
  });

  // ─── Step 7: Approve Child PO ───────────────────────────
  it('approves the regenerated child PO — committedAmount increases by child grandTotal', async () => {
    const res = await request.post(`/api/purchase-orders/${regeneratedPoId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'regen ok' });
    expect(res.body.status).toBe('APPROVED');
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterRegenApprove = Number(head!.committedAmount);
    // Child PO is NOT edited (editedAt = null), so approval adds its grandTotal (98000)
    expect(committedAfterRegenApprove).toBe(committedAfterRegen + regenGrandTotal);
    record('po.regen.approve', true, `committed: ${committedAfterRegen} → ${committedAfterRegenApprove} (delta=${regenGrandTotal})`);
  });

  // ─── Step 8: Full Delivery of Child PO ───────────────────────────
  it('creates + approves gate pass for child PO (full GRAVEL delivery)', async () => {
    const gpRes = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', regeneratedPoId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB6666')
      .field('driverName', 'Test Driver 2')
      .field('driverMobile', '+919999999992');
    expect(gpRes.status).toBe(201);
    gatePassId2 = gpRes.body.id;
    await prisma.gatePass.update({
      where: { id: gatePassId2 },
      data: { status: 'APPROVED', otpApprovedBy: ctx.userHocId, otpApprovedAt: new Date() },
    });
    record('gatepass2.approve', true, `gp=${gatePassId2}`);
  });

  it('delivers full GRAVEL (50 tons) against child PO', async () => {
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({ gatePassId: gatePassId2, items: [{ materialName: 'GRAVEL', deliveredQty: 50, unit: 'ton' }] });
    expect(res.status).toBe(201);
    goodsReceiptId2 = res.body.id;
    record('grn2.full', true, `grn=${goodsReceiptId2} GRAVEL=50tons`);
  });

  it('inspects + posts the child PO goods receipt — committed decreases by GRN value', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId2 }, include: { items: true } });
    await request
      .post(`/api/goods-receipts/${goodsReceiptId2}/inspect`)
      .set(authAs(ctx.userHocId))
      .send({ items: gr!.items.map((it) => ({ id: it.id, acceptedQty: 50, rejectedQty: 0, itemType: 'CONSUMABLE' })) });
    const posterId = ctx.userAdmin2Id || ctx.userPhId;
    const postRes = await request.post(`/api/goods-receipts/${goodsReceiptId2}/post`).set(authAs(posterId)).send({});
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('POSTED');
    // GRN posting converts committed → actual: committed -= grnValue (63000), actual += 63000
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    committedAfterGrn2 = Number(head!.committedAmount);
    const grnValue = 50 * 1200 + 50 * 1200 * 5 / 100; // 60000 + 3000 = 63000
    expect(committedAfterGrn2).toBe(committedAfterRegenApprove - grnValue);
    record('grn2.post', true, `status=POSTED committed: ${committedAfterRegenApprove} → ${committedAfterGrn2} (delta=-${grnValue})`);
  });

  it('verifies child PO is PARTIALLY_DELIVERED (GRAVEL delivered, CEMENT not)', async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: regeneratedPoId } });
    expect(po!.status).toBe('PARTIALLY_DELIVERED');
    record('po.regen.partiallyDelivered', true, `status=PARTIALLY_DELIVERED (GRAVEL done, CEMENT pending)`);
  });

  // ─── Step 9: Invoice Against Child PO ───────────────────────────
  it('creates an invoice against the child PO for delivered GRAVEL (63000)', async () => {
    // Invoice for GRAVEL only: amount=60000, tax=3000, total=63000
    // (CEMENT 100 in child PO was not delivered, so not invoiced)
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId,
        poId: regeneratedPoId,
        invoiceNumber: `INV-REGEN-${RUN_ID}`,
        amount: 60000,
        taxAmount: 3000,
        totalAmount: 63000,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    invoiceId = res.body.id;
    record('invoice.create', true, `invoice=${invoiceId} total=63000 (GRAVEL only)`);
  });

  it('verifies the invoice (PH + ADMIN)', async () => {
    await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res = await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.verificationStatus).toBe('VERIFIED');
    record('invoice.verify', true, `status=VERIFIED`);
  });

  // ─── Step 10: Full Payment ───────────────────────────
  it('snapshots budget head paidAmount before payment', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    paidBeforePayment = Number(head!.paidAmount);
    record('budget.snapshot3', true, `paidBefore=${paidBeforePayment}`);
  });

  it('creates a payment request against the verified invoice', async () => {
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({
        invoiceId,
        vendorId,
        requestNumber: `PR-REGEN-${RUN_ID}`,
        amount: 63000,
        paymentMode: 'CASH',
        notes: 'Full payment for regenerated PO',
      });
    expect(res.status).toBe(201);
    paymentRequestId = res.body.id;
    record('paymentrequest.create', true, `pr=${paymentRequestId}`);
  });

  it('approves the payment request (PH + ADMIN)', async () => {
    await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res = await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    record('paymentrequest.approve', true, `status=APPROVED`);
  });

  it('records the full payment (via cash account)', async () => {
    const cashAcct = await prisma.cashAccount.create({
      data: { projectId: ctx.projectId, name: `Cash-RegenPay-${RUN_ID}`, currentBalance: 500000, isActive: true },
    });
    const res = await request
      .post(`/api/payments/${paymentRequestId}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 63000, mode: 'CASH', cashAccountId: cashAcct.id, reference: `PAY-REGEN-${RUN_ID}` });
    expect(res.status).toBe(201);
    paymentId = res.body.id;
    const db = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    expect(db!.status).toBe('PAID');
    record('payment.record', true, `payment=${paymentId} prStatus=PAID`);
  });

  // ─── Step 11: Verify Budget Head Paid Amount ───────────────────────────
  it('verifies budget head paidAmount increased by payment amount', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    paidAfterPayment = Number(head!.paidAmount);
    expect(paidAfterPayment).toBe(paidBeforePayment + 63000);
    record('budget.paidAmount', true, `paid: ${paidBeforePayment} → ${paidAfterPayment} (delta=63000)`);
  });

  // ─── Step 12: Verify Invoice Payment Status ───────────────────────────
  it('verifies invoice paymentStatus is PAID', async () => {
    const inv = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
    expect(inv!.paymentStatus).toBe('PAID');
    record('invoice.paid', true, `paymentStatus=PAID`);
  });

  it('verifies invoice outstanding is 0 via /invoices/:id/payments', async () => {
    const res = await request.get(`/api/invoices/${invoiceId}/payments`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(Number(res.body.invoice.outstanding)).toBe(0);
    expect(Number(res.body.invoice.paidToDate)).toBe(63000);
    expect(res.body.invoice.paymentStatus).toBe('PAID');
    record('invoice.outstanding', true, `outstanding=0 paidToDate=63000`);
  });

  // ─── Step 13: Verify Parent + Child PO Total Consistency ───────────────────────────
  it('verifies parent + child PO grand totals are consistent', async () => {
    const [parent, child] = await Promise.all([
      prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } }),
      prisma.purchaseOrder.findUnique({ where: { id: regeneratedPoId }, include: { items: true } }),
    ]);
    // Parent (edited) = CEMENT 100 bags = 35000 (no GST)
    // Child (regenerated) = CEMENT 100*350 + GRAVEL 50*1200 + GST 3000 = 98000
    // Sum = 133000 = original grandTotal (the split preserves the original total)
    expect(Number(parent!.grandTotal)).toBe(35000);
    expect(Number(child!.grandTotal)).toBe(98000);
    expect(Number(parent!.grandTotal) + Number(child!.grandTotal)).toBe(133000);
    record('po.totals', true, `parent=${parent!.grandTotal} child=${child!.grandTotal} sum=133000 (matches original)`);
  });

  it('verifies parent PO items match edited state (CEMENT 100 only)', async () => {
    const parent = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    expect(parent!.items.length).toBe(1);
    expect(parent!.items[0].materialName).toBe('CEMENT');
    expect(Number(parent!.items[0].quantity)).toBe(100);
    record('po.parent.items', true, `CEMENT=100bags`);
  });

  it('verifies child PO items match regeneration data (CEMENT 100 + GRAVEL 50)', async () => {
    const child = await prisma.purchaseOrder.findUnique({ where: { id: regeneratedPoId }, include: { items: true } });
    expect(child!.items.length).toBe(2);
    const cement = child!.items.find((i) => i.materialName === 'CEMENT');
    const gravel = child!.items.find((i) => i.materialName === 'GRAVEL');
    expect(cement).toBeDefined();
    expect(gravel).toBeDefined();
    expect(Number(cement!.quantity)).toBe(100);
    expect(Number(gravel!.quantity)).toBe(50);
    record('po.child.items', true, `CEMENT=100bags GRAVEL=50tons`);
  });

  it('verifies parent-child linkage is intact', async () => {
    const [parent, child] = await Promise.all([
      prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { childPos: true } }),
      prisma.purchaseOrder.findUnique({ where: { id: regeneratedPoId } }),
    ]);
    expect(parent!.childPos.length).toBe(1);
    expect(parent!.childPos[0].id).toBe(regeneratedPoId);
    expect(child!.parentPoId).toBe(poId);
    expect(child!.regenerationNumber).toBe(1);
    record('po.linkage', true, `parent→child verified`);
  });

  it('verifies all entities are persisted in DB', async () => {
    const checks = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId } }),
      prisma.quotation.findUnique({ where: { id: quotationId } }),
      prisma.purchaseOrder.findUnique({ where: { id: poId } }),
      prisma.purchaseOrder.findUnique({ where: { id: regeneratedPoId } }),
      prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId1 } }),
      prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId2 } }),
      prisma.vendorInvoice.findUnique({ where: { id: invoiceId } }),
      prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } }),
      prisma.payment.findUnique({ where: { id: paymentId } }),
    ]);
    expect(checks.every((c) => c !== null)).toBe(true);
    record('all.persisted', true, '9 entities verified');
  });

  // ─── Summary: Budget Head Final State ───────────────────────────
  it('verifies budget head final state is consistent', async () => {
    const head = await prisma.budgetHead.findUnique({ where: { id: cementHeadId } });
    const finalCommitted = Number(head!.committedAmount);
    const finalPaid = Number(head!.paidAmount);
    // Committed = committedAfterGrn2 (GRN2 converted 63000 from committed to actual)
    // No further commitment changes after GRN2 (payment only affects paidAmount)
    expect(finalCommitted).toBe(committedAfterGrn2);
    // Paid = paidBeforePayment + 63000 (the full invoice payment)
    expect(finalPaid).toBe(paidAfterPayment);
    record('budget.final', true, `committed=${finalCommitted} paid=${finalPaid}`);
  });
});
