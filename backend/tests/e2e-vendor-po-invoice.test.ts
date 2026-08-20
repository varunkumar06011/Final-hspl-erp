import { describe, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import { UserRole } from '@hospital-erp/shared';

// ─── Hoisted in-memory database ──────────────────────────────
// vi.mock is hoisted to the top of the file, so all data it needs
// must also be hoisted via vi.hoisted.
const { tables, createModelMock, seedData } = vi.hoisted(() => {
  interface Record_ { [key: string]: any; id: string; deletedAt?: string | null; }

  const tables: Record<string, Map<string, Record_>> = {
    user: new Map(),
    project: new Map(),
    vendor: new Map(),
    vendorMaterial: new Map(),
    quotation: new Map(),
    quotationItem: new Map(),
    purchaseOrder: new Map(),
    purchaseOrderItem: new Map(),
    vendorInvoice: new Map(),
    approvalWorkflow: new Map(),
    approvalStep: new Map(),
    auditLog: new Map(),
    payment: new Map(),
    paymentRequest: new Map(),
    inventoryItem: new Map(),
    issue: new Map(),
    phase: new Map(),
  };

  // ─── Helper: match where clause ──────────────────────────
  function matchWhere(record: Record_, where: any): boolean {
    if (!where) return true;
    for (const [key, condition] of Object.entries(where)) {
      if (key === 'AND') {
        return (condition as any[]).every((sub) => matchWhere(record, sub));
      }
      if (key === 'deletedAt') {
        if (condition === null) {
          if (record.deletedAt != null) return false;
          continue;
        }
      }
      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition) && !(condition instanceof Date)) {
        const val = record[key];
        if (condition.in !== undefined) {
          if (!condition.in.includes(val)) return false;
        } else if (condition.startsWith !== undefined) {
          if (typeof val !== 'string' || !val.startsWith(condition.startsWith)) return false;
        }
      } else {
        if (record[key] !== condition) return false;
      }
    }
    return true;
  }

  // ─── Helper: resolve includes ────────────────────────────
  function resolveIncludes(record: Record_, include: any): Record_ {
    if (!include || !record) return record;
    const result = { ...record };

    // Context-aware: items maps to different tables depending on parent type
    // POs have poNumber, quotations have quotationNumber
    const isPO = 'poNumber' in record;
    const relationMap: Record<string, { table: string; fk: string; isList: boolean; reverseFk?: string }> = {
      materials: { table: 'vendorMaterial', fk: 'vendorId', isList: true },
      items: isPO ? { table: 'purchaseOrderItem', fk: 'poId', isList: true } : { table: 'quotationItem', fk: 'quotationId', isList: true },
      steps: { table: 'approvalStep', fk: 'workflowId', isList: true },
      vendor: { table: 'vendor', fk: 'id', isList: false, reverseFk: 'vendorId' },
      quotation: { table: 'quotation', fk: 'id', isList: false, reverseFk: 'quotationId' },
      project: { table: 'project', fk: 'id', isList: false, reverseFk: 'projectId' },
      createdByUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'createdBy' },
      uploadedByUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'uploadedBy' },
      approvalWorkflow: { table: 'approvalWorkflow', fk: 'id', isList: false, reverseFk: 'approvalWorkflowId' },
      workflow: { table: 'approvalWorkflow', fk: 'id', isList: false, reverseFk: 'workflowId' },
      inspector: { table: 'user', fk: 'id', isList: false, reverseFk: 'inspectorId' },
      invoice: { table: 'vendorInvoice', fk: 'id', isList: false, reverseFk: 'invoiceId' },
      purchaseOrder: { table: 'purchaseOrder', fk: 'id', isList: false, reverseFk: 'poId' },
      otpRequestedForUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'otpRequestedFor' },
      otpApprovedByUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'otpApprovedBy' },
      approverUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'approverUserId' },
    };

    for (const [relName, relConfig] of Object.entries(include)) {
      const r = relationMap[relName];
      if (!r) continue;

      if (r.isList) {
        const children: Record_[] = [];
        for (const child of tables[r.table].values()) {
          if (child[r.fk] === record.id) {
            let childResult = { ...child };
            if (typeof relConfig === 'object' && relConfig.include) {
              childResult = resolveIncludes(childResult, relConfig.include);
            }
            children.push(childResult);
          }
        }
        if (typeof relConfig === 'object' && relConfig.orderBy) {
          for (const [sortKey, sortDir] of Object.entries(relConfig.orderBy)) {
            children.sort((a, b) => (sortDir === 'asc' ? (a[sortKey] > b[sortKey] ? 1 : -1) : a[sortKey] < b[sortKey] ? 1 : -1));
          }
        }
        (result as any)[relName] = children;
      } else {
        const fkValue = (record as any)[r.reverseFk!];
        if (fkValue == null) {
          (result as any)[relName] = null;
        } else {
          const related = tables[r.table].get(fkValue);
          if (related) {
            let relResult = { ...related };
            if (typeof relConfig === 'object' && relConfig.include) {
              relResult = resolveIncludes(relResult, relConfig.include);
            }
            if (typeof relConfig === 'object' && relConfig.select) {
              relResult = applySelect(relResult, relConfig.select);
            }
            (result as any)[relName] = relResult;
          } else {
            (result as any)[relName] = null;
          }
        }
      }
    }
    return result;
  }

  function applySelect(record: Record_, select: any): Record_ {
    if (!select) return record;
    const result: Record_ = {};
    for (const key of Object.keys(select)) {
      if (key in record) result[key] = record[key];
    }
    return result;
  }

  // ─── Helper: handle nested creates ───────────────────────
  function handleNestedCreate(parentTable: string, data: any): any {
    const result: any = { ...data };
    // Context-aware nested map: items maps to different tables depending on parent
    const nestedMap: Record<string, { table: string; fk: string }> = {
      materials: { table: 'vendorMaterial', fk: 'vendorId' },
      steps: { table: 'approvalStep', fk: 'workflowId' },
    };
    // Items relation: quotation → quotationItem, purchaseOrder → purchaseOrderItem (poItem)
    if (parentTable === 'quotation') {
      nestedMap.items = { table: 'quotationItem', fk: 'quotationId' };
    } else if (parentTable === 'purchaseOrder') {
      nestedMap.items = { table: 'purchaseOrderItem', fk: 'poId' };
    }
    for (const [nestedName, nestedConfig] of Object.entries(nestedMap)) {
      if (data[nestedName] && data[nestedName].create) {
        const creates = Array.isArray(data[nestedName].create) ? data[nestedName].create : [data[nestedName].create];
        result[`__nested_${nestedName}`] = { config: nestedConfig, creates };
        delete result[nestedName];
      }
    }
    return result;
  }

  function executeNestedCreates(parentId: string, data: any): void {
    for (const [nestedName, nestedData] of Object.entries(data)) {
      if (nestedName.startsWith('__nested_') && nestedData) {
        const { config, creates } = nestedData as any;
        for (const createData of creates) {
          const childId = createData.id || crypto.randomUUID();
          const childRecord = { ...createData, id: childId, [config.fk]: parentId };
          tables[config.table].set(childId, childRecord);
        }
      }
    }
  }

  // ─── Create the mock model ───────────────────────────────
  function createModelMock(tableName: string): any {
    const table = tables[tableName];
    return {
      findMany: vi.fn(async ({ where, include, orderBy, skip, take, select }: any = {}) => {
        let records: Record_[] = [];
        for (const record of table.values()) {
          if (matchWhere(record, where)) records.push({ ...record });
        }
        if (orderBy) {
          for (const [key, dir] of Object.entries(orderBy)) {
            records.sort((a, b) => (dir === 'asc' ? (a[key] > b[key] ? 1 : -1) : a[key] < b[key] ? 1 : -1));
          }
        }
        if (skip) records = records.slice(skip);
        if (take) records = records.slice(0, take);
        if (include) records = records.map((r) => resolveIncludes(r, include));
        if (select) records = records.map((r) => applySelect(r, select));
        return records;
      }),
      findFirst: vi.fn(async ({ where, include, select }: any = {}) => {
        for (const record of table.values()) {
          if (matchWhere(record, where)) {
            let result = { ...record };
            if (include) result = resolveIncludes(result, include);
            if (select) result = applySelect(result, select);
            return result;
          }
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where, include, select }: any = {}) => {
        let record: Record_ | undefined;
        if (where.id) {
          record = table.get(where.id);
        } else {
          for (const r of table.values()) {
            let match = true;
            for (const [key, val] of Object.entries(where)) {
              if (r[key] !== val) { match = false; break; }
            }
            if (match) { record = r; break; }
          }
        }
        if (!record) return null;
        let result = { ...record };
        if (include) result = resolveIncludes(result, include);
        if (select) result = applySelect(result, select);
        return result;
      }),
      create: vi.fn(async ({ data, include }: any = {}) => {
        const id = data.id || crypto.randomUUID();
        const processed = handleNestedCreate(tableName, data);
        const record = { ...processed, id, createdAt: new Date(), updatedAt: new Date() };
        table.set(id, record);
        executeNestedCreates(id, record);
        let result = { ...record };
        for (const key of Object.keys(result)) {
          if (key.startsWith('__nested_')) delete result[key];
        }
        if (include) {
          const fetched = await createModelMock(tableName).findUnique({ where: { id }, include });
          if (fetched) result = fetched;
        }
        return result;
      }),
      update: vi.fn(async ({ where, data, include }: any = {}) => {
        let record: Record_ | undefined;
        if (where.id) {
          record = table.get(where.id);
        } else {
          for (const r of table.values()) {
            let match = true;
            for (const [key, val] of Object.entries(where)) {
              if (r[key] !== val) { match = false; break; }
            }
            if (match) { record = r; break; }
          }
        }
        if (!record) throw new Error('Record not found');
        const updated = { ...record, ...data, updatedAt: new Date() };
        table.set(record.id, updated);
        let result = { ...updated };
        if (include) {
          const fetched = await createModelMock(tableName).findUnique({ where: { id: record.id }, include });
          if (fetched) result = fetched;
        }
        return result;
      }),
      updateMany: vi.fn(async ({ where, data }: any = {}) => {
        let count = 0;
        for (const record of table.values()) {
          if (matchWhere(record, where)) {
            Object.assign(record, data);
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const [id, record] of table.entries()) {
          if (matchWhere(record, where)) {
            table.delete(id);
            count++;
          }
        }
        return { count };
      }),
      count: vi.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const record of table.values()) {
          if (matchWhere(record, where)) count++;
        }
        return count;
      }),
      aggregate: vi.fn(async ({ where, _sum }: any = {}) => {
        const records: Record_[] = [];
        for (const record of table.values()) {
          if (matchWhere(record, where)) records.push(record);
        }
        const result: any = { _sum: {} };
        if (_sum) {
          for (const key of Object.keys(_sum)) {
            result._sum[key] = records.reduce((sum, r) => sum + Number(r[key] || 0), 0);
          }
        }
        return result;
      }),
    };
  }

  // ─── Seed data ──────────────────────────────────────────
  function seedData() {
    const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
    const USER_PH = { id: '00000000-0000-0000-0000-000000000010', firebaseUid: 'fb-head', phone: '+910000000010', name: 'Project Head', role: 'PROJECT_HEAD', projectId: PROJECT_ID, isActive: true };
    const USER_HOC = { id: '00000000-0000-0000-0000-000000000011', firebaseUid: 'fb-hoc', phone: '+910000000011', name: 'Head of Construction', role: 'HEAD_OF_CONSTRUCTION', projectId: PROJECT_ID, isActive: true };
    const PROJECT = { id: PROJECT_ID, name: 'Test Hospital', status: 'ACTIVE', totalBudget: 10000000, officeAddress: 'Office 1', hospitalAddress: 'Hospital 1' };
    tables.user.set(USER_PH.id, { ...USER_PH });
    tables.user.set(USER_HOC.id, { ...USER_HOC });
    tables.project.set(PROJECT.id, { ...PROJECT });
  }

  return { tables, createModelMock, seedData };
});

// ─── Set up mocks (hoisted) ──────────────────────────────────
vi.mock('../src/config/prisma', () => ({
  prisma: {
    user: createModelMock('user'),
    project: createModelMock('project'),
    vendor: createModelMock('vendor'),
    vendorMaterial: createModelMock('vendorMaterial'),
    quotation: createModelMock('quotation'),
    quotationItem: createModelMock('quotationItem'),
    purchaseOrder: createModelMock('purchaseOrder'),
    purchaseOrderItem: createModelMock('purchaseOrderItem'),
    vendorInvoice: createModelMock('vendorInvoice'),
    approvalWorkflow: createModelMock('approvalWorkflow'),
    approvalStep: createModelMock('approvalStep'),
    auditLog: createModelMock('auditLog'),
    payment: createModelMock('payment'),
    paymentRequest: createModelMock('paymentRequest'),
    inventoryItem: createModelMock('inventoryItem'),
    issue: createModelMock('issue'),
    phase: createModelMock('phase'),
  },
}));

vi.mock('../src/config/firebase', () => ({
  verifyFirebaseToken: vi.fn(),
}));

vi.mock('../src/socket', () => ({
  initSocketServer: vi.fn(),
}));

vi.mock('../src/services/storage.service', () => ({
  getStorageService: () => ({
    upload: vi.fn(async (buffer: Buffer, fileName: string) => ({
      filePath: `/uploads/${fileName}`,
      fileName,
    })),
    delete: vi.fn(async () => {}),
  }),
}));

vi.mock('../src/services/audit.service', () => ({
  logAudit: vi.fn(async () => {}),
}));

// ─── Seed before importing app ───────────────────────────────
seedData();

// Import app AFTER mocks are set up
import app from '../src/app';

const request = supertest(app);

// ─── Constants ───────────────────────────────────────────────
const USER_PROJECT_HEAD = '00000000-0000-0000-0000-000000000010';
const USER_HOC = '00000000-0000-0000-0000-000000000011';

function authAs(userId: string) {
  return { Authorization: `Bearer dev-token:${userId}` };
}

// ─── E2E Test: Full Vendor → Quotation → PO → Invoice flow ──
describe('E2E: Vendor → Quotation → PO → Invoice full flow', () => {
  let vendorId: string;
  let quotationId: string;
  let poId: string;
  let invoiceId: string;

  it('1. Create a vendor with materials', async () => {
    const res = await request
      .post('/api/vendors')
      .set(authAs(USER_PROJECT_HEAD))
      .send({
        name: 'Test Vendor Pvt Ltd',
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
    expect(res.body.name).toBe('Test Vendor Pvt Ltd');
    expect(res.body.vendorCode).toMatch(/^VGH-\d{3}$/);
    expect(res.body.materials).toHaveLength(2);
    vendorId = res.body.id;
  });

  it('2. Create a quotation for the vendor (with matching materials)', async () => {
    const res = await request
      .post('/api/quotations')
      .set(authAs(USER_PROJECT_HEAD))
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
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.steps[0].approverRole).toBe(UserRole.PROJECT_HEAD);
    expect(res.body.approvalWorkflow.steps[1].approverRole).toBe(UserRole.HEAD_OF_CONSTRUCTION);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('4. Approve quotation — step 1 (by Project Head)', async () => {
    const quotation = await request.get(`/api/quotations/${quotationId}`).set(authAs(USER_PROJECT_HEAD));
    const step1Id = quotation.body.approvalWorkflow.steps[0].id;

    const res = await request
      .post(`/api/quotations/${quotationId}/approve/${step1Id}`)
      .set(authAs(USER_PROJECT_HEAD))
      .send({ acknowledged: true, comments: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('APPROVED');
  });

  it('5. Approve quotation — step 2 (by Head of Construction) → quotation becomes APPROVED', async () => {
    const quotation = await request.get(`/api/quotations/${quotationId}`).set(authAs(USER_PROJECT_HEAD));
    const step2Id = quotation.body.approvalWorkflow.steps[1].id;

    const res = await request
      .post(`/api/quotations/${quotationId}/approve/${step2Id}`)
      .set(authAs(USER_HOC))
      .send({ acknowledged: true, comments: 'Approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('6. Create a Purchase Order from the approved quotation', async () => {
    const res = await request
      .post('/api/purchase-orders')
      .set(authAs(USER_PROJECT_HEAD))
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
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('8. Approve PO — first approval (by Project Head)', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(USER_PROJECT_HEAD))
      .send({ acknowledged: true, comments: 'PO approved by Project Head' });

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('APPROVED');
  });

  it('9. Approve PO — second approval (by Head of Construction) → PO becomes APPROVED', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(USER_HOC))
      .send({ acknowledged: true, comments: 'PO approved by HoC' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  it('10. Same person cannot approve PO twice', async () => {
    const res = await request
      .post(`/api/purchase-orders/${poId}/approve`)
      .set(authAs(USER_PROJECT_HEAD))
      .send({ acknowledged: true, comments: 'Trying again' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already approved');
  });

  it('11. Create an invoice for the approved PO', async () => {
    const res = await request
      .post('/api/invoices')
      .set(authAs(USER_PROJECT_HEAD))
      .send({
        vendorId,
        poId,
        amount: 67500,
        taxAmount: 5250,
        totalAmount: 72750,
        advancePaid: 10000,
        advanceType: 'Cash',
        acknowledged: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.invoiceCode).toMatch(/^VGH-IN\d{3}$/);
    expect(res.body.invoiceNumber).toBe(res.body.invoiceCode);
    expect(res.body.verificationStatus).toBe('PENDING');
    expect(res.body.paymentStatus).toBe('PENDING');
    expect(res.body.stockStatus).toBe('PENDING');
    expect(Number(res.body.totalAmount)).toBe(72750);
    invoiceId = res.body.id;
  });

  it('12. Invoice should have an approval workflow with 4 head-role steps, minApprovers=2', async () => {
    const res = await request
      .get(`/api/invoices/${invoiceId}`)
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    expect(res.body.approvalWorkflow).toBeDefined();
    expect(res.body.approvalWorkflow.steps).toHaveLength(4);
    expect(res.body.approvalWorkflow.minApprovers).toBe(2);
  });

  it('13. Approve invoice — first approval (by Project Head)', async () => {
    const res = await request
      .post(`/api/invoices/${invoiceId}/approve`)
      .set(authAs(USER_PROJECT_HEAD))
      .send({ acknowledged: true, comments: 'Invoice verified' });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).not.toBe('VERIFIED');
  });

  it('14. Approve invoice — second approval (by Head of Construction) → invoice becomes VERIFIED', async () => {
    const res = await request
      .post(`/api/invoices/${invoiceId}/approve`)
      .set(authAs(USER_HOC))
      .send({ acknowledged: true, comments: 'Invoice verified by HoC' });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('VERIFIED');
  });

  it('15. List vendors — should include the created vendor', async () => {
    const res = await request
      .get('/api/vendors')
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const found = res.body.data.find((v: any) => v.id === vendorId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Test Vendor Pvt Ltd');
  });

  it('16. List quotations — should include the approved quotation', async () => {
    const res = await request
      .get('/api/quotations')
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    const found = res.body.data.find((q: any) => q.id === quotationId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it('17. List POs — should include the approved PO', async () => {
    const res = await request
      .get('/api/purchase-orders')
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    const found = res.body.data.find((p: any) => p.id === poId);
    expect(found).toBeDefined();
    expect(found.status).toBe('APPROVED');
  });

  it('18. List invoices — should include the verified invoice', async () => {
    const res = await request
      .get('/api/invoices')
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    const found = res.body.data.find((i: any) => i.id === invoiceId);
    expect(found).toBeDefined();
    expect(found.verificationStatus).toBe('VERIFIED');
  });

  it('19. Dashboard should show committed amount including the approved PO', async () => {
    const res = await request
      .get('/api/dashboard/summary')
      .set(authAs(USER_PROJECT_HEAD));

    expect(res.status).toBe(200);
    expect(Number(res.body.committed)).toBeGreaterThanOrEqual(67500);
  });

  it('20. Cannot create PO from a non-approved quotation', async () => {
    const quotRes = await request
      .post('/api/quotations')
      .set(authAs(USER_PROJECT_HEAD))
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
      .set(authAs(USER_PROJECT_HEAD))
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
      .set(authAs(USER_PROJECT_HEAD))
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
