import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The guarded transaction is replaced by a fake client that records what the query builder asked for.
const calls: { model: string; op: string; args: any }[] = [];
const fakeTx = new Proxy(
  {},
  {
    get: (_t, model: string) => ({
      findMany: async (args: any) => {
        calls.push({ model, op: 'findMany', args });
        return model === 'vendor' ? [{ id: 'v1', name: 'ABC Traders' }] : [{ id: 'r1', poNumber: 'VGH-PO001', grandTotal: 100 }];
      },
      count: async (args: any) => (calls.push({ model, op: 'count', args }), 1),
      aggregate: async (args: any) => (calls.push({ model, op: 'aggregate', args }), { _count: 2, _sum: { grandTotal: 300 } }),
      groupBy: async (args: any) => (calls.push({ model, op: 'groupBy', args }), [{ vendorId: 'v1', _count: { _all: 2 }, _sum: { grandTotal: 300 } }]),
    }),
  },
);

vi.mock('../src/services/data-query/dbGuard', async () => {
  const grants = await import('../src/services/data-query/grants.generated');
  return {
    READER_ROLE: 'miko_reader',
    readerRoleAvailable: async () => true,
    guardedColumns: (m: string) => grants.GUARDED_COLUMNS[m] ?? null,
    runGuarded: async (_projectId: string, fn: (tx: unknown, g: { role: boolean }) => Promise<unknown>) => ({
      result: await fn(fakeTx, { role: true }),
      role: true,
    }),
  };
});

import { Prisma } from '@prisma/client';
import { DATA_EXCLUDED, buildCatalog, getCatalog, isSensitiveColumn } from '../src/services/data-query/catalog';
import { GUARDED_COLUMNS, GUARD_MIGRATION } from '../src/services/data-query/grants.generated';
import { QueryError, describeData, periodRange, runDataQuery, type QueryCaller } from '../src/services/data-query/query';

const admin: QueryCaller = { role: 'ADMIN', extraPermissions: [], projectId: 'p1', subject: { role: 'ADMIN' } };
const head: QueryCaller = { role: 'PROJECT_HEAD', extraPermissions: [], projectId: 'p1', subject: { role: 'PROJECT_HEAD' } };
const supervisor: QueryCaller = { role: 'SITE_SUPERVISOR', extraPermissions: [], projectId: 'p1', subject: { role: 'SITE_SUPERVISOR' } };

beforeEach(() => {
  calls.length = 0;
});

describe('data catalog (what Miko may read)', () => {
  const catalog = buildCatalog();

  it('never includes excluded tables', () => {
    for (const name of Object.keys(DATA_EXCLUDED)) expect(catalog.has(name)).toBe(false);
  });

  it('never exposes projectId or a secret-looking column', () => {
    for (const entry of catalog.values()) {
      expect(entry.fields.has('projectId')).toBe(false);
      for (const col of entry.fields.keys()) expect(isSensitiveColumn(col)).toBe(false);
    }
    expect(isSensitiveColumn('pinHash')).toBe(true);
    expect(isSensitiveColumn('documentPinHash')).toBe(true);
  });

  it('exposes only id, name and role of people', () => {
    expect([...catalog.get('User')!.fields.keys()].sort()).toEqual(['id', 'name', 'role']);
  });

  it('reads child tables only through their project table', () => {
    const items = catalog.get('POItem')!;
    expect(items.scope).toBe('child');
    expect(items.path.map((p) => p.target)).toEqual(['PurchaseOrder']);
  });

  it('every schema table is either readable or excluded on purpose', () => {
    const unclassified = Prisma.dmmf.datamodel.models
      .map((m) => m.name)
      .filter((n) => !catalog.has(n) && !(n in DATA_EXCLUDED));
    expect(unclassified).toEqual([]);
  });
});

describe('database grants stay in step with the schema', () => {
  it('the generated grant list covers every readable table and column (rerun scripts/generate-miko-guard.ts if this fails)', () => {
    for (const entry of getCatalog().values()) {
      expect(GUARDED_COLUMNS[entry.model], entry.model).toBeDefined();
      expect([...GUARDED_COLUMNS[entry.model]].sort(), entry.model).toEqual([...entry.fields.keys()].sort());
    }
  });

  it('the migration grants nothing on excluded tables and only id/name/role of users', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'migrations', GUARD_MIGRATION, 'migration.sql'), 'utf8');
    for (const name of Object.keys(DATA_EXCLUDED)) {
      const table = Prisma.dmmf.datamodel.models.find((m) => m.name === name)?.dbName ?? name;
      expect(sql).not.toContain(`ON "${table}" TO miko_reader`);
    }
    expect(sql).toContain('GRANT SELECT ("id", "name", "role") ON "users" TO miko_reader');
    expect(sql).not.toMatch(/pinHash|documentPinHash/);
    // Every statement is guarded so a deploy can never fail on it.
    expect(sql.match(/DO \$\$/g)!.length).toBe(sql.match(/EXCEPTION WHEN OTHERS/g)!.length);
  });
});

describe('runDataQuery guard rails', () => {
  it('always pins the caller\'s project and hides deleted rows', async () => {
    await runDataQuery(head, { model: 'PurchaseOrder', filters: [{ field: 'status', op: 'eq', value: 'APPROVED' }] });
    const find = calls.find((c) => c.op === 'findMany')!;
    expect(find.model).toBe('purchaseOrder');
    expect(find.args.where.AND).toEqual(expect.arrayContaining([{ projectId: 'p1' }, { deletedAt: null }, { status: expect.objectContaining({ equals: 'APPROVED' }) }]));
    expect(find.args.take).toBe(20);
  });

  it('pins child tables through the parent chain', async () => {
    await runDataQuery(head, { model: 'POItem', filters: [{ field: 'materialName', op: 'contains', value: 'cement' }] });
    const find = calls.find((c) => c.op === 'findMany')!;
    expect(find.args.where.AND[0]).toEqual({ purchaseOrder: { is: { projectId: 'p1' } } });
  });

  it('refuses projectId and secret columns, even through a relation', async () => {
    await expect(runDataQuery(admin, { model: 'PurchaseOrder', filters: [{ field: 'projectId', op: 'eq', value: 'p2' }] })).rejects.toThrow(QueryError);
    await expect(runDataQuery(admin, { model: 'PurchaseOrder', fields: ['createdByUser.pinHash'] })).rejects.toThrow(QueryError);
    await expect(runDataQuery(admin, { model: 'Document' })).rejects.toThrow(QueryError);
    await expect(runDataQuery(admin, { model: 'User' })).rejects.toThrow(QueryError);
  });

  it('follows role permissions: a site supervisor cannot read bank accounts', async () => {
    await expect(runDataQuery(supervisor, { model: 'BankAccount' })).rejects.toThrow(/no access/);
    await expect(runDataQuery(supervisor, { model: 'PurchaseOrder', fields: ['budgetHead.particulars'] })).rejects.toThrow(QueryError);
  });

  it('tables with no registry entry are for admins only', async () => {
    await expect(runDataQuery(head, { model: 'Comment' })).rejects.toThrow(/no access/);
    await expect(runDataQuery(admin, { model: 'Comment' })).resolves.toBeTruthy();
  });

  it('a module switched off for the user hides its tables', async () => {
    const off: QueryCaller = { ...head, subject: { role: 'PROJECT_HEAD', moduleAccess: { purchaseOrders: false } } };
    const tables = (await describeData(off)).map((t) => t.model);
    expect(tables).not.toContain('PurchaseOrder');
    expect(tables).not.toContain('POItem');
    expect(tables).toContain('Vendor');
    await expect(runDataQuery(off, { model: 'PurchaseOrder' })).rejects.toThrow(/no access/);
  });

  it('caps rows and names groups by their related record', async () => {
    await expect(runDataQuery(head, { model: 'PurchaseOrder', limit: 500 })).rejects.toThrow(/Invalid query/);
    const out = await runDataQuery(head, { model: 'PurchaseOrder', groupBy: ['vendorId'], aggregate: { sum: ['grandTotal'] } });
    expect(out.groups?.[0]).toMatchObject({ vendorId: 'v1', vendorIdLabel: 'ABC Traders', _sum: { grandTotal: 300 } });
    const group = calls.find((c) => c.op === 'groupBy')!;
    expect(group.args.where.AND[0]).toEqual({ projectId: 'p1' });
    // The label lookup is by id only.
    expect(calls.find((c) => c.model === 'vendor')!.args.where).toEqual({ id: { in: ['v1'] } });
  });

  it('sums only number columns', async () => {
    await expect(runDataQuery(head, { model: 'PurchaseOrder', aggregate: { sum: ['poNumber'] } })).rejects.toThrow(/number column/);
    const out = await runDataQuery(head, { model: 'PurchaseOrder', aggregate: { sum: ['grandTotal'] }, period: { field: 'createdAt', range: 'this_month' } });
    expect(out.aggregate).toEqual({ _count: 2, _sum: { grandTotal: 300 } });
    // Prisma refuses empty / undefined total kinds, so only the asked ones are sent.
    const agg = calls.find((c) => c.op === 'aggregate')!;
    expect(Object.keys(agg.args).sort()).toEqual(['_count', '_sum', 'where']);
  });
});

describe('periods follow the Indian calendar', () => {
  it('this_month starts at midnight IST on the 1st', () => {
    const r = periodRange('this_month', new Date('2026-10-23T10:00:00Z'));
    expect(r.gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.lt.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('today rolls over at IST midnight, not UTC', () => {
    const r = periodRange('today', new Date('2026-10-22T20:00:00Z')); // 01:30 IST on the 23rd
    expect(r.gte.toISOString()).toBe('2026-10-22T18:30:00.000Z');
  });
});
