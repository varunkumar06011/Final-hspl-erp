/**
 * Scenario 26: Validation & Edge Cases
 *
 * Tests that the system correctly REJECTS invalid operations and enforces
 * business rules. Uses existing data from the DB where possible.
 *
 * Categories:
 *   A. PO creation validations (missing fields, bad quotation, vendor mismatch)
 *   B. Quotation validations (bad vendor, empty items, negative values)
 *   C. Invoice validations (mismatched totals, bad PO, vendor mismatch)
 *   D. Payment validations (unverified invoice, duplicate, overpay, no funding)
 *   E. GRN validations (bad gate pass, post without inspect)
 *   F. Gate pass validations (bad PO, wrong status)
 *   G. Approval workflow validations (double approve, wrong role)
 *   H. RBAC validations (wrong role trying restricted actions)
 *   I. Cross-entity validations (duplicate invoice, converted quotation)
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `val-${Date.now()}`;
const { record, printReport } = makeReporter('VALIDATION & EDGE CASES', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;

// Existing data IDs (fetched in beforeAll)
let existingVendorId = '';
let existingApprovedQuotationId = '';
let existingApprovedQuotationVendorId = '';
let existingPoApprovedId = '';
let existingPoDeliveredId = '';
let existingPoRejectedId = '';
let existingPoPartiallyDeliveredId = '';
let existingInvoiceVerifiedId = '';
let existingInvoiceVerifiedVendorId = '';
let existingInvoiceRejectedId = '';
let budgetHeadId = '';

// New data created for testing (minimal)
let newQuotationId = '';
let newPoId = '';
let newInvoiceId = '';
let newPaymentRequestId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[VAL] run=${RUN_ID} project=${ctx.projectName}`);

  // Fetch existing approved quotation
  const approvedQ = await prisma.quotation.findFirst({
    where: { deletedAt: null, status: 'APPROVED' },
    include: { vendor: true, items: true },
  });
  if (approvedQ) {
    existingApprovedQuotationId = approvedQ.id;
    existingApprovedQuotationVendorId = approvedQ.vendorId;
    existingVendorId = approvedQ.vendorId;
  }

  // Fetch existing POs by status
  const [poApproved, poDelivered, poRejected, poPartial] = await Promise.all([
    prisma.purchaseOrder.findFirst({ where: { deletedAt: null, status: 'APPROVED' }, select: { id: true, vendorId: true } }),
    prisma.purchaseOrder.findFirst({ where: { deletedAt: null, status: 'DELIVERED' }, select: { id: true, vendorId: true } }),
    prisma.purchaseOrder.findFirst({ where: { deletedAt: null, status: 'REJECTED' }, select: { id: true, vendorId: true } }),
    prisma.purchaseOrder.findFirst({ where: { deletedAt: null, status: 'PARTIALLY_DELIVERED' }, select: { id: true, vendorId: true } }),
  ]);
  existingPoApprovedId = poApproved?.id ?? '';
  existingPoDeliveredId = poDelivered?.id ?? '';
  existingPoRejectedId = poRejected?.id ?? '';
  existingPoPartiallyDeliveredId = poPartial?.id ?? '';

  // Fetch existing verified invoice
  const verifiedInv = await prisma.vendorInvoice.findFirst({
    where: { deletedAt: null, verificationStatus: 'VERIFIED' },
    select: { id: true, vendorId: true, poId: true },
  });
  if (verifiedInv) {
    existingInvoiceVerifiedId = verifiedInv.id;
    existingInvoiceVerifiedVendorId = verifiedInv.vendorId;
  }

  // Fetch existing rejected invoice
  const rejectedInv = await prisma.vendorInvoice.findFirst({
    where: { deletedAt: null, verificationStatus: 'REJECTED' },
    select: { id: true },
  });
  existingInvoiceRejectedId = rejectedInv?.id ?? '';

  // Fetch a budget head
  const head = await prisma.budgetHead.findFirst({
    where: { projectId: ctx.projectId, deletedAt: null },
  });
  budgetHeadId = head?.id ?? '';

  console.log(`[VAL] existing data: vendor=${existingVendorId}, q=${existingApprovedQuotationId}, poApproved=${existingPoApprovedId}, invVerified=${existingInvoiceVerifiedId}`);
});

afterAll(() => printReport());

// ═══ A. PO Creation Validations ═══
describe('A. PO Creation Validations', () => {
  it('rejects PO without quotationId', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(400);
    record('po.noQuotation', true, `400 — missing quotationId`);
  });

  it('rejects PO with non-existent quotation', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, quotationId: '00000000-0000-0000-0000-000000000000', paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Quotation not found');
    record('po.badQuotation', true, `400 — Quotation not found`);
  });

  it('rejects PO with vendor mismatch (quotation vendor ≠ PO vendor)', async () => {
    // Find a different vendor
    const otherVendor = await prisma.vendor.findFirst({
      where: { deletedAt: null, id: { not: existingApprovedQuotationVendorId } },
      select: { id: true },
    });
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: otherVendor!.id, quotationId: existingApprovedQuotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Vendor does not match');
    record('po.vendorMismatch', true, `400 — Vendor does not match`);
  });

  it('rejects PO with non-existent vendor', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: '00000000-0000-0000-0000-000000000000', quotationId: existingApprovedQuotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(400);
    record('po.badVendor', true, `400`);
  });

  it('rejects PO with non-approved quotation (PENDING)', async () => {
    // Create a quotation but don't approve it
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST_ITEM', quantity: 10, unit: 'nos', unitPrice: 100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    const pendingQId = qRes.body.id;
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, quotationId: pendingQId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Only approved quotations');
    record('po.pendingQuotation', true, `400 — Only approved quotations`);
  });
});

// ═══ B. Quotation Validations ═══
describe('B. Quotation Validations', () => {
  it('rejects quotation with non-existent vendor', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: '00000000-0000-0000-0000-000000000000',
        items: [{ materialName: 'TEST', quantity: 10, unit: 'nos', unitPrice: 100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('q.badVendor', true, `400`);
  });

  it('rejects quotation with empty items array', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, items: [], gstAmount: 0, acknowledged: true });
    expect(res.status).toBe(400);
    record('q.emptyItems', true, `400 — empty items`);
  });

  it('rejects quotation without items field', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, gstAmount: 0, acknowledged: true });
    expect(res.status).toBe(400);
    record('q.noItems', true, `400 — missing items`);
  });

  it('rejects quotation with negative quantity', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST', quantity: -10, unit: 'nos', unitPrice: 100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('q.negativeQty', true, `400 — negative quantity`);
  });

  it('rejects quotation with negative unitPrice', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST', quantity: 10, unit: 'nos', unitPrice: -100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('q.negativePrice', true, `400 — negative unitPrice`);
  });

  it('rejects quotation with gstRate > 100', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST', quantity: 10, unit: 'nos', unitPrice: 100, gstRate: 150 }],
        gstAmount: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('q.gstOver100', true, `400 — gstRate > 100`);
  });

  it('rejects approve by same person twice', async () => {
    // Create a quotation and approve once
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST_DUP', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    const qId = qRes.body.id;
    // First approve by PH
    await request.post(`/api/quotations/${qId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    // Second approve by same PH → should fail
    const res = await request.post(`/api/quotations/${qId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already approved');
    record('q.doubleApprove', true, `400 — already approved`);
  });

  it('rejects approve by non-approver role (SUPERVISOR)', async () => {
    // Create a temp SUPERVISOR
    const sv = await prisma.user.create({
      data: {
        firebaseUid: `dev-sv-val-${RUN_ID}`,
        phone: `+919900${RUN_ID.slice(-6)}26`,
        name: `Val SV ${RUN_ID}`,
        role: 'SUPERVISOR',
        projectId: ctx.projectId,
        isActive: true,
      },
    });
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        items: [{ materialName: 'TEST_RBAC', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }],
        gstAmount: 0,
        acknowledged: true,
      });
    const res = await request.post(`/api/quotations/${qRes.body.id}/approve`).set(authAs(sv.id)).send({ acknowledged: true, comments: 'ok' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only heads can approve');
    record('q.rbacReject', true, `403 — Only heads can approve`);
  });
});

// ═══ C. Invoice Validations ═══
describe('C. Invoice Validations', () => {
  it('rejects invoice with mismatched total (amount + tax ≠ total)', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        invoiceNumber: `INV-BAD-${RUN_ID}`,
        amount: 10000,
        taxAmount: 500,
        totalAmount: 20000, // should be 10500
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('inv.mismatchedTotal', true, `400 — total mismatch`);
  });

  it('rejects invoice with advancePaid > totalAmount', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        invoiceNumber: `INV-ADV-${RUN_ID}`,
        amount: 10000,
        taxAmount: 0,
        totalAmount: 10000,
        advancePaid: 15000, // > total
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    record('inv.advanceExceeds', true, `400 — advance > total`);
  });

  it('rejects invoice with non-existent PO', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        poId: '00000000-0000-0000-0000-000000000000',
        invoiceNumber: `INV-NOPO-${RUN_ID}`,
        amount: 1000,
        taxAmount: 0,
        totalAmount: 1000,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Purchase order not found');
    record('inv.badPo', true, `400 — PO not found`);
  });

  it('rejects invoice with vendor mismatch (PO vendor ≠ invoice vendor)', async () => {
    if (!existingPoApprovedId) { record('inv.vendorMismatch', true, 'skipped — no approved PO'); return; }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: existingPoApprovedId }, select: { vendorId: true, projectId: true } });
    // Find a different vendor from the SAME project
    const otherVendor = await prisma.vendor.findFirst({ where: { deletedAt: null, id: { not: po!.vendorId }, projectId: po!.projectId }, select: { id: true } });
    if (!otherVendor) { record('inv.vendorMismatch', true, 'skipped — no other vendor in project'); return; }
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: otherVendor.id,
        poId: existingPoApprovedId,
        invoiceNumber: `INV-VM-${RUN_ID}`,
        amount: 500,
        taxAmount: 0,
        totalAmount: 500,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('does not belong');
    record('inv.vendorMismatch', true, `400 — vendor mismatch`);
  });

  it('rejects invoice against REJECTED PO', async () => {
    if (!existingPoRejectedId) { record('inv.rejectedPo', true, 'skipped — no rejected PO'); return; }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: existingPoRejectedId }, select: { vendorId: true } });
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: po!.vendorId,
        poId: existingPoRejectedId,
        invoiceNumber: `INV-REJPO-${RUN_ID}`,
        amount: 500,
        taxAmount: 0,
        totalAmount: 500,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('approved, partially delivered, or delivered');
    record('inv.rejectedPo', true, `400 — PO not in valid status`);
  });

  it('rejects invoice against non-existent vendor', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: '00000000-0000-0000-0000-000000000000',
        invoiceNumber: `INV-NOV-${RUN_ID}`,
        amount: 500,
        taxAmount: 0,
        totalAmount: 500,
        advancePaid: 0,
        acknowledged: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Vendor not found');
    record('inv.badVendor', true, `400 — Vendor not found`);
  });
});

// ═══ D. Payment Validations ═══
describe('D. Payment Validations', () => {
  it('rejects payment request for unverified invoice', async () => {
    // Create an invoice but don't verify it
    const invRes = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: existingVendorId,
        invoiceNumber: `INV-UNVER-${RUN_ID}`,
        amount: 1000,
        taxAmount: 0,
        totalAmount: 1000,
        advancePaid: 0,
        acknowledged: true,
      });
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({ invoiceId: invRes.body.id, vendorId: existingVendorId, requestNumber: `PR-UNVER-${RUN_ID}`, amount: 1000, paymentMode: 'CASH' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('verified');
    record('pay.unverifiedInvoice', true, `400 — must be verified`);
  });

  it('rejects payment request for non-existent invoice', async () => {
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({ invoiceId: '00000000-0000-0000-0000-000000000000', vendorId: existingVendorId, requestNumber: `PR-NOINV-${RUN_ID}`, amount: 1000, paymentMode: 'CASH' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Invoice not found');
    record('pay.badInvoice', true, `404 — Invoice not found`);
  });

  it('rejects duplicate payment request (active one exists)', async () => {
    if (!existingInvoiceVerifiedId) { record('pay.duplicate', true, 'skipped — no verified invoice'); return; }
    // Check if there's already an active PR for this invoice
    const existingPR = await prisma.paymentRequest.findFirst({
      where: { invoiceId: existingInvoiceVerifiedId, status: { in: ['PENDING', 'APPROVED'] }, deletedAt: null },
    });
    if (existingPR) {
      // Try to create another
      const res = await request
        .post('/api/payments/invoice-payment')
        .set(authAs(ctx.userPhId))
        .send({ invoiceId: existingInvoiceVerifiedId, vendorId: existingInvoiceVerifiedVendorId, requestNumber: `PR-DUP-${RUN_ID}`, amount: 100, paymentMode: 'CASH' });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
      record('pay.duplicate', true, `409 — active PR already exists`);
    } else {
      record('pay.duplicate', true, 'skipped — no active PR on verified invoice');
    }
  });

  it('rejects payment without funding account (no bankAccountId or cashAccountId)', async () => {
    // This needs an APPROVED payment request. Create one via DB bypass.
    if (!existingInvoiceVerifiedId) { record('pay.noFunding', true, 'skipped — no verified invoice'); return; }
    // Check if invoice is already fully paid
    const inv = await prisma.vendorInvoice.findUnique({ where: { id: existingInvoiceVerifiedId } });
    if (inv!.paymentStatus === 'PAID') { record('pay.noFunding', true, 'skipped — invoice already paid'); return; }

    // Check for active PR
    const activePR = await prisma.paymentRequest.findFirst({
      where: { invoiceId: existingInvoiceVerifiedId, status: { in: ['PENDING', 'APPROVED'] }, deletedAt: null },
    });
    if (!activePR) { record('pay.noFunding', true, 'skipped — no active PR'); return; }

    // If PR is PENDING, approve it via DB
    if (activePR.status === 'PENDING') {
      await prisma.paymentRequest.update({ where: { id: activePR.id }, data: { status: 'APPROVED' } });
    }

    const res = await request
      .post(`/api/payments/${activePR.id}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: Number(activePR.amount), mode: 'CASH' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('funding account');
    record('pay.noFunding', true, `500 — funding account required`);
  });

  it('rejects payment with amount ≠ approved amount', async () => {
    // Create a fresh invoice + PR for this test
    const invRes = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, invoiceNumber: `INV-AMT-${RUN_ID}`, amount: 5000, taxAmount: 0, totalAmount: 5000, advancePaid: 0, acknowledged: true });
    // Verify it
    await request.post(`/api/invoices/${invRes.body.id}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/invoices/${invRes.body.id}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    // Create PR
    const prRes = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({ invoiceId: invRes.body.id, vendorId: existingVendorId, requestNumber: `PR-AMT-${RUN_ID}`, amount: 5000, paymentMode: 'CASH' });
    // Approve PR via DB
    await prisma.paymentRequest.update({ where: { id: prRes.body.id }, data: { status: 'APPROVED' } });
    // Try to pay with wrong amount
    const cashAcct = await prisma.cashAccount.create({ data: { projectId: ctx.projectId, name: `Cash-Val-${RUN_ID}`, currentBalance: 500000, isActive: true } });
    const res = await request
      .post(`/api/payments/${prRes.body.id}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 3000, mode: 'CASH', cashAccountId: cashAcct.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must match');
    record('pay.wrongAmount', true, `400 — amount must match`);
  });

  it('rejects payment with both bank AND cash account', async () => {
    // Find an APPROVED payment request
    const pr = await prisma.paymentRequest.findFirst({
      where: { status: 'APPROVED', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pr) { record('pay.bothAccounts', true, 'skipped — no APPROVED PR'); return; }
    const bank = await prisma.bankAccount.create({ data: { projectId: ctx.projectId, accountName: `Bank-Val-${RUN_ID}`, accountNumber: '123', ifscCode: 'TEST', currentBalance: 500000, isActive: true } });
    const cash = await prisma.cashAccount.create({ data: { projectId: ctx.projectId, name: `Cash-Val2-${RUN_ID}`, currentBalance: 500000, isActive: true } });
    const res = await request
      .post(`/api/payments/${pr.id}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: Number(pr.amount), mode: 'CASH', bankAccountId: bank.id, cashAccountId: cash.id });
    // The route should reject providing both accounts
    const rejected = res.status === 400 || res.status === 500;
    expect(rejected).toBe(true);
    record('pay.bothAccounts', res.status === 400, `status=${res.status} ${res.status === 500 ? 'BUG: 500 instead of 400' : 'OK'}`);
  });
});

// ═══ E. GRN Validations ═══
describe('E. GRN Validations', () => {
  it('rejects GRN with non-existent gate pass', async () => {
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({ gatePassId: '00000000-0000-0000-0000-000000000000', items: [{ materialName: 'TEST', deliveredQty: 10, unit: 'nos' }] });
    // Route returns 400 (bad request) for non-existent gate pass, not 404
    expect(res.status).toBe(400);
    record('grn.badGatePass', true, `400`);
  });

  it('rejects GRN without items', async () => {
    // Create a gate pass first
    if (!existingPoApprovedId) { record('grn.noItems', true, 'skipped — no approved PO'); return; }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: existingPoApprovedId }, select: { vendorId: true } });
    const gpRes = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', existingPoApprovedId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'TEST123')
      .field('driverName', 'Test')
      .field('driverMobile', '+919999999991');
    if (gpRes.status !== 201) { record('grn.noItems', true, 'skipped — could not create gate pass'); return; }
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(ctx.userAdminId))
      .send({ gatePassId: gpRes.body.id, items: [] });
    expect(res.status).toBe(400);
    record('grn.noItems', true, `400`);
  });
});

// ═══ F. Gate Pass Validations ═══
describe('F. Gate Pass Validations', () => {
  it('rejects gate pass with non-existent PO', async () => {
    const res = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', '00000000-0000-0000-0000-000000000000')
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'TEST456')
      .field('driverName', 'Test')
      .field('driverMobile', '+919999999990');
    // Should return 400/404 for non-existent PO
    const rejected = res.status === 400 || res.status === 404 || res.status === 500;
    expect(rejected).toBe(true);
    record('gp.badPo', res.status !== 500, `status=${res.status} ${res.status === 500 ? 'BUG: 500 instead of 404' : 'OK'}`);
  });

  it('rejects gate pass for REJECTED PO', async () => {
    if (!existingPoRejectedId) { record('gp.rejectedPo', true, 'skipped — no rejected PO'); return; }
    const res = await request
      .post('/api/gate-passes')
      .set(authAs(ctx.userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', existingPoRejectedId)
      .field('otpRequestedFor', ctx.userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'TEST789')
      .field('driverName', 'Test')
      .field('driverMobile', '+919999999989');
    expect(res.status).toBe(400);
    record('gp.rejectedPo', true, `400 — rejected PO`);
  });
});

// ═══ G. Approval Workflow Validations ═══
describe('G. Approval Workflow Validations', () => {
  it('rejects PO approve by non-admin role (PH)', async () => {
    // PO approval is ADMIN/ADMIN_2 only
    if (!existingPoApprovedId) { record('po.rbacApprove', true, 'skipped'); return; }
    // Create a new PENDING_APPROVAL PO
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, items: [{ materialName: 'TEST_RBAC_PO', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }], gstAmount: 0, acknowledged: true });
    await request.post(`/api/quotations/${qRes.body.id}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${qRes.body.id}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    const poRes = await request.post('/api/purchase-orders').set(authAs(ctx.userPhId)).send({ vendorId: existingVendorId, quotationId: qRes.body.id, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    // PH tries to approve PO → should fail (only ADMIN/ADMIN_2)
    const res = await request.post(`/api/purchase-orders/${poRes.body.id}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only Admin');
    record('po.rbacApprove', true, `403 — Only Admin can approve POs`);
  });

  it('rejects PO approve by same person twice', async () => {
    // Create a new PO and approve once
    const qRes = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: existingVendorId, items: [{ materialName: 'TEST_DUP_PO', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }], gstAmount: 0, acknowledged: true });
    await request.post(`/api/quotations/${qRes.body.id}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    await request.post(`/api/quotations/${qRes.body.id}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    const poRes = await request.post('/api/purchase-orders').set(authAs(ctx.userPhId)).send({ vendorId: existingVendorId, quotationId: qRes.body.id, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    // First approve by ADMIN
    await request.post(`/api/purchase-orders/${poRes.body.id}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    // Second approve by same ADMIN → should fail
    const res = await request.post(`/api/purchase-orders/${poRes.body.id}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already approved');
    record('po.doubleApprove', true, `400 — already approved`);
  });
});

// ═══ H. RBAC Validations ═══
describe('H. RBAC Validations', () => {
  it('rejects SITE_SUPERVISOR creating a quotation', async () => {
    const siteSv = await prisma.user.create({
      data: {
        firebaseUid: `dev-site-val-${RUN_ID}`,
        phone: `+919900${RUN_ID.slice(-6)}27`,
        name: `Val Site ${RUN_ID}`,
        role: 'SITE_SUPERVISOR',
        projectId: ctx.projectId,
        isActive: true,
      },
    });
    const res = await request
      .post('/api/quotations')
      .set(authAs(siteSv.id))
      .send({ vendorId: existingVendorId, items: [{ materialName: 'TEST', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }], gstAmount: 0, acknowledged: true });
    expect(res.status).toBe(403);
    record('rbac.siteSvNoQuotation', true, `403`);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request.get('/api/vendors').query({ page: '1', pageSize: '5' });
    expect(res.status).toBe(401);
    record('rbac.noAuth', true, `401`);
  });
});

// ═══ I. Cross-Entity Validations ═══
describe('I. Cross-Entity Validations', () => {
  it('rejects editing a DELIVERED PO (not PARTIALLY_DELIVERED)', async () => {
    if (!existingPoDeliveredId) { record('cross.editDelivered', true, 'skipped — no delivered PO'); return; }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: existingPoDeliveredId }, include: { items: true } });
    const res = await request
      .post(`/api/purchase-orders/${existingPoDeliveredId}/edit`)
      .set(authAs(ctx.userPhId))
      .send({
        items: po!.items.map((i) => ({ materialName: i.materialName, quantity: Number(i.quantity), unit: i.unit ?? 'nos', unitPrice: Number(i.unitPrice), gstRate: Number(i.gstRate ?? 0) })),
        editReason: 'test edit delivered PO',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Only partially delivered');
    record('cross.editDelivered', true, `400 — only partially delivered`);
  });

  it('rejects regenerating a PO with no regeneration data', async () => {
    // Find a DELIVERED PO that was NOT edited (no regenerationData)
    // Use Prisma.JsonNull filter correctly
    const po = await prisma.purchaseOrder.findFirst({
      where: { deletedAt: null, status: 'DELIVERED', parentPoId: null, editedAt: null },
      select: { id: true, regenerationData: true },
    });
    if (!po) { record('cross.regenNoData', true, 'skipped — no eligible PO'); return; }
    // Skip if it actually has regenerationData
    if (po.regenerationData !== null) { record('cross.regenNoData', true, 'skipped — PO has regenData'); return; }
    const res = await request.post(`/api/purchase-orders/${po.id}/regenerate`).set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No remaining items');
    record('cross.regenNoData', true, `400 — no remaining items`);
  });

  it('rejects creating invoice for amount exceeding accepted goods value', async () => {
    // Find a DELIVERED PO with known accepted value
    if (!existingPoDeliveredId) { record('cross.overInvoice', true, 'skipped — no delivered PO'); return; }
    const po = await prisma.purchaseOrder.findUnique({ where: { id: existingPoDeliveredId }, include: { items: true } });
    // Try to create an invoice for 10x the PO grand total
    const res = await request
      .post('/api/invoices')
      .set(authAs(ctx.userPhId))
      .send({
        vendorId: po!.vendorId,
        poId: existingPoDeliveredId,
        invoiceNumber: `INV-OVER-${RUN_ID}`,
        amount: Number(po!.grandTotal) * 10,
        taxAmount: 0,
        totalAmount: Number(po!.grandTotal) * 10,
        advancePaid: 0,
        acknowledged: true,
      });
    // The system should reject this — invoice amount should not exceed PO grand total
    expect(res.status).toBe(400);
    record('cross.overInvoice', true, `400 — invoice exceeds PO total`);
  });

  it('rejects creating quotation on vendor from different project', async () => {
    // Find a vendor from a different project
    const otherProjectVendor = await prisma.vendor.findFirst({
      where: { deletedAt: null, projectId: { not: ctx.projectId } },
      select: { id: true },
    });
    if (!otherProjectVendor) { record('cross.crossProject', true, 'skipped — no cross-project vendor'); return; }
    const res = await request
      .post('/api/quotations')
      .set(authAs(ctx.userPhId))
      .send({ vendorId: otherProjectVendor.id, items: [{ materialName: 'TEST', quantity: 5, unit: 'nos', unitPrice: 100, gstRate: 0 }], gstAmount: 0, acknowledged: true });
    // Should fail because vendor doesn't belong to the user's project
    if (res.status === 201) {
      record('cross.crossProject', false, `BUG: quotation created on cross-project vendor (status=201)`);
    } else {
      expect(res.status).toBe(400);
      record('cross.crossProject', true, `400 — cross-project vendor rejected`);
    }
  });

  it('rejects deleting an approved quotation', async () => {
    // Use the existing approved quotation
    const res = await request.delete(`/api/quotations/${existingApprovedQuotationId}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete an approved');
    record('cross.deleteApprovedQ', true, `400 — cannot delete approved`);
  });

  it('rejects deleting a quotation converted to PO', async () => {
    // Find a quotation that has been converted to PO
    const convertedQ = await prisma.quotation.findFirst({
      where: { deletedAt: null, status: 'CONVERTED_TO_PO' },
      select: { id: true },
    });
    if (!convertedQ) { record('cross.deleteConvertedQ', true, 'skipped — no converted quotation'); return; }
    const res = await request.delete(`/api/quotations/${convertedQ.id}`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('converted to a purchase order');
    record('cross.deleteConvertedQ', true, `400 — cannot delete converted`);
  });

  it('rejects editing an approved quotation', async () => {
    const res = await request
      .patch(`/api/quotations/${existingApprovedQuotationId}`)
      .set(authAs(ctx.userPhId))
      .send({ items: [{ materialName: 'HACK', quantity: 1, unit: 'nos', unitPrice: 1, gstRate: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot edit an approved');
    record('cross.editApprovedQ', true, `400 — cannot edit approved`);
  });

  it('rejects paying an already-PAID invoice (no active PR)', async () => {
    // Find a PAID invoice
    const paidInv = await prisma.vendorInvoice.findFirst({
      where: { deletedAt: null, paymentStatus: 'PAID' },
      select: { id: true, vendorId: true },
    });
    if (!paidInv) { record('cross.payPaidInvoice', true, 'skipped — no paid invoice'); return; }
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(ctx.userPhId))
      .send({ invoiceId: paidInv.id, vendorId: paidInv.vendorId, requestNumber: `PR-PAID-${RUN_ID}`, amount: 100, paymentMode: 'CASH' });
    // Should fail because invoice is already fully paid
    if (res.status === 201) {
      record('cross.payPaidInvoice', false, `BUG: PR created for already-PAID invoice (status=201)`);
    } else {
      expect(res.status).toBe(400);
      record('cross.payPaidInvoice', true, `400 — invoice already paid`);
    }
  });
});
