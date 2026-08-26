/**
 * Business Rules Tests
 * ====================
 *
 * Tests for the 6 critical/medium issues fixed:
 * 1. Self-approval blocked (segregation of duties)
 * 2. Invoice creation validates PO status
 * 4. Vendor deletion validation
 * 5. PO deletion blocks PARTIALLY_DELIVERED / APPROVED
 * 6. Quotation deletion blocks APPROVED and CONVERTED_TO_PO
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ApprovalStatus, ApprovalStepStatus, UserRole, QuotationStatus, POStatus } from '@hospital-erp/shared';

// ─── Mock prisma with in-memory tables ──────────────────────
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
    inventoryTransaction: new Map(),
    issue: new Map(),
    phase: new Map(),
    gatePass: new Map(),
    gatePassItem: new Map(),
    goodsReceipt: new Map(),
    goodsReceiptItem: new Map(),
    inspection: new Map(),
  };

  function matchWhere(record: Record_, where: any): boolean {
    if (!where) return true;
    for (const [key, condition] of Object.entries(where)) {
      if (key === 'AND') return (condition as any[]).every((sub) => matchWhere(record, sub));
      if (key === 'deletedAt') {
        if (condition === null) { if (record.deletedAt != null) return false; continue; }
      }
      if (typeof condition === 'object' && condition !== null && !Array.isArray(condition) && !(condition instanceof Date)) {
        const val = record[key];
        if (condition.in !== undefined) { if (!condition.in.includes(val)) return false; }
        else if (condition.not !== undefined) { if (val === condition.not) return false; }
        else if (condition.startsWith !== undefined) { if (typeof val !== 'string' || !val.startsWith(condition.startsWith)) return false; }
      } else {
        if (record[key] !== condition) return false;
      }
    }
    return true;
  }

  function resolveIncludes(record: Record_, include: any): Record_ {
    if (!include || !record) return record;
    const result = { ...record };
    const isPO = 'poNumber' in record;
    const isGoodsReceipt = 'receiptNumber' in record && 'gatePassId' in record;
    const relationMap: Record<string, { table: string; fk: string; isList: boolean; reverseFk?: string }> = {
      materials: { table: 'vendorMaterial', fk: 'vendorId', isList: true },
      items: isGoodsReceipt
        ? { table: 'goodsReceiptItem', fk: 'goodsReceiptId', isList: true }
        : isPO
          ? { table: 'purchaseOrderItem', fk: 'poId', isList: true }
          : { table: 'quotationItem', fk: 'quotationId', isList: true },
      steps: { table: 'approvalStep', fk: 'workflowId', isList: true },
      vendor: { table: 'vendor', fk: 'id', isList: false, reverseFk: 'vendorId' },
      quotation: { table: 'quotation', fk: 'id', isList: false, reverseFk: 'quotationId' },
      project: { table: 'project', fk: 'id', isList: false, reverseFk: 'projectId' },
      createdByUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'createdBy' },
      approvalWorkflow: { table: 'approvalWorkflow', fk: 'id', isList: false, reverseFk: 'approvalWorkflowId' },
      workflow: { table: 'approvalWorkflow', fk: 'id', isList: false, reverseFk: 'workflowId' },
      approverUser: { table: 'user', fk: 'id', isList: false, reverseFk: 'approverUserId' },
      poItem: { table: 'purchaseOrderItem', fk: 'id', isList: false, reverseFk: 'poItemId' },
      goodsReceipt: { table: 'goodsReceipt', fk: 'id', isList: false, reverseFk: 'goodsReceiptId' },
      gatePass: { table: 'gatePass', fk: 'id', isList: false, reverseFk: 'gatePassId' },
      purchaseOrder: { table: 'purchaseOrder', fk: 'id', isList: false, reverseFk: 'poId' },
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
        (result as any)[relName] = children;
      } else {
        const fkValue = (record as any)[r.reverseFk!];
        if (fkValue == null) { (result as any)[relName] = null; }
        else {
          const related = tables[r.table].get(fkValue);
          (result as any)[relName] = related ? { ...related } : null;
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

  function handleNestedCreate(parentTable: string, data: any): any {
    const result: any = { ...data };
    const nestedMap: Record<string, { table: string; fk: string }> = {
      materials: { table: 'vendorMaterial', fk: 'vendorId' },
      steps: { table: 'approvalStep', fk: 'workflowId' },
    };
    if (parentTable === 'quotation') nestedMap.items = { table: 'quotationItem', fk: 'quotationId' };
    else if (parentTable === 'purchaseOrder') nestedMap.items = { table: 'purchaseOrderItem', fk: 'poId' };
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
          tables[config.table].set(childId, { ...createData, id: childId, [config.fk]: parentId });
        }
      }
    }
  }

  function createModelMock(tableName: string): any {
    const table = tables[tableName];
    return {
      findMany: vi.fn(async ({ where, include, select, orderBy, skip, take }: any = {}) => {
        let records: Record_[] = [];
        for (const record of table.values()) { if (matchWhere(record, where)) records.push({ ...record }); }
        if (orderBy) { for (const [key, dir] of Object.entries(orderBy)) { records.sort((a, b) => (dir === 'asc' ? (a[key] > b[key] ? 1 : -1) : a[key] < b[key] ? 1 : -1)); } }
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
        if (where.id) { record = table.get(where.id); }
        else {
          for (const [k, v] of Object.entries(where)) {
            if (k.includes('_')) continue; // skip compound keys
            for (const r of table.values()) { if (r[k] === v) { record = r; break; } }
            if (record) break;
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
        for (const key of Object.keys(result)) { if (key.startsWith('__nested_')) delete result[key]; }
        if (include) { const fetched = await createModelMock(tableName).findUnique({ where: { id }, include }); if (fetched) result = fetched; }
        return result;
      }),
      createMany: vi.fn(async ({ data }: any = {}) => {
        const creates = Array.isArray(data) ? data : [data];
        for (const cd of creates) { const id = cd.id || crypto.randomUUID(); table.set(id, { ...cd, id, createdAt: new Date(), updatedAt: new Date() }); }
        return { count: creates.length };
      }),
      update: vi.fn(async ({ where, data, include }: any = {}) => {
        let record = table.get(where.id);
        if (!record) throw new Error('Record not found');
        const updated = { ...record, ...data, updatedAt: new Date() };
        table.set(record.id, updated);
        if (include) { const fetched = await createModelMock(tableName).findUnique({ where: { id: record.id }, include }); if (fetched) return fetched; }
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: any = {}) => {
        let count = 0;
        for (const record of table.values()) { if (matchWhere(record, where)) { Object.assign(record, data); count++; } }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const [id, record] of table.entries()) { if (matchWhere(record, where)) { table.delete(id); count++; } }
        return { count };
      }),
      count: vi.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const record of table.values()) { if (matchWhere(record, where)) count++; }
        return count;
      }),
      aggregate: vi.fn(async ({ where, _sum }: any = {}) => {
        const records: Record_[] = [];
        for (const record of table.values()) { if (matchWhere(record, where)) records.push(record); }
        const result: any = { _sum: {} };
        if (_sum) { for (const key of Object.keys(_sum)) { result._sum[key] = records.reduce((sum, r) => sum + Number(r[key] || 0), 0); } }
        return result;
      }),
    };
  }

  function seedData() {
    const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
    const users = [
      { id: '00000000-0000-0000-0000-000000000010', firebaseUid: 'fb-head', phone: '+910000000010', name: 'Project Head', role: 'PROJECT_HEAD', projectId: PROJECT_ID, isActive: true },
      { id: '00000000-0000-0000-0000-000000000011', firebaseUid: 'fb-hoc', phone: '+910000000011', name: 'Head of Construction', role: 'HEAD_OF_CONSTRUCTION', projectId: PROJECT_ID, isActive: true },
      { id: '00000000-0000-0000-0000-000000000012', firebaseUid: 'fb-acc', phone: '+910000000012', name: 'Accountant', role: 'ACCOUNTANT', projectId: PROJECT_ID, isActive: true },
      { id: '00000000-0000-0000-0000-000000000013', firebaseUid: 'fb-admin', phone: '+910000000013', name: 'Admin', role: 'ADMIN', projectId: PROJECT_ID, isActive: true },
    ];
    for (const u of users) tables.user.set(u.id, { ...u });
    tables.project.set(PROJECT_ID, { id: PROJECT_ID, name: 'Test Hospital', status: 'ACTIVE', totalBudget: 10000000, officeAddress: 'Office 1', hospitalAddress: 'Hospital 1' });
  }

  return { tables, createModelMock, seedData };
});

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
    inventoryTransaction: createModelMock('inventoryTransaction'),
    issue: createModelMock('issue'),
    phase: createModelMock('phase'),
    gatePass: createModelMock('gatePass'),
    gatePassItem: createModelMock('gatePassItem'),
    goodsReceipt: createModelMock('goodsReceipt'),
    goodsReceiptItem: createModelMock('goodsReceiptItem'),
    inspection: createModelMock('inspection'),
  },
}));

vi.mock('../src/config/firebase', () => ({ verifyFirebaseToken: vi.fn() }));
vi.mock('../src/socket', () => ({ initSocketServer: vi.fn() }));
vi.mock('../src/services/storage.service', () => ({
  getStorageService: () => ({
    upload: vi.fn(async (buffer: Buffer, fileName: string) => ({ filePath: `/uploads/${fileName}`, fileName })),
    delete: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => {}),
  }),
}));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../src/services/push.service', () => ({
  notifyAllHeads: vi.fn(async () => {}),
  notifyUser: vi.fn(async () => {}),
  notifyApprovers: vi.fn(async () => {}),
}));

seedData();

import supertest from 'supertest';
import app from '../src/app';
import { initiate, approve, reject } from '../src/services/approval.service';
import { prisma } from '../src/config/prisma';

const request = supertest(app);

const USER_PROJECT_HEAD = '00000000-0000-0000-0000-000000000010';
const USER_HOC = '00000000-0000-0000-0000-000000000011';
const USER_ACCOUNTANT = '00000000-0000-0000-0000-000000000012';
const USER_ADMIN = '00000000-0000-0000-0000-000000000013';
const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

function authAs(userId: string) {
  return { Authorization: `Bearer dev-token:${userId}` };
}

function uuid(seed: string): string {
  // Generate a deterministic UUID from a seed string
  const hex = Buffer.from(seed.padEnd(16, '0').slice(0, 16)).toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-0000-000000000000`;
}

// ─── Issue 1: Self-approval blocked ─────────────────────────
describe('Issue 1: Self-approval blocked (segregation of duties)', () => {
  beforeAll(async () => {
    // Create a vendor for quotation tests
    await prisma.vendor.create({ data: { id: uuid('vendor1'), name: 'V1', vendorCode: 'V001', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
  });

  it('creator approving their own record throws error', async () => {
    const vendorId = uuid('vendor1');
    const quotation = await prisma.quotation.create({
      data: {
        id: uuid('q-self'), quotationNumber: 'Q-SELF', vendorId, projectId: PROJECT_ID,
        date: new Date(), status: QuotationStatus.SUBMITTED, totalAmount: 5000, gstAmount: 0,
        grandTotal: 5000, createdBy: USER_PROJECT_HEAD,
      },
    });

    const wf = await initiate({ entityType: 'QUOTATION', entityId: quotation.id, projectId: PROJECT_ID, approvalPolicy: 'HEAD_GROUPS' });
    const step1 = wf.steps[0]; // PROJECT_HEAD step

    await expect(approve(step1.id, USER_PROJECT_HEAD, 'self approve')).rejects.toThrow('You cannot approve a record you created');
  });

  it('creator rejecting their own record throws error', async () => {
    const vendorId = uuid('vendor1');
    const quotation = await prisma.quotation.create({
      data: {
        id: uuid('q-self-rej'), quotationNumber: 'Q-REJ', vendorId, projectId: PROJECT_ID,
        date: new Date(), status: QuotationStatus.SUBMITTED, totalAmount: 5000, gstAmount: 0,
        grandTotal: 5000, createdBy: USER_PROJECT_HEAD,
      },
    });

    const wf = await initiate({ entityType: 'QUOTATION', entityId: quotation.id, projectId: PROJECT_ID, approvalPolicy: 'HEAD_GROUPS' });
    const step1 = wf.steps[0];

    await expect(reject(step1.id, USER_PROJECT_HEAD, 'self reject')).rejects.toThrow('You cannot reject a record you created');
  });

  it('non-creator can approve normally', async () => {
    const vendorId = uuid('vendor1');
    const quotation = await prisma.quotation.create({
      data: {
        id: uuid('q-ok'), quotationNumber: 'Q-OK', vendorId, projectId: PROJECT_ID,
        date: new Date(), status: QuotationStatus.SUBMITTED, totalAmount: 5000, gstAmount: 0,
        grandTotal: 5000, createdBy: USER_ACCOUNTANT,
      },
    });

    const wf = await initiate({ entityType: 'QUOTATION', entityId: quotation.id, projectId: PROJECT_ID, approvalPolicy: 'HEAD_GROUPS' });
    const step1 = wf.steps[0]; // PROJECT_HEAD step

    const result = await approve(step1.id, USER_PROJECT_HEAD, 'ok');
    expect(result.isFullyApproved).toBe(false);
  });
});

// ─── Issue 2: Invoice creation validates PO status ──────────
describe('Issue 2: Invoice creation validates PO status', () => {
  beforeAll(async () => {
    const vid = uuid('vendor2');
    await prisma.vendor.create({ data: { id: vid, name: 'V2', vendorCode: 'V002', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-pending'), poNumber: 'PO-P', vendorId: vid, projectId: PROJECT_ID, status: POStatus.PENDING_APPROVAL, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-approved'), poNumber: 'PO-A', vendorId: vid, projectId: PROJECT_ID, status: POStatus.APPROVED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-delivered'), poNumber: 'PO-D', vendorId: vid, projectId: PROJECT_ID, status: POStatus.DELIVERED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
  });

  it('rejects invoice for PENDING_APPROVAL PO', async () => {
    const res = await request.post('/api/invoices').set(authAs(USER_ACCOUNTANT)).send({
      vendorId: uuid('vendor2'), poId: uuid('po-pending'), amount: 5000, taxAmount: 0, totalAmount: 5000, acknowledged: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('approved');
  });

  it('accepts invoice for APPROVED PO', async () => {
    const res = await request.post('/api/invoices').set(authAs(USER_ACCOUNTANT)).send({
      vendorId: uuid('vendor2'), poId: uuid('po-approved'), amount: 5000, taxAmount: 0, totalAmount: 5000, acknowledged: true,
    });
    expect(res.status).toBe(201);
  });

  it('accepts invoice for DELIVERED PO', async () => {
    const res = await request.post('/api/invoices').set(authAs(USER_ACCOUNTANT)).send({
      vendorId: uuid('vendor2'), poId: uuid('po-delivered'), amount: 5000, taxAmount: 0, totalAmount: 5000, acknowledged: true,
    });
    expect(res.status).toBe(201);
  });
});

// ─── Issue 4: Vendor deletion validation ────────────────────
describe('Issue 4: Vendor deletion validation', () => {
  it('blocks deletion when vendor has invoices', async () => {
    const vid = uuid('v-del-inv');
    await prisma.vendor.create({ data: { id: vid, name: 'VDelInv', vendorCode: 'VDI', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
    await prisma.vendorInvoice.create({ data: { id: uuid('inv-vdi'), invoiceCode: 'INV-VDI', invoiceNumber: 'INV-VDI', vendorId: vid, projectId: PROJECT_ID, amount: 1000, taxAmount: 0, totalAmount: 1000, createdBy: USER_ACCOUNTANT, verificationStatus: 'PENDING', paymentStatus: 'PENDING', stockStatus: 'PENDING' } });

    const res = await request.delete(`/api/vendors/${vid}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('invoice');
  });

  it('blocks deletion when vendor has POs', async () => {
    const vid = uuid('v-del-po');
    await prisma.vendor.create({ data: { id: vid, name: 'VDelPO', vendorCode: 'VDP', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-vdp'), poNumber: 'PO-VDP', vendorId: vid, projectId: PROJECT_ID, status: POStatus.PENDING_APPROVAL, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });

    const res = await request.delete(`/api/vendors/${vid}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('purchase order');
  });

  it('allows deletion when vendor has no financial records', async () => {
    const vid = uuid('v-del-ok');
    await prisma.vendor.create({ data: { id: vid, name: 'VDelOK', vendorCode: 'VDK', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });

    const res = await request.delete(`/api/vendors/${vid}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(200);
  });
});

// ─── Issue 5: PO deletion blocks PARTIALLY_DELIVERED ────────
describe('Issue 5: PO deletion blocks PARTIALLY_DELIVERED', () => {
  beforeAll(async () => {
    const vid = uuid('vendor5');
    await prisma.vendor.create({ data: { id: vid, name: 'V5', vendorCode: 'V005', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-pd'), poNumber: 'PO-PD', vendorId: vid, projectId: PROJECT_ID, status: POStatus.PARTIALLY_DELIVERED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-app5'), poNumber: 'PO-APP5', vendorId: vid, projectId: PROJECT_ID, status: POStatus.APPROVED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.purchaseOrder.create({ data: { id: uuid('po-pending5'), poNumber: 'PO-PEND5', vendorId: vid, projectId: PROJECT_ID, status: POStatus.PENDING_APPROVAL, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
  });

  it('blocks deletion of PARTIALLY_DELIVERED PO', async () => {
    const res = await request.delete(`/api/purchase-orders/${uuid('po-pd')}`).set(authAs(USER_ACCOUNTANT));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('partially delivered');
  });

  it('blocks deletion of APPROVED PO', async () => {
    const res = await request.delete(`/api/purchase-orders/${uuid('po-app5')}`).set(authAs(USER_ACCOUNTANT));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('approved');
  });

  it('allows deletion of PENDING_APPROVAL PO', async () => {
    const res = await request.delete(`/api/purchase-orders/${uuid('po-pending5')}`).set(authAs(USER_ACCOUNTANT));
    expect(res.status).toBe(200);
  });
});

// ─── Issue 6: Quotation deletion blocks APPROVED ────────────
describe('Issue 6: Quotation deletion blocks APPROVED', () => {
  beforeAll(async () => {
    const vid = uuid('vendor6');
    await prisma.vendor.create({ data: { id: vid, name: 'V6', vendorCode: 'V006', projectId: PROJECT_ID, category: 'CONSTRUCTION', createdBy: USER_ACCOUNTANT } });
    await prisma.quotation.create({ data: { id: uuid('q-app6'), quotationNumber: 'Q-APP6', vendorId: vid, projectId: PROJECT_ID, date: new Date(), status: QuotationStatus.APPROVED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.quotation.create({ data: { id: uuid('q-conv6'), quotationNumber: 'Q-CONV6', vendorId: vid, projectId: PROJECT_ID, date: new Date(), status: QuotationStatus.CONVERTED_TO_PO, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
    await prisma.quotation.create({ data: { id: uuid('q-rej6'), quotationNumber: 'Q-REJ6', vendorId: vid, projectId: PROJECT_ID, date: new Date(), status: QuotationStatus.REJECTED, totalAmount: 5000, gstAmount: 0, grandTotal: 5000, createdBy: USER_ACCOUNTANT } });
  });

  it('blocks deletion of APPROVED quotation', async () => {
    const res = await request.delete(`/api/quotations/${uuid('q-app6')}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('approved');
  });

  it('blocks deletion of CONVERTED_TO_PO quotation', async () => {
    const res = await request.delete(`/api/quotations/${uuid('q-conv6')}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('converted');
  });

  it('allows deletion of REJECTED quotation', async () => {
    const res = await request.delete(`/api/quotations/${uuid('q-rej6')}`).set(authAs(USER_PROJECT_HEAD));
    expect(res.status).toBe(200);
  });
});
