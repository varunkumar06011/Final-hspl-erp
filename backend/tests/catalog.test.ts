import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({ prisma: {} }));

import {
  CatalogItemKind,
  PREDEFINED_ITEMS,
  catalogNameKey,
  catalogSpecKey,
  comparePrice,
  findLine,
  findPredefinedItem,
  lineKey,
  lineLabel,
} from '@hospital-erp/shared';
import { evaluatePrice, resolveCatalogLines, toCatalogCode, type PriceEntry } from '../src/services/catalog.service';
import { evaluateReceiptChecklist, type ReceiptFacts } from '../src/services/inventory-checklist.service';

// ── A tiny in-memory stand-in for the two catalog tables (loosely typed on purpose) ──
/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeDb() {
  let n = 0;
  const items: any[] = [];
  const specs: any[] = [];
  const withSpecs = (i: any) => (i ? { ...i, specs: specs.filter((s) => s.itemId === i.id) } : null);
  const db = {
    catalogItem: {
      findUnique: async ({ where }: any) => {
        if (where.id) return withSpecs(items.find((i) => i.id === where.id));
        if (where.code) return items.find((i) => i.code === where.code) ?? null;
        const k = where.kind_nameKey;
        return withSpecs(items.find((i) => i.kind === k.kind && i.nameKey === k.nameKey));
      },
      findMany: async ({ where }: any) => {
        if (where.code?.startsWith) return items.filter((i) => i.code.startsWith(where.code.startsWith));
        const key = where.OR[0].nameKey;
        return items.filter((i) => i.isActive && (i.nameKey === key || i.aliases.includes(key))).map(withSpecs);
      },
      create: async ({ data }: any) => {
        const item = { id: `i${++n}`, isActive: true, mergedIntoId: null, createdAt: new Date(n), ...data, specs: undefined };
        delete item.specs;
        items.push(item);
        for (const s of data.specs?.create ?? []) specs.push({ id: `s${++n}`, itemId: item.id, ...s });
        return withSpecs(item);
      },
      update: async ({ where, data }: any) => {
        const item = items.find((i) => i.id === where.id);
        if (data.aliases?.push) item.aliases.push(data.aliases.push);
        else Object.assign(item, data);
        return withSpecs(item);
      },
    },
    catalogItemSpec: {
      create: async ({ data }: any) => {
        const s = { id: `s${++n}`, isPredefined: false, ...data };
        specs.push(s);
        return s;
      },
      findUnique: async ({ where }: any) => specs.find((s) => s.itemId === where.itemId_valueKey.itemId && s.valueKey === where.itemId_valueKey.valueKey) ?? null,
    },
  };
  return { db: db as any, items, specs };
}

describe('catalog keys', () => {
  it('treats spelling of spaces, case and punctuation as the same name / spec', () => {
    expect(catalogNameKey('  TMT  Bars.')).toBe('tmt bars');
    expect(catalogSpecKey('12 mm TMT')).toBe(catalogSpecKey('12MM-tmt'));
    expect(catalogSpecKey('Non - ISI')).toBe(catalogSpecKey('Non-ISI'));
  });

  it('keeps the same item in two specs apart down the chain', () => {
    expect(lineKey({ materialName: 'Steel', specification: '8mm TMT Bar' })).not.toBe(lineKey({ materialName: 'Steel', specification: '12mm TMT Bar' }));
    expect(lineKey({ materialName: 'steel ', specification: '12 mm tmt bar' })).toBe(lineKey({ materialName: 'Steel', specification: '12mm TMT Bar' }));
    expect(lineLabel({ materialName: 'Steel', specification: '12mm TMT Bar' })).toBe('Steel - 12mm TMT Bar');
    expect(lineLabel({ materialName: 'Cement', specification: null })).toBe('Cement');
  });

  it('finds the PO line a receipt line names: by id, then item + spec, then the only line of that name', () => {
    const po = [
      { id: 'a', materialName: 'Steel', specification: '8mm TMT Bar' },
      { id: 'b', materialName: 'Steel', specification: '12mm TMT Bar' },
      { id: 'c', materialName: 'Cement', specification: null },
    ];
    expect(findLine(po, { poItemId: 'b', materialName: 'whatever' })?.id).toBe('b');
    expect(findLine(po, { materialName: 'Steel', specification: '12 mm tmt bar' })?.id).toBe('b');
    expect(findLine(po, { materialName: 'cement' })?.id).toBe('c');
    expect(findLine(po, { materialName: 'Steel', specification: '16mm TMT Bar' })).toBeUndefined();
  });

  it('turns old per-project codes into catalog codes', () => {
    expect(toCatalogCode('VGH-MAT-0021')).toBe('MAT-0021');
    expect(toCatalogCode('SRV-7')).toBe('SRV-0007');
    expect(toCatalogCode('ABC123')).toBeNull();
  });
});

describe('predefined specifications', () => {
  it('gives steel and iron their own, separate spec lists', () => {
    const steel = findPredefinedItem('TMT bars')!;
    const iron = findPredefinedItem('mild steel')!;
    expect(steel.name).toBe('Steel');
    expect(iron.name).toBe('Iron');
    expect(steel.specs).toContain('12mm TMT Bar');
    expect(steel.specs.some((s) => iron.specs.includes(s))).toBe(false);
  });

  it('has no alias claimed by two items', () => {
    const seen = new Map<string, string>();
    for (const p of PREDEFINED_ITEMS) {
      for (const k of [p.name, ...(p.aliases ?? [])].map(catalogNameKey)) {
        expect(seen.get(k), `${k} in ${p.name} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, p.name);
      }
    }
  });
});

describe('resolveCatalogLines', () => {
  it('reuses the existing item for the same name, whatever the spelling', async () => {
    const { db, items } = fakeDb();
    const [a] = await resolveCatalogLines([{ materialName: 'Green Mat' }], { db });
    const [b] = await resolveCatalogLines([{ materialName: 'green  mat' }], { db });
    expect(a.itemId).toBe(b.itemId);
    expect(b.materialName).toBe('Green Mat');
    expect(a.materialCode).toBe('MAT-0001');
    expect(items).toHaveLength(1);
  });

  it('makes a predefined alias the predefined item, with its starting specs', async () => {
    const { db, items } = fakeDb();
    const [line] = await resolveCatalogLines([{ materialName: 'tmt bars', specification: '12 MM tmt bar' }], { db });
    expect(line.materialName).toBe('Steel');
    expect(line.specification).toBe('12mm TMT Bar'); // matched the predefined spelling
    expect(items[0].aliases).toContain('tmt bars');
    const [again] = await resolveCatalogLines([{ materialName: 'TMT Bars' }], { db });
    expect(again.itemId).toBe(line.itemId);
  });

  it('adds a new spec to that item only', async () => {
    const { db, specs } = fakeDb();
    const [steel] = await resolveCatalogLines([{ materialName: 'Steel', specification: '36mm TMT Bar' }], { db });
    const [iron] = await resolveCatalogLines([{ materialName: 'Iron', specification: 'MS Angle 50x50x6' }], { db });
    expect(steel.specification).toBe('36mm TMT Bar');
    expect(specs.filter((s) => s.itemId === iron.itemId).some((s) => s.value === '36mm TMT Bar')).toBe(false);
  });

  it('gives services their own code series and keeps a free old code number', async () => {
    const { db } = fakeDb();
    const [svc] = await resolveCatalogLines([{ materialName: 'Weigh bridge charges' }], { db, kind: CatalogItemKind.SERVICE });
    const [mat] = await resolveCatalogLines([{ materialName: 'Drums', materialCode: 'VGH-MAT-0021' }], { db });
    expect(svc.materialCode).toBe('SRV-0001');
    expect(mat.materialCode).toBe('MAT-0021');
  });

  it('follows a merged item to the one still in use', async () => {
    const { db, items } = fakeDb();
    const [a] = await resolveCatalogLines([{ materialName: 'PVC Pipe' }], { db });
    const [b] = await resolveCatalogLines([{ materialName: '160/6 ISI' }], { db });
    Object.assign(items.find((i) => i.id === b.itemId), { isActive: false, mergedIntoId: a.itemId });
    const [line] = await resolveCatalogLines([{ materialName: '160/6 ISI', itemId: b.itemId }], { db });
    expect(line.itemId).toBe(a.itemId);
  });
});

describe('price check', () => {
  const entry = (p: Partial<PriceEntry>): PriceEntry => ({
    source: 'PO', rate: 0, unit: 'ton', date: '2026-01-01T00:00:00.000Z', vendorName: 'A', docId: 'd', docNumber: 'VGH-PO001', projectCode: 'VGH', ...p,
  });

  it('flags a rate above the last price paid', () => {
    expect(comparePrice(1200, 1100)).toEqual({ difference: 100, percent: 9.1, direction: 'UP' });
    expect(comparePrice(1100, 1100).direction).toBe('SAME');
  });

  it('compares with the last PO price, like units first, and names the cheapest vendor', () => {
    const history = [
      entry({ source: 'QUOTATION', rate: 1150, vendorName: 'B', date: '2026-03-01T00:00:00.000Z' }),
      entry({ rate: 1100, vendorName: 'A', date: '2026-02-01T00:00:00.000Z' }),
      entry({ rate: 55, unit: 'kg', vendorName: 'C', date: '2026-04-01T00:00:00.000Z' }),
      entry({ source: 'REQUEST', rate: 1000, vendorName: null, date: '2026-05-01T00:00:00.000Z' }),
    ];
    const r = evaluatePrice(history, 1200, 'tons');
    expect(r.last?.rate).toBe(1100);
    expect(r.comparison).toMatchObject({ difference: 100, direction: 'UP' });
    expect(r.vendors.map((v) => v.vendorName)).toEqual(['A', 'B']);
    expect(r.bestVendor).toBe('A');
  });

  it('falls back to a quote, then an earlier estimate, when nothing was bought yet', () => {
    expect(evaluatePrice([entry({ source: 'REQUEST', rate: 900 })], 1000).last?.source).toBe('REQUEST');
    expect(evaluatePrice([], 1000)).toMatchObject({ last: null, comparison: null, bestVendor: null });
  });
});

describe('final checklist before inventory', () => {
  const vendorChain = (): ReceiptFacts => ({
    status: 'READY_TO_POST',
    inspectedAt: new Date(),
    items: [{ itemId: 'i1', poItemId: 'p1' }],
    gatePass: { passNumber: 'VGH-GP001', status: 'APPROVED', photoProofPath: 'gp.jpg', deletedAt: null },
    po: {
      poNumber: 'VGH-PO001',
      status: 'APPROVED',
      vendorType: 'VENDOR',
      isSiteBillBatch: false,
      contract: null,
      quotation: { quotationNumber: 'VGH-Q001', status: 'APPROVED', deletedAt: null, mprId: 'm1' },
      mprId: 'm1',
      mpr: { mprNumber: 'VGH-MPR001', status: 'APPROVED', deletedAt: null },
      siteBills: [],
    },
  });
  const state = (facts: ReceiptFacts) => Object.fromEntries(evaluateReceiptChecklist(facts).items.map((i) => [i.key, i.state]));

  it('passes a complete vendor chain', () => {
    const r = evaluateReceiptChecklist(vendorChain());
    expect(r.complete).toBe(true);
    expect(r.items.map((i) => i.key)).toEqual(['request', 'quotation', 'vendorPath', 'po', 'gatePass', 'proof', 'inspection', 'items']);
  });

  it('stops a vendor PO raised without a finalized quotation', () => {
    const f = vendorChain();
    f.po.quotation = null;
    expect(state(f)).toMatchObject({ quotation: 'MISSING', vendorPath: 'MISSING' });
    expect(evaluateReceiptChecklist(f).complete).toBe(false);
  });

  it('does not need a quotation for a non-vendor PO raised from its request', () => {
    const f = vendorChain();
    f.po.vendorType = 'NON_VENDOR';
    f.po.quotation = null;
    expect(state(f)).toMatchObject({ quotation: 'NOT_NEEDED', vendorPath: 'OK' });
    expect(evaluateReceiptChecklist(f).complete).toBe(true);
  });

  it('needs the gate pass and its photo, the inspection and catalog-linked lines', () => {
    const noPhoto = vendorChain();
    noPhoto.gatePass!.photoProofPath = null;
    expect(state(noPhoto).proof).toBe('MISSING');
    const noPass = vendorChain();
    noPass.gatePass = null;
    expect(state(noPass)).toMatchObject({ gatePass: 'MISSING', proof: 'MISSING' });
    const uninspected = vendorChain();
    uninspected.status = 'PENDING_INSPECTION';
    expect(state(uninspected).inspection).toBe('MISSING');
    const unlinked = vendorChain();
    unlinked.items = [{ itemId: null, poItemId: 'p1' }];
    expect(state(unlinked).items).toBe('MISSING');
  });

  it('needs the request approved, and every site bill of a site-bill PO', () => {
    const draft = vendorChain();
    draft.po.mpr!.status = 'SUBMITTED';
    expect(state(draft).request).toBe('MISSING');
    const bills = vendorChain();
    Object.assign(bills.po, { vendorType: 'NON_VENDOR', isSiteBillBatch: true, quotation: null, mprId: null, mpr: null });
    bills.po.siteBills = [{ mprNumber: 'VGH-MPR010', status: 'APPROVED', deletedAt: null }];
    expect(evaluateReceiptChecklist(bills).complete).toBe(true);
  });

  it('checks the contract instead of a request and quotation for a contract bill', () => {
    const f = vendorChain();
    Object.assign(f.po, { contract: { poNumber: 'VGH-PO009', status: 'APPROVED' }, quotation: null, mpr: null, mprId: null });
    expect(state(f)).toMatchObject({ request: 'OK', quotation: 'NOT_NEEDED', vendorPath: 'NOT_NEEDED' });
  });
});
