import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { buildPlans, unclassifiedModels, humanize } from '../src/services/search/schemaGraph';
import { EXCLUDED_MODELS, REGISTRY } from '../src/services/search/registry';

const plans = buildPlans();
const plan = (name: string) => plans.find((p) => p.model === name);

describe('search schema plan (derived from schema.prisma)', () => {
  it('classifies every model: indexed automatically or consciously excluded', () => {
    // If this fails you added a table. Either it should be searchable (give it text
    // columns and a projectId or a relation to a project-scoped table) or add it to
    // EXCLUDED_MODELS in services/search/registry.ts with a reason.
    expect(unclassifiedModels()).toEqual([]);
  });

  it('only registers and excludes models that exist', () => {
    const names = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    for (const model of [...Object.keys(REGISTRY), ...Object.keys(EXCLUDED_MODELS)]) {
      expect(names.has(model), model).toBe(true);
    }
  });

  it('folds line items into the record they belong to', () => {
    for (const [child, root] of [
      ['POItem', 'PurchaseOrder'],
      ['QuotationItem', 'Quotation'],
      ['GatePassItem', 'GatePass'],
      ['GoodsReceiptItem', 'GoodsReceipt'],
      ['MaterialPurchaseRequestItem', 'MaterialPurchaseRequest'],
      ['VendorMaterial', 'Vendor'],
    ]) {
      expect(plan(child), child).toMatchObject({ role: 'child', root });
      expect(plan(child)!.text.map((t) => t.name), child).toContain(child === 'VendorMaterial' ? 'name' : 'materialName');
    }
  });

  it('treats projectId tables as results and comments/attachments as folded content', () => {
    expect(plan('PurchaseOrder')).toMatchObject({ role: 'root', hasProjectId: true });
    expect(plan('Comment')?.role).toBe('poly');
    expect(plan('Attachment')?.role).toBe('poly');
  });

  it('indexes free text, identifiers, amounts and dates', () => {
    const po = plan('PurchaseOrder')!;
    expect(po.text.map((t) => t.name)).toEqual(expect.arrayContaining(['poNumber', 'notes', 'paymentTerms']));
    expect(po.numbers).toContain('grandTotal');
    expect(po.dates).toContain('date');
    expect(po.json).toContain('deductions');
    expect(po.text.find((t) => t.name === 'poNumber')!.weight).toBeGreaterThan(po.text.find((t) => t.name === 'notes')!.weight);
  });

  it('links records to what they point at, so a vendor name finds its POs', () => {
    expect(plan('PurchaseOrder')!.edges).toEqual(expect.arrayContaining([{ fk: 'vendorId', target: 'Vendor' }]));
    expect(plan('VendorInvoice')!.edges).toEqual(expect.arrayContaining([{ fk: 'poId', target: 'PurchaseOrder' }]));
  });

  it('never indexes secrets, storage paths, foreign keys or timestamps', () => {
    const forbidden = /hash|token|password|secret|otp|signature|firebase|filepath|url|mimetype|useragent/i;
    for (const p of plans) {
      const columns = [...p.text.map((t) => t.name), ...p.numbers, ...p.dates, ...p.json];
      for (const c of columns) {
        expect(c, `${p.model}.${c}`).not.toMatch(forbidden);
        expect(p.fks, `${p.model}.${c}`).not.toContain(c);
        expect(c, `${p.model}.${c}`).not.toMatch(/At$/);
      }
    }
  });

  it('keeps shared/system tables out', () => {
    for (const model of ['User', 'Project', 'AuditLog', 'PushSubscription', 'AppNotification']) {
      expect(plan(model), model).toBeUndefined();
    }
  });

  it('humanises column and model names for display', () => {
    expect(humanize('POItem')).toBe('PO Item');
    expect(humanize('paymentTerms')).toBe('Payment Terms');
    expect(humanize('MaterialPurchaseRequestItem')).toBe('Material Purchase Request Item');
  });
});
