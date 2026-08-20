/**
 * E2E Test: Vendor → Quotation → PO → Invoice full flow
 * Uses REAL database (no mocks) — requires DATABASE_URL to be set.
 *
 * Setup:  Creates a dedicated test project + 2 head users before the suite.
 * Teardown: Deletes all test data (project, users, vendors, quotations, POs, invoices) after the suite.
 *
 * Run with: npx vitest run tests/e2e-real-vendor-po-invoice.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { prisma } from '../src/config/prisma';
import { UserRole } from '@hospital-erp/shared';
import app from '../src/app';

const request = supertest(app);

// Unique marker for this test run — all test data uses this project name
const TEST_RUN_ID = `e2e-${Date.now()}`;
const PROJECT_NAME = `E2E Test ${TEST_RUN_ID}`;

let projectId: string;
let userPhId: string;
let userHocId: string;
let vendorId: string;
let quotationId: string;
let poId: string;
let invoiceId: string;

function authAs(userId: string) {
  return { Authorization: `Bearer dev-token:${userId}` };
}

// ─── Setup: create test project + users ──────────────────────
beforeAll(async () => {
  // Create test project
  const project = await prisma.project.create({
    data: {
      name: PROJECT_NAME,
      status: 'ACTIVE',
      totalBudget: 10000000,
      startDate: new Date(),
      officeAddress: 'Test Office',
      hospitalAddress: 'Test Hospital',
    },
  });
  projectId = project.id;

  // Create Project Head user
  const userPh = await prisma.user.create({
    data: {
      firebaseUid: `test-fb-ph-${TEST_RUN_ID}`,
      phone: `+9199999000${TEST_RUN_ID.slice(-4)}`,
      name: `E2E Project Head ${TEST_RUN_ID}`,
      role: UserRole.PROJECT_HEAD,
      projectId,
      isActive: true,
    },
  });
  userPhId = userPh.id;

  // Create Head of Construction user
  const userHoc = await prisma.user.create({
    data: {
      firebaseUid: `test-fb-hoc-${TEST_RUN_ID}`,
      phone: `+9199999001${TEST_RUN_ID.slice(-4)}`,
      name: `E2E HoC ${TEST_RUN_ID}`,
      role: UserRole.HEAD_OF_CONSTRUCTION,
      projectId,
      isActive: true,
    },
  });
  userHocId = userHoc.id;
});

// ─── Teardown: delete all test data ──────────────────────────
afterAll(async () => {
  // Delete in dependency order (children first, parents last)
  // 1. Delete approval steps + workflows for test project entities
  const testWorkflows = await prisma.approvalWorkflow.findMany({
    where: { projectId },
    select: { id: true },
  });
  if (testWorkflows.length > 0) {
    await prisma.approvalStep.deleteMany({
      where: { workflowId: { in: testWorkflows.map((w) => w.id) } },
    });
    await prisma.approvalWorkflow.deleteMany({
      where: { id: { in: testWorkflows.map((w) => w.id) } },
    });
  }

  // 2. Delete gate passes, inventory transactions, inventory items
  await prisma.inventoryTransaction.deleteMany({ where: { inventoryItem: { projectId } } });
  await prisma.inventoryItem.deleteMany({ where: { projectId } });
  await prisma.gatePassItem.deleteMany({ where: { gatePass: { projectId } } });
  await prisma.gatePass.deleteMany({ where: { projectId } });

  // 3. Delete payments, payment requests, invoices
  await prisma.payment.deleteMany({ where: { paymentRequest: { projectId } } });
  await prisma.paymentRequest.deleteMany({ where: { projectId } });
  await prisma.vendorInvoice.deleteMany({ where: { projectId } });

  // 4. Delete PO items + POs
  await prisma.pOItem.deleteMany({ where: { purchaseOrder: { projectId } } });
  await prisma.purchaseOrder.deleteMany({ where: { projectId } });

  // 5. Delete quotation items + quotations
  await prisma.quotationItem.deleteMany({ where: { quotation: { projectId } } });
  await prisma.quotation.deleteMany({ where: { projectId } });

  // 6. Delete vendor materials + vendors
  await prisma.vendorMaterial.deleteMany({ where: { vendor: { projectId } } });
  await prisma.vendor.deleteMany({ where: { projectId } });

  // 7. Delete issues, inspections, documents, contracts, staff, etc.
  await prisma.issue.deleteMany({ where: { projectId } });
  await prisma.inspection.deleteMany({ where: { projectId } });
  await prisma.document.deleteMany({ where: { projectId } });
  await prisma.contractMilestone.deleteMany({ where: { contract: { projectId } } });
  await prisma.contract.deleteMany({ where: { projectId } });
  await prisma.staffAttendance.deleteMany({ where: { staff: { projectId } } });
  await prisma.staff.deleteMany({ where: { projectId } });
  await prisma.activity.deleteMany({ where: { phase: { projectId } } });
  await prisma.phase.deleteMany({ where: { projectId } });
  await prisma.sitePhoto.deleteMany({ where: { projectId } });
  await prisma.auditLog.deleteMany({ where: { projectId } });

  // 8. Delete users + project
  await prisma.user.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });

  await prisma.$disconnect();
});

// ─── E2E Test: Full Vendor → Quotation → PO → Invoice flow ──
describe('E2E (Real DB): Vendor → Quotation → PO → Invoice full flow', () => {
  it('1. Create a vendor with materials', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(userPhId))
      .send({
        name: `E2E Vendor ${TEST_RUN_ID}`,
        contactPersonName: 'Ramesh',
        contactPersonPhone: '+919999999999',
        phone: '+918888888888',
        category: 'CONSTRUCTION',
        materials: [
          { name: 'Cement', unit: 'bag', pricePerUnit: 350 },
          { name: 'Steel Rods', unit: 'kg', pricePerUnit: 65 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toContain(TEST_RUN_ID);
    expect(res.body.vendorCode).toMatch(/^VGH-\d{3}$/);
    expect(res.body.materials).toHaveLength(2);
    vendorId = res.body.id;
  });

  it('2. Create a quotation for the vendor (with matching materials)', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(userPhId))
      .send({
        vendorId,
        items: [
          { materialName: 'Cement', quantity: 100, unit: 'bag', unitPrice: 350 },
          { materialName: 'Steel Rods', quantity: 500, unit: 'kg', unitPrice: 65 },
        ],
        gstAmount: 5250,
        acknowledged: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.quotationNumber).toMatch(/^VGH-Q\d{3}$/);
    expect(res.body.status).toBe('SUBMITTED');
    expect(Number(res.body.totalAmount)).toBe(67500);
    expect(Number(res.body.gstAmount)).toBe(5250);
    expect(Number(res.body.grandTotal)).toBe(72750);
    expect(res.body.items).toHaveLength(2);
    quotationId = res.body.id;
  });

  it('3. Quotation should have four eligible head-role steps', async () => {
    const res = await request
      .get(`/api/quotations/${quotationId}`)
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.steps[0].approverRole).toBe(UserRole.PROJECT_HEAD);
    expect(res.body.approvalWorkflow.steps[1].approverRole).toBe(UserRole.HEAD_OF_CONSTRUCTION);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('4. Approve quotation — step 1 (by Project Head)', async () => {
    const quotation = await request.get(`/api/quotations/${quotationId}`).set(authAs(userPhId));
    const step1Id = quotation.body.approvalWorkflow.steps[0].id;

    const res = await request
      .post(`/api/quotations/${quotationId}/approve/${step1Id}`)
      .set(authAs(userPhId))
      .send({ acknowledged: true, comments: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('APPROVED');
  });

  it('5. Approve quotation — step 2 (by Head of Construction) → quotation becomes APPROVED', async () => {
    const quotation = await request.get(`/api/quotations/${quotationId}`).set(authAs(userPhId));
    const step2Id = quotation.body.approvalWorkflow.steps[1].id;

    const res = await request
      .post(`/api/quotations/${quotationId}/approve/${step2Id}`)
      .set(authAs(userHocId))
      .send({ acknowledged: true, comments: 'Approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('6. Create a Purchase Order from the approved quotation', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(userPhId))
      .send({
        vendorId,
        quotationId,
        gstAmount: 5250,
        acknowledged: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.poNumber).toMatch(/^VGH-PO\d{3}$/);
    expect(res.body.status).toBe('PENDING_APPROVAL');
    expect(Number(res.body.totalAmount)).toBe(67500);
    expect(Number(res.body.grandTotal)).toBe(72750);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.vendor.id).toBe(vendorId);
    expect(res.body.quotation.id).toBe(quotationId);
    poId = res.body.id;
  });

  it('7. PO should have an approval workflow with 4 head-role steps, minApprovers=2', async () => {
    const res = await request
      .get(`/api/purchase-orders/${poId}`)
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('8. Approve PO — first approval (by Project Head)', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(userPhId))
      .send({ acknowledged: true, comments: 'PO approved by Project Head' });

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('APPROVED');
  });

  it('9. Approve PO — second approval (by Head of Construction) → PO becomes APPROVED', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(userHocId))
      .send({ acknowledged: true, comments: 'PO approved by HoC' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('10. Same person cannot approve PO twice', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(userPhId))
      .send({ acknowledged: true, comments: 'Trying again' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already approved');
  });

  it('11. Create an invoice for the approved PO', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(userPhId))
      .send({
        vendorId,
        poId,
        invoiceNumber: `INV-E2E-${TEST_RUN_ID}`,
        amount: 67500,
        taxAmount: 5250,
        totalAmount: 72750,
        advancePaid: 10000,
        advanceType: 'Cash',
        acknowledged: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.invoiceCode).toMatch(/^VGH-INV\d{3}$/);
    expect(res.body.invoiceNumber).toContain(TEST_RUN_ID);
    expect(res.body.verificationStatus).toBe('PENDING');
    expect(res.body.paymentStatus).toBe('PENDING');
    expect(res.body.stockStatus).toBe('PENDING');
    expect(Number(res.body.totalAmount)).toBe(72750);
    invoiceId = res.body.id;
  });

  it('12. Invoice should have an approval workflow with 4 head-role steps, minApprovers=2', async () => {
    const res = await request
      .get(`/api/invoices/${invoiceId}`)
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('13. Approve invoice — first approval (by Project Head)', async () => {
    const res = await request
      .post(`/api/invoices/${invoiceId}/approve`)
      .set(authAs(userPhId))
      .send({ acknowledged: true, comments: 'Invoice verified' });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).not.toBe('VERIFIED');
  });

  it('14. Approve invoice — second approval (by Head of Construction) → invoice becomes VERIFIED', async () => {
    const res = await request
      .post(`/api/invoices/${invoiceId}/approve`)
      .set(authAs(userHocId))
      .send({ acknowledged: true, comments: 'Invoice verified by HoC' });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('VERIFIED');
  });

  it('15. List vendors — should include the created vendor', async () => {
    const res = await request
      .get('/api/vendors')
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const found = res.body.data.find((v: any) => v.id === vendorId);
    expect(found).toBeDefined();
    expect(found.name).toContain(TEST_RUN_ID);
  });

  it('16. List quotations — should include the approved quotation', async () => {
    const res = await request
      .get('/api/quotations')
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    const found = res.body.data.find((q: any) => q.id === quotationId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it('17. List POs — should include the approved PO', async () => {
    const res = await request
      .get('/api/purchase-orders')
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    const found = res.body.data.find((p: any) => p.id === poId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it('18. List invoices — should include the verified invoice', async () => {
    const res = await request
      .get('/api/invoices')
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    const found = res.body.data.find((i: any) => i.id === invoiceId);
    expect(found).toBeDefined();
    expect(found.verificationStatus).toBe('VERIFIED');
  });

  it('19. Dashboard should show committed amount including the approved PO', async () => {
    const res = await request
      .get('/api/dashboard/summary')
      .set(authAs(userPhId));

    expect(res.status).toBe(200);
    expect(Number(res.body.committed)).toBeGreaterThanOrEqual(67500);
  });

  it('20. Cannot create PO from a non-approved quotation', async () => {
    const quotRes = await request
      .post('/api/quotations')
      .set(authAs(userPhId))
      .send({
        vendorId,
        items: [
          { materialName: 'Cement', quantity: 10, unit: 'bag', unitPrice: 350 },
        ],
        gstAmount: 0,
        acknowledged: true,
      });

    expect(quotRes.status).toBe(201);
    const newQuotationId = quotRes.body.id;

    const poRes = await request
      .post('/api/purchase-orders')
      .set(authAs(userPhId))
      .send({
        vendorId,
        quotationId: newQuotationId,
        gstAmount: 0,
        acknowledged: true,
      });

    expect(poRes.status).toBe(400);
    expect(poRes.body.error).toContain('Only approved quotations');
  });

  it('21. Cannot create quotation with materials not supplied by vendor', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(userPhId))
      .send({
        vendorId,
        items: [
          { materialName: 'Bricks', quantity: 1000, unit: 'pcs', unitPrice: 5 },
        ],
        gstAmount: 0,
        acknowledged: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not supplied by vendor');
  });

  it('22. Health check returns ok', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
