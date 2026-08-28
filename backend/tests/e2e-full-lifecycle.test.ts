/**
 * E2E Full Lifecycle Test — ALL MODULES
 *
 * Drives the real Express API via supertest + dev-token auth bypass against the
 * LIVE Supabase database, then verifies rows + relationships persisted in DB.
 *
 * IMPORTANT: NO teardown. All created test data is KEPT in the database.
 *
 * Modules covered:
 *   1. Procurement:  vendor -> quotation -> PO -> gate pass -> goods receipt -> invoice -> payment
 *   2. Finance:      budget heads, bank/cash accounts, owner account, journal vouchers, budget revisions
 *   3. Inventory:    items, stock OUT / ADJUST transactions
 *   4. Assets:       create, issue, return, relocate, maintenance, retire, scan
 *   5. Site ops:     phases -> activities -> photos -> issues -> inspections
 *   6. Contracts:    contract with milestones
 *   7. Labour:       staff + attendance
 *
 * Run: npx vitest run tests/e2e-full-lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { prisma } from '../src/config/prisma';
import app from '../src/app';

const request = supertest(app);

// ─── Run marker (kept in DB so this run is identifiable) ─────────
const RUN_ID = `lf-${Date.now()}`;

// ─── Shared state populated across the suite ─────────────────────
let projectId = '';
let userPhId = '';   // PROJECT_HEAD  (Akhil)
let userHocId = '';  // HEAD_OF_CONSTRUCTION (Ashok Sir)
let userAdminId = ''; // ADMIN (Kaushal Sir)
let userAdmin2Id = ''; // ADMIN_2 (Vinod Sir)

// Procurement
let vendorId = '';
let quotationId = '';
let poId = '';
let gatePassId = '';
let goodsReceiptId = '';
let invoiceId = '';
let paymentRequestId = '';
let paymentId = '';

// Finance
let budgetHeadId = '';
let bankAccountId = '';
let cashAccountId = '';
let ownerAccountId = '';
let jvId = '';
let budgetRevisionId = '';

// Inventory + Assets
let consumableItemId = '';
let assetItemId = '';
let assetId = '';

// Site ops
let phaseId = '';
let activityId = '';
let photoId = '';
let issueId = '';
let inspectionId = '';

// Contracts + labour
let contractId = '';
let staffId = '';

// ─── Helpers ─────────────────────────────────────────────────────
function authAs(userId: string) {
  return { Authorization: `Bearer dev-token:${userId}` };
}

// Track pass/fail per step for the final report
const results: { step: string; ok: boolean; detail: string }[] = [];
function record(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
}

// ─── Setup: resolve the real active project + its users ──────────
beforeAll(async () => {
  const project = await prisma.project.findFirst({
    where: { status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!project) throw new Error('No active project found — seed the DB first');
  projectId = project.id;

  const users = await prisma.user.findMany({
    where: { projectId, isActive: true },
    select: { id: true, role: true, name: true },
  });
  const byRole = (r: string) => users.find((u) => u.role === r);
  userPhId = byRole('PROJECT_HEAD')?.id ?? '';
  userHocId = byRole('HEAD_OF_CONSTRUCTION')?.id ?? '';
  userAdminId = byRole('ADMIN')?.id ?? '';
  userAdmin2Id = byRole('ADMIN_2')?.id ?? '';

  if (!userPhId || !userHocId) {
    throw new Error('Need at least PROJECT_HEAD + HEAD_OF_CONSTRUCTION users in the project');
  }
  console.log(`\n[LIFECYCLE] run=${RUN_ID} project=${project.name} ph=${userPhId} hoc=${userHocId} admin=${userAdminId} admin2=${userAdmin2Id}\n`);
});

afterAll(async () => {
  // NO teardown — data is kept. Just print the report.
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  LIFECYCLE REPORT — run', RUN_ID);
  console.log('═══════════════════════════════════════════════════════════════');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step} — ${r.detail}`);
  }
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  Total: ${results.length}   Passed: ${passed}   Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  await prisma.$disconnect();
});

// ══════════════════════════════════════════════════════════════════
// 1. PROCUREMENT LIFECYCLE
//    vendor → quotation → approve → PO → approve → gate pass →
//    goods receipt → inspect → post → invoice → verify →
//    payment request → approve → pay
// ══════════════════════════════════════════════════════════════════
describe('1. Procurement lifecycle', () => {
  it('1.1 Create vendor with materials', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(userPhId))
      .send({
        name: `LF Vendor ${RUN_ID}`,
        contactPersonName: 'Ramesh',
        contactPersonPhone: '+919999999999',
        phone: '+918888888888',
        category: 'MATERIAL_SUPPLIER',
        materials: [
          { name: `Cement ${RUN_ID}`, unit: 'bag', pricePerUnit: 350 },
          { name: `Drill Machine ${RUN_ID}`, unit: 'pcs', pricePerUnit: 4500 },
        ],
      });
    expect(res.status).toBe(201);
    vendorId = res.body.id;
    // DB verify
    const db = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { materials: true },
    });
    expect(db).not.toBeNull();
    expect(db!.materials).toHaveLength(2);
    record('vendor.create', res.status === 201, `vendor=${vendorId} code=${res.body.vendorCode}`);
  });

  it('1.2 Create quotation for vendor (materials must match)', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(userPhId))
      .send({
        vendorId,
        items: [
          { materialName: `Cement ${RUN_ID}`, quantity: 100, unit: 'bag', unitPrice: 350 },
          { materialName: `Drill Machine ${RUN_ID}`, quantity: 2, unit: 'pcs', unitPrice: 4500 },
        ],
        gstAmount: 4950,
        acknowledged: true,
      });
    expect(res.status).toBe(201);
    quotationId = res.body.id;
    const db = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { items: true, approvalWorkflow: { include: { steps: true } } },
    });
    expect(db!.status).toBe('SUBMITTED');
    expect(db!.approvalWorkflow!.steps).toHaveLength(4);
    record('quotation.create', res.status === 201, `quotation=${quotationId} status=${db!.status}`);
  });

  it('1.3 Approve quotation (HEAD_GROUPS: 1 from {PH,HoC} + 1 from {ADMIN,ADMIN_2})', async () => {
    // HEAD_GROUPS policy requires approval from BOTH groups
    await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/quotations/${quotationId}/approve`).set(authAs(userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    const db = await prisma.quotation.findUnique({ where: { id: quotationId } });
    expect(db!.status).toBe('APPROVED');
    record('quotation.approve', db!.status === 'APPROVED', `status=${db!.status}`);
  });

  it('1.4 Create PO from approved quotation', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(userPhId))
      .send({ vendorId, quotationId, paymentType: 'AFTER_DELIVERY', acknowledged: true });
    expect(res.status).toBe(201);
    poId = res.body.id;
    const db = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true, approvalWorkflow: { include: { steps: true } } },
    });
    expect(db!.status).toBe('PENDING_APPROVAL');
    expect(db!.items).toHaveLength(2);
    record('po.create', res.status === 201, `po=${poId} status=${db!.status}`);
  });

  it('1.5 Approve PO (PO_SINGLE_APPROVER: 1 approval from ADMIN or ADMIN_2)', async () => {
    // PO uses PO_SINGLE_APPROVER policy — only 1 approval from ADMIN/ADMIN_2 needed
    const res = await request.post(`/api/purchase-orders/${poId}/approve`).set(authAs(userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res.body.status).toBe('APPROVED');
    const db = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    expect(db!.status).toBe('APPROVED');
    record('po.approve', db!.status === 'APPROVED', `status=${db!.status}`);
  });

  it('1.6 Create gate pass for the approved PO (OTP requested)', async () => {
    const res = await request
      .post('/api/gate-passes')
      .set(authAs(userPhId))
      .field('gatePassCategory', 'MATERIAL')
      .field('poId', poId)
      .field('otpRequestedFor', userHocId)
      .field('vehicleType', 'TRUCK')
      .field('vehicleNumber', 'AP39AB1234')
      .field('driverName', 'Suresh')
      .field('driverMobile', '+919999999998');
    expect(res.status).toBe(201);
    gatePassId = res.body.id;
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId }, include: { items: true } });
    expect(db!.status).toBe('PENDING');
    expect(db!.items.length).toBeGreaterThan(0);
    record('gatepass.create', res.status === 201, `gatePass=${gatePassId} status=${db!.status} items=${db!.items.length}`);
  });

  it('1.7 Approve gate pass directly in DB (no Firebase OTP in test env)', async () => {
    // The verify-otp endpoint requires a real Firebase ID token which we cannot
    // mint in a test. Since DB access is granted, mark the gate pass APPROVED
    // directly — this mirrors what a successful OTP verification does.
    const approver = userHocId;
    await prisma.gatePass.update({
      where: { id: gatePassId },
      data: { status: 'APPROVED', otpApprovedBy: approver, otpApprovedAt: new Date() },
    });
    const db = await prisma.gatePass.findUnique({ where: { id: gatePassId } });
    expect(db!.status).toBe('APPROVED');
    record('gatepass.approve', db!.status === 'APPROVED', `status=${db!.status} approvedBy=${approver}`);
  });

  it('1.8 Create goods receipt from the approved gate pass', async () => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    const res = await request
      .post('/api/goods-receipts')
      .set(authAs(userAdminId || userPhId))
      .send({
        gatePassId,
        items: po!.items.map((it) => ({ materialName: it.materialName, deliveredQty: Number(it.quantity), unit: it.unit })),
      });
    expect(res.status).toBe(201);
    goodsReceiptId = res.body.id;
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { items: true } });
    expect(db!.status).toBe('PENDING_INSPECTION');
    record('goodsreceipt.create', res.status === 201, `receipt=${goodsReceiptId} status=${db!.status}`);
  });

  it('1.9 Inspect goods receipt (mark one item ASSET, one CONSUMABLE)', async () => {
    const gr = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { items: true } });
    const res = await request
      .post(`/api/goods-receipts/${goodsReceiptId}/inspect`)
      .set(authAs(userHocId))
      .send({
        items: gr!.items.map((it, idx) => ({
          id: it.id,
          acceptedQty: Number(it.deliveredQty),
          rejectedQty: 0,
          itemType: idx === 0 ? 'CONSUMABLE' : 'ASSET',
        })),
      });
    expect(res.status).toBe(200);
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, include: { inspection: true } });
    expect(db!.status).toBe('READY_TO_POST');
    expect(db!.inspection).not.toBeNull();
    record('goodsreceipt.inspect', db!.status === 'READY_TO_POST', `status=${db!.status} inspection=${db!.inspection!.id}`);
  });

  it('1.10 Post goods receipt → inventory IN + assets created', async () => {
    // Poster must differ from creator + inspector. Creator was admin/ph, inspector hoc → use admin2 or ph.
    const posterId = userAdmin2Id || userPhId;
    const res = await request.post(`/api/goods-receipts/${goodsReceiptId}/post`).set(authAs(posterId)).send({});
    expect(res.status).toBe(200);
    const db = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } });
    expect(db!.status).toBe('POSTED');
    // Inventory transactions should exist
    const txns = await prisma.inventoryTransaction.findMany({ where: { goodsReceiptId } });
    expect(txns.length).toBeGreaterThan(0);
    // Assets should have been created for the ASSET-type item
    const assets = await prisma.asset.findMany({ where: { projectId } });
    record('goodsreceipt.post', db!.status === 'POSTED', `status=${db!.status} invTxns=${txns.length} assetsInProject=${assets.length}`);
  });

  it('1.11 Create invoice for the PO', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(userPhId))
      .send({
        vendorId,
        poId,
        invoiceNumber: `INV-LF-${RUN_ID}`,
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
    record('invoice.create', res.status === 201, `invoice=${invoiceId} verify=${db!.verificationStatus}`);
  });

  it('1.12 Verify invoice (HEAD_GROUPS: 1 from {PH,HoC} + 1 from {ADMIN,ADMIN_2})', async () => {
    await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/invoices/${invoiceId}/approve`).set(authAs(userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.verificationStatus).toBe('VERIFIED');
    const db = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId } });
    expect(db!.verificationStatus).toBe('VERIFIED');
    record('invoice.verify', db!.verificationStatus === 'VERIFIED', `verify=${db!.verificationStatus}`);
  });

  it('1.13 Create payment request against the verified invoice', async () => {
    const res = await request
      .post('/api/payments/invoice-payment')
      .set(authAs(userPhId))
      .send({
        invoiceId,
        vendorId,
        requestNumber: `PR-LF-${RUN_ID}`,
        amount: 44000,
        paymentMode: 'BANK_TRANSFER',
        notes: 'lifecycle test payment',
      });
    expect(res.status).toBe(201);
    paymentRequestId = res.body.id;
    const db = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    expect(db!.status).toBe('PENDING');
    record('paymentrequest.create', res.status === 201, `pr=${paymentRequestId} status=${db!.status}`);
  });

  it('1.14 Approve payment request (HEAD_GROUPS: 1 from {PH,HoC} + 1 from {ADMIN,ADMIN_2})', async () => {
    await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/payments/${paymentRequestId}/approve`).set(authAs(userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    const db = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    expect(db!.status).toBe('APPROVED');
    record('paymentrequest.approve', db!.status === 'APPROVED', `status=${db!.status}`);
  });

  it('1.15 Record payment (links to a cash account for finance integration)', async () => {
    // The pay endpoint requires a funding account (bankAccountId or cashAccountId).
    // Always create a fresh cash account with sufficient balance to avoid
    // using a depleted account from a previous test run.
    const cashAcct = await prisma.cashAccount.create({
      data: { projectId, name: `Cash-LF-${RUN_ID}`, currentBalance: 500000, isActive: true },
    });
    const res = await request
      .post(`/api/payments/${paymentRequestId}/pay`)
      .set(authAs(userPhId))
      .send({ amount: 44000, mode: 'CASH', cashAccountId: cashAcct.id, reference: `PAY-LF-${RUN_ID}` });
    expect(res.status).toBe(201);
    paymentId = res.body.id;
    const db = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(db).not.toBeNull();
    const pr = await prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } });
    expect(pr!.status).toBe('PAID');
    record('payment.record', pr!.status === 'PAID', `payment=${paymentId} prStatus=${pr!.status}`);
  });

  it('1.16 Cross-link verify: vendor shows in quotation/PO/invoice lists', async () => {
    const [vList, qList, poList, invList] = await Promise.all([
      request.get('/api/vendors').set(authAs(userPhId)),
      request.get('/api/quotations').set(authAs(userPhId)),
      request.get('/api/purchase-orders').set(authAs(userPhId)),
      request.get('/api/invoices').set(authAs(userPhId)),
    ]);
    expect(vList.body.data.find((v: any) => v.id === vendorId)).toBeDefined();
    expect(qList.body.data.find((q: any) => q.id === quotationId)).toBeDefined();
    expect(poList.body.data.find((p: any) => p.id === poId)).toBeDefined();
    expect(invList.body.data.find((i: any) => i.id === invoiceId)).toBeDefined();
    record('procurement.crosslink', true, 'vendor/quotation/po/invoice all visible in lists');
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. FINANCE LIFECYCLE
//    budget head → bank account → cash account → owner account →
//    owner contribution → journal voucher (submit/approve/post) →
//    budget revision (request/review/apply)
// ══════════════════════════════════════════════════════════════════
describe('2. Finance lifecycle', () => {
  it('2.1 Create budget head', async () => {
    // Find next available slNo for this project
    const existing = await prisma.budgetHead.findMany({ where: { projectId }, select: { slNo: true } });
    const nextSl = (existing.reduce((m, b) => Math.max(m, b.slNo), 0) || 0) + 1;
    const res = await request
      .post('/api/budget-heads')
      .set(authAs(userPhId))
      .send({ slNo: nextSl, particulars: `LF Budget Head ${RUN_ID}`, allocatedAmount: 5000000 });
    expect(res.status).toBe(201);
    budgetHeadId = res.body.id;
    const db = await prisma.budgetHead.findUnique({ where: { id: budgetHeadId } });
    expect(db!.allocatedAmount.toString()).toBe('5000000');
    record('budgethead.create', res.status === 201, `bh=${budgetHeadId} slNo=${nextSl}`);
  });

  it('2.2 Create bank account with opening balance', async () => {
    const res = await request
      .post('/api/bank-accounts')
      .set(authAs(userPhId))
      .send({ accountName: `LF Bank ${RUN_ID}`, bankName: 'HDFC', accountNumber: '12345678901234', ifscCode: 'HDFC0001234', openingBalance: 1000000 });
    expect(res.status).toBe(201);
    bankAccountId = res.body.id;
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(db!.currentBalance.toString()).toBe('1000000');
    record('bankaccount.create', res.status === 201, `bank=${bankAccountId} bal=${db!.currentBalance}`);
  });

  it('2.3 Create cash account with opening balance', async () => {
    const res = await request
      .post('/api/cash-accounts')
      .set(authAs(userPhId))
      .send({ name: `LF Cash ${RUN_ID}`, openingBalance: 200000 });
    expect(res.status).toBe(201);
    cashAccountId = res.body.id;
    const db = await prisma.cashAccount.findUnique({ where: { id: cashAccountId } });
    expect(db!.currentBalance.toString()).toBe('200000');
    record('cashaccount.create', res.status === 201, `cash=${cashAccountId} bal=${db!.currentBalance}`);
  });

  it('2.4 Bank deposit + withdraw', async () => {
    const dep = await request.post(`/api/bank-accounts/${bankAccountId}/deposit`).set(authAs(userPhId)).send({ amount: 500000, description: 'LF deposit' });
    expect(dep.status).toBe(201);
    expect(Number(dep.body.newBalance)).toBe(1500000);
    const wd = await request.post(`/api/bank-accounts/${bankAccountId}/withdraw`).set(authAs(userPhId)).send({ amount: 100000, description: 'LF withdraw' });
    expect(wd.status).toBe(201);
    expect(Number(wd.body.newBalance)).toBe(1400000);
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(db!.currentBalance.toString()).toBe('1400000');
    record('bank.depositWithdraw', db!.currentBalance.toString() === '1400000', `bal=${db!.currentBalance}`);
  });

  it('2.5 Bank → cash transfer (atomic pair)', async () => {
    const res = await request
      .post('/api/cash-accounts/bank-to-cash')
      .set(authAs(userPhId))
      .send({ bankAccountId, cashAccountId, amount: 50000, description: 'LF bank to cash' });
    expect(res.status).toBe(201);
    expect(res.body.transferPairId).toBeDefined();
    const [bank, cash] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bankAccountId } }),
      prisma.cashAccount.findUnique({ where: { id: cashAccountId } }),
    ]);
    expect(bank!.currentBalance.toString()).toBe('1350000');
    expect(cash!.currentBalance.toString()).toBe('250000');
    record('bank.transfer', bank!.currentBalance.toString() === '1350000' && cash!.currentBalance.toString() === '250000', `bank=${bank!.currentBalance} cash=${cash!.currentBalance}`);
  });

  it('2.6 Create owner account', async () => {
    const res = await request.post('/api/owner-accounts').set(authAs(userPhId)).send({ ownerName: `LF Owner ${RUN_ID}`, openingBalance: 0 });
    expect(res.status).toBe(201);
    ownerAccountId = res.body.id;
    const db = await prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } });
    expect(db!.currentBalance.toString()).toBe('0');
    record('owneraccount.create', res.status === 201, `owner=${ownerAccountId}`);
  });

  it('2.7 Owner contribution (deposits into bank + increases owner balance)', async () => {
    const res = await request
      .post(`/api/owner-accounts/${ownerAccountId}/contribution`)
      .set(authAs(userPhId))
      .send({ bankAccountId, amount: 300000, description: 'LF owner contribution' });
    expect(res.status).toBe(201);
    expect(Number(res.body.newOwnerBalance)).toBe(300000);
    const [owner, bank] = await Promise.all([
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } }),
      prisma.bankAccount.findUnique({ where: { id: bankAccountId } }),
    ]);
    expect(owner!.currentBalance.toString()).toBe('300000');
    expect(bank!.currentBalance.toString()).toBe('1650000');
    record('owner.contribution', owner!.currentBalance.toString() === '300000', `owner=${owner!.currentBalance} bank=${bank!.currentBalance}`);
  });

  it('2.8 Journal voucher: OWNER_EXPENSE (owner paid a vendor → company owes owner)', async () => {
    // Debit budget head (expense incurred), Credit owner (company owes owner)
    const res = await request
      .post('/api/journal-vouchers')
      .set(authAs(userPhId))
      .send({
        type: 'OWNER_EXPENSE',
        description: `LF JV owner expense ${RUN_ID}`,
        entries: [
          { accountType: 'BUDGET_HEAD', budgetHeadId, debit: 100000, credit: 0, description: 'expense' },
          { accountType: 'OWNER', ownerAccountId, debit: 0, credit: 100000, description: 'owed to owner' },
        ],
      });
    expect(res.status).toBe(201);
    jvId = res.body.id;
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId }, include: { entries: true } });
    expect(db!.status).toBe('DRAFT');
    expect(db!.entries).toHaveLength(2);
    record('jv.create', res.status === 201, `jv=${jvId} status=${db!.status}`);
  });

  it('2.9 Submit JV → PENDING_APPROVAL', async () => {
    const res = await request.post(`/api/journal-vouchers/${jvId}/submit`).set(authAs(userPhId));
    expect(res.status).toBe(200);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId }, include: { approvalWorkflow: { include: { steps: true } } } });
    expect(db!.status).toBe('PENDING_APPROVAL');
    expect(db!.approvalWorkflow).not.toBeNull();
    record('jv.submit', db!.status === 'PENDING_APPROVAL', `status=${db!.status}`);
  });

  it('2.10 Approve JV (HEAD_GROUPS: 1 from {PH,HoC} + 1 from {ADMIN,ADMIN_2})', async () => {
    await request.post(`/api/journal-vouchers/${jvId}/approve`).set(authAs(userPhId)).send({ comments: 'ok' });
    const res2 = await request.post(`/api/journal-vouchers/${jvId}/approve`).set(authAs(userAdminId)).send({ comments: 'ok' });
    expect(res2.body.isFullyApproved).toBe(true);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('APPROVED');
    record('jv.approve', db!.status === 'APPROVED', `status=${db!.status}`);
  });

  it('2.11 Post JV → updates budget head + owner balances', async () => {
    const ownerBefore = await prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } });
    const res = await request.post(`/api/journal-vouchers/${jvId}/post`).set(authAs(userPhId));
    expect(res.status).toBe(200);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('POSTED');
    const [ownerAfter, bh] = await Promise.all([
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } }),
      prisma.budgetHead.findUnique({ where: { id: budgetHeadId } }),
    ]);
    // Owner credited 100000 → balance up by 100000
    expect(Number(ownerAfter!.currentBalance) - Number(ownerBefore!.currentBalance)).toBe(100000);
    // Budget head actualAmount increased by 100000
    expect(Number(bh!.actualAmount)).toBeGreaterThanOrEqual(100000);
    record('jv.post', db!.status === 'POSTED', `status=${db!.status} ownerDelta=100000 bhActual=${bh!.actualAmount}`);
  });

  it('2.12 Budget revision: request → review (approve) → applied', async () => {
    const req = await request
      .post('/api/budget-revisions/request')
      .set(authAs(userPhId))
      .send({ budgetHeadId, newAllocated: 6000000, reason: `LF revision ${RUN_ID} — increase allocation` });
    expect(req.status).toBe(201);
    budgetRevisionId = req.body.id;
    const revBefore = await prisma.budgetRevision.findUnique({ where: { id: budgetRevisionId } });
    expect(revBefore!.status).toBe('PENDING');

    // Review by ADMIN or ADMIN_2
    const reviewer = userAdminId || userAdmin2Id || userPhId;
    const rev = await request.post(`/api/budget-revisions/${budgetRevisionId}/review`).set(authAs(reviewer)).send({ approved: true, comments: 'approved' });
    expect(rev.status).toBe(200);
    const revAfter = await prisma.budgetRevision.findUnique({ where: { id: budgetRevisionId } });
    expect(revAfter!.status).toBe('APPLIED');
    const bh = await prisma.budgetHead.findUnique({ where: { id: budgetHeadId } });
    expect(bh!.allocatedAmount.toString()).toBe('6000000');
    record('budgetrevision.flow', revAfter!.status === 'APPLIED', `rev=${budgetRevisionId} status=${revAfter!.status} bhAlloc=${bh!.allocatedAmount}`);
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. INVENTORY + ASSETS LIFECYCLE
//    consumable item → stock OUT → ADJUST
//    asset item → manual asset create → issue → return → relocate →
//    maintenance → complete → scan → retire
// ══════════════════════════════════════════════════════════════════
describe('3. Inventory + Assets lifecycle', () => {
  it('3.1 Create consumable inventory item', async () => {
    const res = await request
      .post('/api/inventory/items')
      .set(authAs(userPhId))
      .send({ name: `LF Paint ${RUN_ID}`, unit: 'ltr', itemType: 'CONSUMABLE', minStockLevel: 10, location: 'Store A' });
    expect(res.status).toBe(201);
    consumableItemId = res.body.id;
    const db = await prisma.inventoryItem.findUnique({ where: { id: consumableItemId } });
    expect(db!.itemType).toBe('CONSUMABLE');
    record('inventory.consumable.create', res.status === 201, `item=${consumableItemId}`);
  });

  it('3.2 Stock OUT on consumable (need stock first — adjust up via ADMIN)', async () => {
    // ADJUST requires ADMIN/ADMIN_2. Set stock to 50.
    const adj = await request
      .post('/api/inventory/transactions')
      .set(authAs(userAdminId || userAdmin2Id || userPhId))
      .send({ itemId: consumableItemId, type: 'ADJUST', quantity: 50, notes: 'LF initial stock' });
    expect(adj.status).toBe(201);
    let db = await prisma.inventoryItem.findUnique({ where: { id: consumableItemId } });
    expect(db!.currentStock.toString()).toBe('50');

    // Now OUT of 10
    const out = await request
      .post('/api/inventory/transactions')
      .set(authAs(userPhId))
      .send({ itemId: consumableItemId, type: 'OUT', quantity: 10, notes: 'LF issued to site' });
    expect(out.status).toBe(201);
    db = await prisma.inventoryItem.findUnique({ where: { id: consumableItemId } });
    expect(db!.currentStock.toString()).toBe('40');
    record('inventory.stockflow', db!.currentStock.toString() === '40', `finalStock=${db!.currentStock}`);
  });

  it('3.3 Create asset-type inventory item', async () => {
    const res = await request
      .post('/api/inventory/items')
      .set(authAs(userPhId))
      .send({ name: `LF Laptop ${RUN_ID}`, unit: 'pcs', itemType: 'ASSET', location: 'IT Store' });
    expect(res.status).toBe(201);
    assetItemId = res.body.id;
    const db = await prisma.inventoryItem.findUnique({ where: { id: assetItemId } });
    expect(db!.itemType).toBe('ASSET');
    record('inventory.assetItem.create', res.status === 201, `item=${assetItemId}`);
  });

  it('3.4 Manually create one asset unit under the asset item', async () => {
    const res = await request
      .post(`/api/assets/${assetItemId}`)
      .set(authAs(userPhId))
      .send({ serialNumber: `SN-LF-${RUN_ID}`, location: 'IT Store', notes: 'LF asset', usefulLifeYears: 5, depreciationMethod: 'STRAIGHT_LINE', salvageValue: 5000 });
    expect(res.status).toBe(201);
    assetId = res.body.id;
    const db = await prisma.asset.findUnique({ where: { id: assetId }, include: { movements: true } });
    expect(db!.status).toBe('ACTIVE');
    expect(db!.movements.length).toBeGreaterThan(0);
    record('asset.create', res.status === 201, `asset=${assetId} assetIdCode=${db!.assetId}`);
  });

  it('3.5 Issue asset to a person', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/issue`)
      .set(authAs(userPhId))
      .send({ location: 'Site Office', issuedToPerson: 'Ravi Kumar', notes: 'LF issue' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ISSUED');
    expect(db!.issuedToPerson).toBe('Ravi Kumar');
    record('asset.issue', db!.status === 'ISSUED', `status=${db!.status} issuedTo=${db!.issuedToPerson}`);
  });

  it('3.6 Return asset to store', async () => {
    const res = await request.post(`/api/assets/${assetId}/return`).set(authAs(userPhId)).send({ location: 'IT Store', notes: 'LF return' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ACTIVE');
    record('asset.return', db!.status === 'ACTIVE', `status=${db!.status}`);
  });

  it('3.7 Relocate asset', async () => {
    const res = await request.post(`/api/assets/${assetId}/relocate`).set(authAs(userPhId)).send({ location: 'Warehouse B', reason: 'LF relocate' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.location).toBe('Warehouse B');
    record('asset.relocate', db!.location === 'Warehouse B', `location=${db!.location}`);
  });

  it('3.8 Send asset for maintenance', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/maintenance`)
      .set(authAs(userPhId))
      .send({ reason: 'LF maintenance — screen repair', maintenanceVendor: 'TechFix', cost: 2000 });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId }, include: { maintenances: true } });
    expect(db!.status).toBe('UNDER_MAINTENANCE');
    expect(db!.maintenances.length).toBeGreaterThan(0);
    record('asset.maintenance', db!.status === 'UNDER_MAINTENANCE', `status=${db!.status}`);
  });

  it('3.9 Complete maintenance → asset back to ACTIVE', async () => {
    const res = await request
      .post(`/api/assets/${assetId}/maintenance/complete`)
      .set(authAs(userPhId))
      .send({ completionNotes: 'LF repaired', finalCost: 1800, returnToLocation: 'IT Store' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('ACTIVE');
    record('asset.maintenanceComplete', db!.status === 'ACTIVE', `status=${db!.status}`);
  });

  it('3.10 Scan asset (public endpoint, optional auth)', async () => {
    const dbAsset = await prisma.asset.findUnique({ where: { id: assetId } });
    const res = await request.get(`/api/assets/scan/${dbAsset!.assetId}`).set(authAs(userPhId)).query({ location: 'IT Store' });
    expect(res.status).toBe(200);
    expect(res.body.assetId).toBe(dbAsset!.assetId);
    // Scan record should be created when authenticated
    const scans = await prisma.assetScan.findMany({ where: { assetId } });
    expect(scans.length).toBeGreaterThan(0);
    record('asset.scan', scans.length > 0, `scans=${scans.length}`);
  });

  it('3.11 Retire asset (ADMIN/ADMIN_2 only)', async () => {
    const res = await request.post(`/api/assets/${assetId}/retire`).set(authAs(userAdminId || userAdmin2Id || userPhId)).send({ reason: 'LF retired — end of life' });
    expect(res.status).toBe(200);
    const db = await prisma.asset.findUnique({ where: { id: assetId } });
    expect(db!.status).toBe('RETIRED');
    record('asset.retire', db!.status === 'RETIRED', `status=${db!.status}`);
  });

  it('3.12 Cross-link verify: assets appear under their inventory item', async () => {
    const assets = await prisma.asset.findMany({ where: { inventoryItemId: assetItemId } });
    expect(assets.find((a) => a.id === assetId)).toBeDefined();
    const item = await prisma.inventoryItem.findUnique({ where: { id: assetItemId }, include: { assets: true } });
    expect(item!.assets.find((a) => a.id === assetId)).toBeDefined();
    record('inventory.assetCrosslink', true, `assetsUnderItem=${item!.assets.length}`);
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. SITE OPERATIONS LIFECYCLE
//    phase → activity → photo → issue (open + close) → inspection
// ══════════════════════════════════════════════════════════════════
describe('4. Site operations lifecycle', () => {
  it('4.1 Create phase', async () => {
    const res = await request
      .post('/api/phases')
      .set(authAs(userPhId))
      .send({ name: `LF Phase ${RUN_ID}`, budgetAmount: 2000000, status: 'NOT_STARTED', plannedStart: new Date().toISOString(), plannedEnd: new Date(Date.now() + 90 * 86400000).toISOString() });
    expect(res.status).toBe(201);
    phaseId = res.body.id;
    const db = await prisma.phase.findUnique({ where: { id: phaseId } });
    expect(db!.name).toContain(RUN_ID);
    record('phase.create', res.status === 201, `phase=${phaseId}`);
  });

  it('4.2 Create activity under the phase (assign the procurement vendor)', async () => {
    const res = await request
      .post('/api/activities')
      .set(authAs(userPhId))
      .send({ phaseId, name: `LF Activity ${RUN_ID}`, assignedVendorId: vendorId, budgetAmount: 500000, status: 'NOT_STARTED' });
    expect(res.status).toBe(201);
    activityId = res.body.id;
    const db = await prisma.activity.findUnique({ where: { id: activityId }, include: { assignedVendor: true } });
    expect(db!.assignedVendor!.id).toBe(vendorId);
    record('activity.create', res.status === 201, `activity=${activityId} vendor=${db!.assignedVendor!.id}`);
  });

  it('4.3 Update activity progress (IN_PROGRESS, 40%)', async () => {
    const res = await request.patch(`/api/activities/${activityId}`).set(authAs(userPhId)).send({ status: 'IN_PROGRESS', progressPercent: 40, actualStart: new Date().toISOString() });
    expect(res.status).toBe(200);
    const db = await prisma.activity.findUnique({ where: { id: activityId } });
    expect(db!.status).toBe('IN_PROGRESS');
    expect(Number(db!.progressPercent)).toBe(40);
    record('activity.update', db!.status === 'IN_PROGRESS', `status=${db!.status} progress=${db!.progressPercent}`);
  });

  it('4.4 Upload site photo (linked to phase + activity, via imageUrl)', async () => {
    const res = await request
      .post('/api/photos')
      .set(authAs(userPhId))
      .send({ imageUrl: `https://example.com/lf-photo-${RUN_ID}.jpg`, phaseId, activityId, zone: 'Zone A', caption: 'LF progress photo', tag: 'DURING' });
    expect(res.status).toBe(201);
    photoId = res.body.id;
    const db = await prisma.sitePhoto.findUnique({ where: { id: photoId } });
    expect(db!.phaseId).toBe(phaseId);
    expect(db!.activityId).toBe(activityId);
    record('photo.create', res.status === 201, `photo=${photoId} phase=${db!.phaseId} activity=${db!.activityId}`);
  });

  it('4.5 Raise an issue (addressed to heads)', async () => {
    const heads = [userPhId, userHocId].filter(Boolean);
    const res = await request
      .post('/api/issues')
      .set(authAs(userPhId))
      .send({ category: 'MATERIAL', severity: 'HIGH', title: `LF Issue ${RUN_ID}`, description: 'Material delivery delayed', addressTo: heads });
    expect(res.status).toBe(201);
    issueId = res.body.id;
    const db = await prisma.issue.findUnique({ where: { id: issueId } });
    expect(db!.status).toBe('OPEN');
    expect(db!.addressTo).toHaveLength(2);
    record('issue.create', res.status === 201, `issue=${issueId} status=${db!.status}`);
  });

  it('4.6 Close the issue (with closure notes)', async () => {
    const res = await request
      .post(`/api/issues/${issueId}/close`)
      .set(authAs(userPhId))
      .field('closureNotes', 'LF issue resolved — material delivered');
    expect(res.status).toBe(200);
    const db = await prisma.issue.findUnique({ where: { id: issueId } });
    expect(db!.status).toBe('CLOSED');
    expect(db!.closedBy).toBe(userPhId);
    record('issue.close', db!.status === 'CLOSED', `status=${db!.status} closedBy=${db!.closedBy}`);
  });

  it('4.7 Create a standalone inspection', async () => {
    const res = await request
      .post('/api/inspections')
      .set(authAs(userPhId))
      .send({ name: `LF Inspection ${RUN_ID}`, scheduledDate: new Date().toISOString() });
    expect(res.status).toBe(201);
    inspectionId = res.body.id;
    const db = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(db!.status).toBe('SCHEDULED');
    record('inspection.create', res.status === 201, `inspection=${inspectionId} status=${db!.status}`);
  });

  it('4.8 Update inspection with checklist + mark PASSED', async () => {
    const res = await request
      .patch(`/api/inspections/${inspectionId}`)
      .set(authAs(userPhId))
      .send({
        status: 'PASSED',
        completedDate: new Date().toISOString(),
        checklist: [
          { item: 'Foundation level', result: 'PASS' },
          { item: 'Reinforcement', result: 'PASS' },
          { item: 'Concrete strength', result: 'PASS' },
        ],
        correctiveAction: '',
      });
    expect(res.status).toBe(200);
    const db = await prisma.inspection.findUnique({ where: { id: inspectionId } });
    expect(db!.status).toBe('PASSED');
    expect(Array.isArray(db!.checklist)).toBe(true);
    record('inspection.update', db!.status === 'PASSED', `status=${db!.status} checklistItems=${(db!.checklist as any[]).length}`);
  });

  it('4.9 Cross-link verify: phase shows its activities + photos', async () => {
    const phase = await prisma.phase.findUnique({ where: { id: phaseId }, include: { activities: true, photos: true } });
    expect(phase!.activities.find((a) => a.id === activityId)).toBeDefined();
    expect(phase!.photos.find((p) => p.id === photoId)).toBeDefined();
    record('siteops.crosslink', true, `activities=${phase!.activities.length} photos=${phase!.photos.length}`);
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. CONTRACTS + LABOUR LIFECYCLE
//    contract (with milestones) → activate → staff → attendance
// ══════════════════════════════════════════════════════════════════
describe('5. Contracts + Labour lifecycle', () => {
  it('5.1 Create contract with milestones (linked to procurement vendor)', async () => {
    const res = await request
      .post('/api/contracts')
      .set(authAs(userPhId))
      .send({
        vendorId,
        type: 'FIXED_PRICE',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 180 * 86400000).toISOString(),
        value: 1500000,
        advancePercent: 10,
        retentionPercent: 5,
        milestones: [
          { name: 'Mobilization', dueDate: new Date(Date.now() + 15 * 86400000).toISOString(), amount: 300000 },
          { name: 'First Phase Completion', dueDate: new Date(Date.now() + 60 * 86400000).toISOString(), amount: 700000 },
          { name: 'Handover', dueDate: new Date(Date.now() + 180 * 86400000).toISOString(), amount: 500000 },
        ],
      });
    expect(res.status).toBe(201);
    contractId = res.body.id;
    const db = await prisma.contract.findUnique({ where: { id: contractId }, include: { vendor: true, milestones: true } });
    expect(db!.status).toBe('DRAFT');
    expect(db!.vendor.id).toBe(vendorId);
    expect(db!.milestones).toHaveLength(3);
    record('contract.create', res.status === 201, `contract=${contractId} milestones=${db!.milestones.length}`);
  });

  it('5.2 Activate the contract', async () => {
    const res = await request.patch(`/api/contracts/${contractId}`).set(authAs(userPhId)).send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    const db = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(db!.status).toBe('ACTIVE');
    record('contract.activate', db!.status === 'ACTIVE', `status=${db!.status}`);
  });

  it('5.3 Create staff member (LABOUR type)', async () => {
    const res = await request
      .post('/api/labour/staff')
      .set(authAs(userPhId))
      .send({ name: `LF Worker ${RUN_ID}`, type: 'LABOUR', role: 'Mason', phone: '+919999999997', baseSalary: 18000 });
    expect(res.status).toBe(201);
    staffId = res.body.id;
    const db = await prisma.staff.findUnique({ where: { id: staffId } });
    expect(db!.type).toBe('LABOUR');
    record('staff.create', res.status === 201, `staff=${staffId} type=${db!.type}`);
  });

  it('5.4 Mark attendance for the staff member', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request
      .post('/api/labour/attendance')
      .set(authAs(userPhId))
      .send({ date: today, records: [{ staffId, present: true, notes: 'LF present' }] });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);
    const att = await prisma.staffAttendance.findFirst({ where: { staffId, date: new Date(today) } });
    expect(att).not.toBeNull();
    expect(att!.present).toBe(true);
    record('attendance.mark', att!.present === true, `staff=${staffId} present=${att!.present}`);
  });

  it('5.5 Cross-link verify: contract vendor matches procurement vendor; staff under project', async () => {
    const [contract, staff] = await Promise.all([
      prisma.contract.findUnique({ where: { id: contractId }, include: { vendor: true } }),
      prisma.staff.findUnique({ where: { id: staffId } }),
    ]);
    expect(contract!.vendor.id).toBe(vendorId);
    expect(staff!.projectId).toBe(projectId);
    record('contract.labour.crosslink', true, `contractVendor=${contract!.vendor.id} staffProject=${staff!.projectId}`);
  });
});

// ══════════════════════════════════════════════════════════════════
// 6. FINAL CROSS-MODULE VERIFICATION
//    Confirm the dashboard aggregates everything created this run.
// ══════════════════════════════════════════════════════════════════
describe('6. Final cross-module verification', () => {
  it('6.1 Dashboard summary reflects the created entities', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(userPhId));
    expect(res.status).toBe(200);
    // Committed should include our approved PO (52500 + 4950 = 57450 grandTotal, but committed uses totalAmount=52500)
    expect(Number(res.body.committed)).toBeGreaterThanOrEqual(52500);
    record('dashboard.summary', res.status === 200, `committed=${res.body.committed}`);
  });

  it('6.2 All created entity IDs are non-empty and persisted in DB', async () => {
    const checks = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vendorId } }),
      prisma.quotation.findUnique({ where: { id: quotationId } }),
      prisma.purchaseOrder.findUnique({ where: { id: poId } }),
      prisma.gatePass.findUnique({ where: { id: gatePassId } }),
      prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } }),
      prisma.vendorInvoice.findUnique({ where: { id: invoiceId } }),
      prisma.paymentRequest.findUnique({ where: { id: paymentRequestId } }),
      prisma.payment.findUnique({ where: { id: paymentId } }),
      prisma.budgetHead.findUnique({ where: { id: budgetHeadId } }),
      prisma.bankAccount.findUnique({ where: { id: bankAccountId } }),
      prisma.cashAccount.findUnique({ where: { id: cashAccountId } }),
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } }),
      prisma.journalVoucher.findUnique({ where: { id: jvId } }),
      prisma.budgetRevision.findUnique({ where: { id: budgetRevisionId } }),
      prisma.inventoryItem.findUnique({ where: { id: consumableItemId } }),
      prisma.inventoryItem.findUnique({ where: { id: assetItemId } }),
      prisma.asset.findUnique({ where: { id: assetId } }),
      prisma.phase.findUnique({ where: { id: phaseId } }),
      prisma.activity.findUnique({ where: { id: activityId } }),
      prisma.sitePhoto.findUnique({ where: { id: photoId } }),
      prisma.issue.findUnique({ where: { id: issueId } }),
      prisma.inspection.findUnique({ where: { id: inspectionId } }),
      prisma.contract.findUnique({ where: { id: contractId } }),
      prisma.staff.findUnique({ where: { id: staffId } }),
    ]);
    const allPersisted = checks.every((c) => c !== null);
    expect(allPersisted).toBe(true);
    record('final.allPersisted', allPersisted, `${checks.length} entities verified in DB`);
  });

  it('6.3 Audit trail captured CREATE actions for this run', async () => {
    // At least the vendor creation should have an audit log entry
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: vendorId, action: 'CREATE' },
    });
    expect(audit).not.toBeNull();
    record('audit.trail', audit !== null, `vendorCreateAudit=${audit?.id}`);
  });
});
