/**
 * Final checklist before a goods receipt can go into inventory (evaluateReceiptChecklist,
 * pure). Posting is refused while any box is MISSING, so these cases guard the main
 * PO → stock path.
 */
import { describe, it, expect } from 'vitest';
import { evaluateReceiptChecklist, type ReceiptFacts } from '../src/services/inventory-checklist.service';

const mpr = { mprNumber: 'VGH-MPR001', status: 'APPROVED', deletedAt: null };
const facts = (over: Partial<ReceiptFacts> = {}, po: Partial<ReceiptFacts['po']> = {}): ReceiptFacts => ({
  status: 'READY_TO_POST',
  inspectedAt: new Date(),
  items: [{ itemId: 'cat-cement', poItemId: 'poi-1' }],
  gatePass: { passNumber: 'VGH-GP001', status: 'APPROVED', photoProofPath: 'gp.jpg', deletedAt: null },
  ...over,
  po: {
    poNumber: 'VGH-PO001',
    status: 'APPROVED',
    vendorType: 'VENDOR',
    isSiteBillBatch: false,
    contract: null,
    quotation: { quotationNumber: 'VGH-Q001', status: 'APPROVED', deletedAt: null, mprId: 'mpr-1' },
    mprId: 'mpr-1',
    mpr,
    siteBills: [],
    ...po,
  },
});
const state = (c: ReturnType<typeof evaluateReceiptChecklist>, key: string) => c.items.find((i) => i.key === key);

describe('goods receipt checklist', () => {
  it('a vendor receipt with the whole chain in place is complete', () => {
    const c = evaluateReceiptChecklist(facts());
    expect(c.complete).toBe(true);
    expect(c.items.every((i) => i.state === 'OK')).toBe(true);
  });

  it('blocks a receipt whose gate pass has no photo', () => {
    const c = evaluateReceiptChecklist(facts({ gatePass: { passNumber: 'VGH-GP001', status: 'APPROVED', photoProofPath: null, deletedAt: null } }));
    expect(c.complete).toBe(false);
    expect(state(c, 'proof')).toMatchObject({ state: 'MISSING', reason: 'NO_PHOTO' });
  });

  it('blocks a receipt with no gate pass, or a gate pass not yet approved', () => {
    expect(state(evaluateReceiptChecklist(facts({ gatePass: null })), 'gatePass')).toMatchObject({ reason: 'NO_GATE_PASS' });
    const pending = evaluateReceiptChecklist(facts({ gatePass: { passNumber: 'GP', status: 'PENDING', photoProofPath: 'x', deletedAt: null } }));
    expect(state(pending, 'gatePass')).toMatchObject({ reason: 'GATE_PASS_NOT_APPROVED' });
  });

  it('blocks a receipt that was not inspected', () => {
    const c = evaluateReceiptChecklist(facts({ status: 'PENDING_INSPECTION', inspectedAt: null }));
    expect(state(c, 'inspection')).toMatchObject({ state: 'MISSING', reason: 'NOT_INSPECTED' });
  });

  it('blocks lines that are not on the PO or not in the item catalog', () => {
    expect(state(evaluateReceiptChecklist(facts({ items: [{ itemId: 'c', poItemId: null }] })), 'items')).toMatchObject({ reason: 'LINE_NOT_ON_PO' });
    expect(state(evaluateReceiptChecklist(facts({ items: [{ itemId: null, poItemId: 'p' }] })), 'items')).toMatchObject({ reason: 'LINE_NOT_IN_CATALOG' });
    expect(state(evaluateReceiptChecklist(facts({ items: [] })), 'items')).toMatchObject({ reason: 'NO_LINES' });
  });

  it('a vendor PO needs a finalized quotation and an approved request and PO', () => {
    expect(state(evaluateReceiptChecklist(facts({}, { quotation: null })), 'quotation')).toMatchObject({ reason: 'NO_QUOTATION' });
    expect(
      state(evaluateReceiptChecklist(facts({}, { quotation: { quotationNumber: 'Q', status: 'SUBMITTED', deletedAt: null, mprId: 'mpr-1' } })), 'quotation'),
    ).toMatchObject({ reason: 'QUOTATION_NOT_FINALIZED' });
    expect(state(evaluateReceiptChecklist(facts({}, { mpr: { ...mpr, status: 'SUBMITTED' } })), 'request')).toMatchObject({ reason: 'REQUEST_NOT_APPROVED' });
    expect(state(evaluateReceiptChecklist(facts({}, { status: 'PENDING_APPROVAL' })), 'po')).toMatchObject({ reason: 'PO_NOT_APPROVED' });
  });

  it('a non-vendor PO needs no quotation but must come from a request', () => {
    const ok = evaluateReceiptChecklist(facts({}, { vendorType: 'NON_VENDOR', quotation: null }));
    expect(state(ok, 'quotation')).toMatchObject({ state: 'NOT_NEEDED' });
    expect(ok.complete).toBe(true);
    const orphan = evaluateReceiptChecklist(facts({}, { vendorType: 'NON_VENDOR', quotation: null, mprId: null, mpr: null }));
    expect(state(orphan, 'vendorPath')).toMatchObject({ reason: 'NON_VENDOR_WITHOUT_REQUEST' });
  });

  it('site-bill POs need every bill approved; contract bills need the contract approved', () => {
    const bills = evaluateReceiptChecklist(
      facts({}, { vendorType: 'NON_VENDOR', quotation: null, isSiteBillBatch: true, mpr: null, mprId: null, siteBills: [mpr, { ...mpr, mprNumber: 'B2', status: 'DRAFT' }] }),
    );
    expect(state(bills, 'request')).toMatchObject({ reason: 'SITE_BILL_NOT_APPROVED', ref: 'B2' });
    const contract = evaluateReceiptChecklist(facts({}, { contract: { poNumber: 'VGH-C1', status: 'PENDING_APPROVAL' } }));
    expect(state(contract, 'request')).toMatchObject({ reason: 'CONTRACT_NOT_APPROVED' });
    expect(state(contract, 'quotation')).toMatchObject({ state: 'NOT_NEEDED' });
  });
});
