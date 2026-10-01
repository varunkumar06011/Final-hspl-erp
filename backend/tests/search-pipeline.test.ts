/**
 * End-to-end check of the search pipeline against the REAL Prisma schema
 * metadata, with the database replaced by an in-memory fake (no Postgres,
 * nothing written anywhere): schema plan → queries → documents → index →
 * permissions → incremental refresh.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let writeHook: ((params: any, next: (p: any) => Promise<any>) => Promise<any>) | null = null;
const queries: { model: string; where: unknown }[] = [];

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

/** Like Prisma, refuse columns/relations the model doesn't have. */
function fieldOf(model: string, key: string) {
  const field = models.get(model)?.fields.find((f) => f.name === key);
  if (!field) throw new Error(`Unknown field ${key} on model ${model}`);
  return field;
}

function matches(model: string, row: Row, where: Row = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const field = fieldOf(model, key);
    if (field.kind === 'object') {
      const parent = (tables[field.type] ?? []).find((r) => r.id === row[field.relationFromFields![0]]);
      if (!parent || !matches(field.type, parent, cond as Row)) return false;
    } else if (cond === null) {
      if (row[key] != null) return false;
    } else if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('in' in c && !c.in.includes(row[key])) return false;
      if ('gte' in c && !(row[key] != null && row[key] >= c.gte)) return false;
    } else if (row[key] !== cond) return false;
  }
  return true;
}

function project(model: string, row: Row, select?: Row): Row {
  if (!select) return row;
  const out: Row = {};
  for (const [key, sel] of Object.entries(select)) {
    const field = fieldOf(model, key);
    if (field.kind === 'object') {
      const parent = (tables[field.type] ?? []).find((r) => r.id === row[field.relationFromFields![0]]);
      out[key] = parent ? project(field.type, parent, (sel as Row).select) : null;
    } else out[key] = row[key];
  }
  return out;
}

function delegate(model: string) {
  return {
    findMany: async (args: Row = {}) => {
      queries.push({ model, where: args.where });
      for (const key of Object.keys(args.orderBy ?? {})) if (fieldOf(model, key).kind !== 'scalar') throw new Error(`bad orderBy ${key}`);
      for (const key of Object.keys(args.cursor ?? {})) fieldOf(model, key);
      let rows = (tables[model] ?? []).filter((r) => matches(model, r, args.where));
      if (args.orderBy?.id === 'asc') rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
      if (args.cursor) rows = rows.slice(rows.findIndex((r) => r.id === args.cursor.id) + (args.skip ?? 0));
      if (args.take) rows = rows.slice(0, args.take);
      return rows.map((r) => project(model, r, args.select));
    },
  };
}

vi.mock('../src/config/prisma', () => {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const byDelegate: Record<string, ReturnType<typeof delegate>> = {};
  const prisma = new Proxy(
    {
      $use: (fn: any) => {
        writeHook = fn;
      },
      project: { findMany: async () => [{ id: 'P1' }] },
      $transaction: async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)({}) : arg),
    } as Record<string, any>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        const model = [...models.keys()].find((m) => lower(m) === prop);
        if (!model) return undefined;
        return (byDelegate[prop] ??= delegate(model));
      },
    },
  );
  return { prisma };
});

import { searchProject, resetSearchIndexForTests, startSearchIndex, stopSearchIndex } from '../src/services/search/manager';
import { getPlans } from '../src/services/search/schemaGraph';
import { changedRows, liveRows, lightRowsById, loadGroup, pageRootIds, rootPlans } from '../src/services/search/indexer';
import { prisma } from '../src/config/prisma';

const OLD = new Date('2026-01-10T00:00:00Z');
const base = (extra: Row): Row => ({ projectId: 'P1', deletedAt: null, createdAt: OLD, updatedAt: OLD, ...extra });

function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.Vendor = [
    base({ id: 'v1', vendorCode: 'VGH-V001', name: 'ABC Traders', category: 'Civil', status: 'ACTIVE', address: 'Plot 4 Industrial Area' }),
    base({ id: 'v2', projectId: 'P2', vendorCode: 'XYZ-V001', name: 'ABC Traders', category: 'Civil', status: 'ACTIVE' }),
  ];
  tables.PurchaseOrder = [
    base({ id: 'po1', vendorId: 'v1', poNumber: 'VGH-PO017', status: 'APPROVED', grandTotal: 125000, date: new Date('2026-03-14T00:00:00Z'), notes: 'Deliver before monsoon' }),
    base({ id: 'po2', projectId: 'P2', vendorId: 'v2', poNumber: 'XYZ-PO001', status: 'APPROVED', grandTotal: 5000 }),
  ];
  tables.POItem = [
    { id: 'i1', poId: 'po1', materialName: 'Cement 53 Grade OPC', unit: 'bags', quantity: 100, unitPrice: 400, createdAt: OLD },
    { id: 'i2', poId: 'po2', materialName: 'Cement for other site', unit: 'bags', quantity: 5, unitPrice: 400, createdAt: OLD },
  ];
  tables.GoodsReceipt = [base({ id: 'g1', poId: 'po1', gatePassId: 'gp1', receiptNumber: 'VGH-GRN004', status: 'POSTED' })];
  tables.GoodsReceiptItem = [{ id: 'gi1', goodsReceiptId: 'g1', materialName: 'Cement 53 Grade OPC', unit: 'bags', itemType: 'MATERIAL', updatedAt: OLD }];
  tables.Comment = [base({ id: 'c1', entityType: 'PURCHASE_ORDER', entityId: 'po1', body: 'Please expedite the delivery', entityLabel: 'VGH-PO017', authorId: 'u1' })];
  tables.Attachment = [base({ id: 'a1', entityType: 'PURCHASE_ORDER', entityId: 'po1', fileName: 'delivery_challan.pdf', fileType: 'DOCUMENT', filePath: 'secret/path/x.pdf' })];
  tables.GatePass = [base({ id: 'gp1', poId: 'po1', passNumber: 'VGH-GP005', status: 'ENTERED', gatePassCategory: 'PO' })];
  tables.Phase = [base({ id: 'ph1', name: 'Foundation work', status: 'ACTIVE' })];
  tables.User = [{ id: 'u1', name: 'Should never be indexed', pinHash: 'zzz' }];
}

const search = (query: string, role = 'ADMIN') => searchProject({ projectId: 'P1', role, query });

beforeEach(() => {
  seed();
  queries.length = 0;
  resetSearchIndexForTests();
});

describe('search pipeline', () => {
  it('finds a PO from one of its materials and shows the line', async () => {
    const res = await search('cement');
    const po = res.results.find((r) => r.model === 'PurchaseOrder');
    expect(po).toMatchObject({ id: 'po1', title: 'VGH-PO017', typeLabel: 'Purchase Order', path: '/pos?id=po1' });
    expect(po!.matches[0]).toMatchObject({ label: 'PO Item', labelKey: 'POItem' });
    expect(po!.matches[0].text).toContain('Cement 53 Grade OPC');
    expect(po!.matches[0].extra).toContain('Quantity 100');
  });

  it('shows the receipts that carry the same material', async () => {
    const res = await search('cement');
    expect(res.results.map((r) => r.key)).toEqual(expect.arrayContaining(['PurchaseOrder:po1', 'GoodsReceipt:g1']));
  });

  it('is isolated per project', async () => {
    const res = await search('cement');
    expect(res.results.map((r) => r.id)).not.toContain('po2');
    // And no query ever read another project's rows without a project filter on the root.
    const rootReads = queries.filter((q) => q.model === 'PurchaseOrder');
    expect(rootReads.every((q) => (q.where as Row).projectId === 'P1')).toBe(true);
  });

  it('is typo tolerant and partial-word friendly', async () => {
    expect((await search('sement')).results[0].id).toBeDefined();
    expect((await search('monso')).results[0].id).toBe('po1');
    expect((await search('vgh po 17')).results[0].id).toBe('po1');
  });

  it('finds comments and attachments through the record they belong to', async () => {
    const byComment = await search('expedite');
    expect(byComment.results[0]).toMatchObject({ id: 'po1' });
    expect(byComment.results[0].matches[0].label).toBe('Comment');

    const byFile = await search('challan');
    expect(byFile.results[0]).toMatchObject({ id: 'po1' });
    expect(byFile.results[0].matches[0].label).toBe('Attachment');
  });

  it('finds a PO by its vendor and says why', async () => {
    const res = await search('abc traders');
    const po = res.results.find((r) => r.model === 'PurchaseOrder');
    expect(po?.via).toMatchObject({ model: 'Vendor', title: 'ABC Traders' });
    expect(res.results.find((r) => r.model === 'Vendor')?.id).toBe('v1');
  });

  it('matches amounts and dates', async () => {
    expect((await search('125000')).results[0].id).toBe('po1');
    expect((await search('14 mar 2026')).results[0].id).toBe('po1');
  });

  it('never indexes secrets, storage paths or users', async () => {
    expect((await search('secret')).results).toEqual([]);
    expect((await search('zzz')).results).toEqual([]);
    expect((await search('Should never')).results).toEqual([]);
    const reads = new Set(queries.map((q) => q.model));
    expect(reads.has('User')).toBe(false);
  });

  it('applies role permissions to results and to what they reveal', async () => {
    // SITE_SUPERVISOR has no VIEW_FINANCIALS: POs, vendors and receipts stay hidden.
    const res = await search('cement', 'SITE_SUPERVISOR');
    expect(res.results).toEqual([]);
    // A gate pass is visible to supervisors, but must not surface through the PO they cannot see.
    const admin = await search('cement');
    expect(admin.results.find((r) => r.model === 'GatePass')?.via).toMatchObject({ model: 'PurchaseOrder' });
    const own = await search('VGH-GP005', 'SITE_SUPERVISOR');
    expect(own.results[0]).toMatchObject({ model: 'GatePass', id: 'gp1' });
    expect(own.results[0].related).toEqual([]);
    // Admin-only fallback for models with no registry entry (Phase) …
    expect((await search('foundation', 'ADMIN')).results[0]).toMatchObject({ model: 'Phase', path: null });
    expect((await search('foundation', 'SITE_SUPERVISOR')).results).toEqual([]);
  });

  it('picks up edits to a line item made through this server immediately', async () => {
    startSearchIndex();
    await search('cement'); // build
    // Edit a child row that has no updatedAt column — only the write hook can see it.
    tables.POItem[0].materialName = 'Granite tiles';
    await writeHook!({ model: 'POItem', action: 'update', args: { where: { id: 'i1' } } }, async () => ({ id: 'i1' }));
    const res = await search('granite');
    expect(res.results[0]).toMatchObject({ id: 'po1' });
    expect((await search('cement')).results.map((r) => r.id)).not.toContain('po1');
    stopSearchIndex();
  });

  it('picks up new and deleted records', async () => {
    startSearchIndex();
    await search('cement');
    tables.PurchaseOrder.push(base({ id: 'po3', vendorId: 'v1', poNumber: 'VGH-PO018', status: 'DRAFT' }));
    tables.POItem.push({ id: 'i3', poId: 'po3', materialName: 'Plumbing pipes', unit: 'm', createdAt: new Date() });
    await writeHook!({ model: 'PurchaseOrder', action: 'create', args: {} }, async () => ({ id: 'po3' }));
    expect((await search('plumbing')).results[0]).toMatchObject({ id: 'po3', title: 'VGH-PO018' });

    tables.PurchaseOrder = tables.PurchaseOrder.filter((p) => p.id !== 'po3');
    await writeHook!({ model: 'PurchaseOrder', action: 'delete', args: { where: { id: 'po3' } } }, async () => ({ id: 'po3' }));
    expect((await search('plumbing')).results).toEqual([]);
    stopSearchIndex();
  });

  it('sees records created inside an interactive transaction (which bypass the per-query hook)', async () => {
    startSearchIndex();
    await search('cement');
    const now = new Date();
    await prisma.$transaction(async () => {
      tables.PurchaseOrder.push(base({ id: 'po4', vendorId: 'v1', poNumber: 'VGH-PO020', status: 'DRAFT', createdAt: now, updatedAt: now }));
      tables.POItem.push({ id: 'i4', poId: 'po4', materialName: 'Waterproofing membrane', unit: 'rolls', createdAt: now });
    });
    expect((await search('waterproofing')).results[0]).toMatchObject({ id: 'po4', title: 'VGH-PO020' });
    stopSearchIndex();
  });

  it('hides soft-deleted records', async () => {
    tables.PurchaseOrder[0].deletedAt = new Date();
    const res = await search('cement');
    expect(res.results.map((r) => r.id)).not.toContain('po1');
  });
});

describe('generated queries', () => {
  it('only reference columns and relations that exist on the model (every table, every query shape)', async () => {
    for (const plan of getPlans()) {
      await changedRows(plan, 'P1', new Date());
      await liveRows(plan, 'P1');
      await lightRowsById(plan, ['x']);
    }
    for (const plan of rootPlans()) {
      await pageRootIds(plan, 'P1');
      await pageRootIds(plan, 'P1', 'x');
      await loadGroup(plan, 'P1', ['x']);
    }
    // Give every root table a row so the child and polymorphic queries really run.
    for (const plan of rootPlans()) tables[plan.model] = [base({ id: `r-${plan.model}` })];
    for (const plan of rootPlans()) await loadGroup(plan, 'P1', [`r-${plan.model}`]);
  });

  it('keeps searching when one table cannot be read (schema drift)', async () => {
    const drift = new Prisma.PrismaClientKnownRequestError('The column `POItem.materialName` does not exist', {
      code: 'P2022',
      clientVersion: 'test',
    });
    const spy = vi.spyOn((prisma as unknown as Record<string, { findMany: () => Promise<unknown> }>).pOItem, 'findMany').mockRejectedValue(drift);
    const res = await search('abc traders');
    spy.mockRestore();
    const po = res.results.find((r) => r.id === 'po1');
    expect(po).toBeDefined(); // still found through its vendor
    expect(po!.matches).toEqual([]); // its line items just aren't searchable until the table is fixed
  });
});
