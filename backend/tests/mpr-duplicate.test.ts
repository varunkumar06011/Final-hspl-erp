/** Duplicate check for material requests: the matching rules (pure) and the loader (Prisma mocked). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  materialPurchaseRequest: { findMany: vi.fn() },
  purchaseOrder: { findMany: vi.fn() },
  paymentRequest: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: db }));

import { evaluateMprDuplicates, findMprDuplicates, type OtherMpr } from '../src/services/mpr-duplicate.service';

const gravel = (quantity: number) => ({ itemId: 'item-gravel', materialName: 'Gravel', specification: '20mm', quantity });
const mine = { vendorId: 'v1', total: 89505.3, lines: [gravel(44.2), gravel(43.36), gravel(46.03)] };

const earlier = (extra: Partial<OtherMpr> = {}): OtherMpr => ({
  id: 'm-old',
  mprNumber: 'VGH-MPR120',
  status: 'APPROVED',
  date: new Date('2026-11-10'),
  estimatedTotal: 89505.3,
  lines: [gravel(44.2), gravel(43.36), gravel(46.03)],
  purchaseOrders: [],
  payments: [],
  ...extra,
});

describe('evaluateMprDuplicates', () => {
  it('says nothing when the vendor has no earlier request for these lines', () => {
    const r = evaluateMprDuplicates(mine, [earlier({ lines: [{ itemId: 'cement', materialName: 'Cement', quantity: 10 }], estimatedTotal: 5000 })]);
    expect(r.level).toBe('NONE');
    expect(r.times).toBe(1);
    expect(r.message).toBeNull();
  });

  it('flags the same lines and quantities as entered twice, with PO and payment', () => {
    const r = evaluateMprDuplicates(
      mine,
      [earlier({ purchaseOrders: [{ id: 'po1', poNumber: 'VGH-PO150', status: 'APPROVED', grandTotal: 89505.3 }], payments: [{ code: 'ADV-1', amount: 89505.3, date: null, status: 'PAID' }] })],
    );
    expect(r.level).toBe('DUPLICATE');
    expect(r.times).toBe(2);
    expect(r.matches[0].reason).toBe('SAME_LINES');
    expect(r.matches[0].paidAmount).toBe(89505.3);
    expect(r.message).toContain('Entered twice');
    expect(r.message).toContain('VGH-MPR120');
    expect(r.message).toContain('₹89,505.3 already paid');
  });

  it('counts a third entry', () => {
    const r = evaluateMprDuplicates(mine, [earlier(), earlier({ id: 'm-old2', mprNumber: 'VGH-MPR125' })]);
    expect(r.times).toBe(3);
    expect(r.message).toContain('3 times');
  });

  it('same total with a shared line is a duplicate; a shared line alone is only possible', () => {
    const sameTotal = evaluateMprDuplicates(mine, [earlier({ lines: [gravel(44.2), { itemId: 'sand', materialName: 'Sand', quantity: 9 }] })]);
    expect(sameTotal.level).toBe('DUPLICATE');
    expect(sameTotal.matches[0].reason).toBe('SAME_TOTAL');

    const oneLine = evaluateMprDuplicates(mine, [earlier({ estimatedTotal: 1000, lines: [gravel(44.2), { itemId: 'sand', materialName: 'Sand', quantity: 9 }] })]);
    expect(oneLine.level).toBe('POSSIBLE');
    expect(oneLine.message).toContain('Possible duplicate of VGH-MPR120');
  });

  it('does not flag a normal repeat order of the same material in a different quantity', () => {
    const r = evaluateMprDuplicates(mine, [earlier({ estimatedTotal: 70000, lines: [gravel(30), gravel(20), gravel(10)] })]);
    expect(r.level).toBe('NONE');
  });

  it('a different specification is a different line', () => {
    const r = evaluateMprDuplicates(mine, [earlier({ lines: [44.2, 43.36, 46.03].map((q) => ({ ...gravel(q), specification: '40mm' })), estimatedTotal: 1 })]);
    expect(r.level).toBe('NONE');
  });

  it('matches by name + spec when a line has no catalog id', () => {
    const noId = { vendorId: 'v1', total: 0, lines: [{ materialName: ' gravel ', specification: '20MM', quantity: 44.2 }] };
    const r = evaluateMprDuplicates(noId, [earlier({ lines: [{ itemId: null, materialName: 'Gravel', specification: '20mm', quantity: 44.2 }], estimatedTotal: 29614 })]);
    expect(r.level).toBe('DUPLICATE');
  });

  it('lists a payment to the same vendor for exactly this total even without a request link', () => {
    const r = evaluateMprDuplicates(mine, [], [
      { code: 'EXP-9', amount: 89505.3, date: null, status: 'PAID', poNumber: null },
      { code: 'EXP-10', amount: 64314, date: null, status: 'PAID', poNumber: 'VGH-PO192' },
    ]);
    expect(r.level).toBe('NONE');
    expect(r.loosePayments.map((p) => p.code)).toEqual(['EXP-9']);
    expect(r.message).toContain('EXP-9');
  });
});

describe('findMprDuplicates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is project-scoped, ignores the request itself, and joins POs with their payments', async () => {
    db.materialPurchaseRequest.findMany.mockResolvedValue([
      {
        id: 'm-old',
        mprNumber: 'VGH-MPR120',
        status: 'APPROVED',
        date: new Date('2026-11-10'),
        estimatedTotal: 89505.3,
        items: [44.2, 43.36, 46.03].map((q) => ({ itemId: 'item-gravel', materialName: 'Gravel', specification: '20mm', quantity: q, estimatedAmount: 0 })),
      },
    ]);
    db.purchaseOrder.findMany.mockResolvedValue([{ id: 'po1', poNumber: 'VGH-PO150', status: 'APPROVED', grandTotal: 89505.3, mprId: null, quotation: { mprId: 'm-old' } }]);
    db.paymentRequest.findMany.mockResolvedValue([
      { paymentCode: 'ADV-1', amount: 89505.3, status: 'PAID', poId: 'po1', createdAt: new Date('2026-11-12'), purchaseOrder: { poNumber: 'VGH-PO150' }, payments: [{ amount: 89505.3, date: new Date('2026-11-12') }] },
    ]);

    const r = await findMprDuplicates({ projectId: 'p1', vendorId: 'v1', excludeId: 'm-new', total: 89505.3, lines: mine.lines });

    expect(db.materialPurchaseRequest.findMany.mock.calls[0][0].where).toMatchObject({ projectId: 'p1', vendorId: 'v1', deletedAt: null, id: { not: 'm-new' } });
    expect(r.level).toBe('DUPLICATE');
    expect(r.matches[0].purchaseOrders[0].poNumber).toBe('VGH-PO150');
    expect(r.matches[0].paidAmount).toBe(89505.3);
    expect(r.loosePayments).toHaveLength(0); // that payment belongs to the matched PO
  });

  it('answers NONE without touching the database when there is no vendor', async () => {
    const r = await findMprDuplicates({ projectId: 'p1', vendorId: null, total: 1, lines: mine.lines });
    expect(r.level).toBe('NONE');
    expect(db.materialPurchaseRequest.findMany).not.toHaveBeenCalled();
  });

  it('never throws: a database error gives NONE', async () => {
    db.materialPurchaseRequest.findMany.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await findMprDuplicates({ projectId: 'p1', vendorId: 'v1', total: 1, lines: mine.lines });
    expect(r.level).toBe('NONE');
    spy.mockRestore();
  });
});
