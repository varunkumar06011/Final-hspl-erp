import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/prisma', () => ({ prisma: {} }));

import { computeStages, matchesQuery, normalizeToken, type ChainShape } from '../src/services/combined-records.service';

const chain = (over: Partial<ChainShape>): ChainShape => ({
  mpr: { status: 'APPROVED', nonVendor: false },
  quotations: [],
  pos: [],
  goodsReceipts: [],
  invoices: [],
  payments: [],
  ...over,
});

describe('combined records search', () => {
  const doc = {
    numbers: ['VGH-MPR007', 'VGH-Q012', 'VGH-PO060', 'VGH-INV-0003'],
    texts: ['Lakshmi Traders', 'Cement 53 grade', '125000'],
  };

  it('normalizes document numbers', () => {
    expect(normalizeToken('VGH-PO060')).toBe('vghpo60');
    expect(normalizeToken('PO 60')).toBe('po60');
  });

  it('finds the record by any number of the chain, with or without prefix and zeros', () => {
    expect(matchesQuery(doc, 'PO60')).toBe(true);
    expect(matchesQuery(doc, 'po-060')).toBe(true);
    expect(matchesQuery(doc, 'Q12')).toBe(true);
    expect(matchesQuery(doc, 'mpr7')).toBe(true);
    expect(matchesQuery(doc, '60')).toBe(true);
  });

  it('does not match a bare number inside a longer one', () => {
    expect(matchesQuery({ numbers: ['VGH-PO160'], texts: [] }, '60')).toBe(false);
    expect(matchesQuery({ numbers: ['VGH-PO160'], texts: [] }, 'PO60')).toBe(false);
    expect(matchesQuery({ numbers: ['VGH-PO010'], texts: [] }, 'PO1')).toBe(false);
    expect(matchesQuery({ numbers: ['VGH-PO001'], texts: [] }, 'PO1')).toBe(true);
  });

  it('matches a partly typed prefix', () => {
    expect(matchesQuery(doc, 'PO')).toBe(true);
    expect(matchesQuery(doc, 'vgh-q')).toBe(true);
  });

  it('needs every word to match (vendor, material, number)', () => {
    expect(matchesQuery(doc, 'lakshmi cement')).toBe(true);
    expect(matchesQuery(doc, 'lakshmi steel')).toBe(false);
  });
});

describe('combined records stages', () => {
  it('waits for approval of a submitted request', () => {
    const s = computeStages(chain({ mpr: { status: 'SUBMITTED', nonVendor: false } }));
    expect(s.current).toBe('REQUEST');
    expect(s.next).toBe('approveRequest');
  });

  it('asks to finalize when quotations are waiting', () => {
    const s = computeStages(chain({ mpr: { status: 'QUOTATIONS_RECEIVED', nonVendor: false }, quotations: [{ status: 'SUBMITTED' }, { status: 'SUBMITTED' }] }));
    expect(s.current).toBe('QUOTATION');
    expect(s.next).toBe('finalizeQuotation');
    expect(s.steps.find((x) => x.key === 'REQUEST')?.state).toBe('done');
  });

  it('moves to PO approval once a quotation is finalized', () => {
    const s = computeStages(chain({ quotations: [{ status: 'APPROVED' }], pos: [{ status: 'PENDING_APPROVAL', grandTotal: 1000, netPayable: 1000 }] }));
    expect(s.current).toBe('PO');
    expect(s.next).toBe('approvePo');
    expect(s.steps.find((x) => x.key === 'QUOTATION')?.state).toBe('done');
  });

  it('flags a PO without an amount', () => {
    const s = computeStages(chain({ mpr: { status: 'APPROVED', nonVendor: true }, pos: [{ status: 'PENDING_APPROVAL', grandTotal: 0, netPayable: 0 }] }));
    expect(s.next).toBe('enterPoAmount');
    expect(s.steps.find((x) => x.key === 'QUOTATION')?.state).toBe('skipped');
  });

  it('is complete when delivered, invoiced and paid', () => {
    const s = computeStages(chain({
      quotations: [{ status: 'APPROVED' }],
      pos: [{ status: 'DELIVERED', grandTotal: 1000, netPayable: 1000 }],
      invoices: [{ paymentStatus: 'PAID' }],
      payments: [{ status: 'PAID', amount: 1000 }],
    }));
    expect(s.current).toBe('DONE');
    expect(s.next).toBe('completed');
  });

  it('skips delivery and invoice for site bills: after approval only the reimbursement is left', () => {
    const s = computeStages(chain({ mpr: { status: 'APPROVED', nonVendor: true, isSiteBill: true }, pos: [{ status: 'APPROVED', grandTotal: 4200, netPayable: 4200 }] }));
    expect(s.next).toBe('makePayment');
    expect(s.steps.find((x) => x.key === 'DELIVERY')?.state).toBe('skipped');
  });

  it('closes a rejected request', () => {
    const s = computeStages(chain({ mpr: { status: 'REJECTED', nonVendor: false } }));
    expect(s.current).toBe('CLOSED');
    expect(s.next).toBe('rejected');
  });
});
