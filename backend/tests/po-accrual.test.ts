/**
 * PO vendor-payable accrual — pure posting maths.
 *
 * When a PO is approved we book Dr Purchase / Cr Vendor for the net payable
 * (grand total less the deductions agreed on the PO). When it is edited and
 * re-approved, or no longer approved, only the DIFFERENCE from what is already
 * booked may be posted. These tests pin that contract without a database.
 */
import { describe, it, expect } from 'vitest';
import { buildDesiredAccrual, computeAccrualDelta, payableAfterDeductions } from '../src/services/po-accrual.service';

const base = { vendorLedgerId: 'vendor', purchaseLedgerId: 'purchase' };

const netOf = (lines: Array<{ debit: number; credit: number }>) =>
  Math.round(lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

describe('payableAfterDeductions', () => {
  it('credits the vendor the net payable, e.g. Balaji PO032: 25,82,985 less 1,21,800 = 24,61,185', () => {
    expect(payableAfterDeductions(2582985, 121800)).toBe(2461185);
  });

  it('equals the grand total when there are no deductions, and never goes negative', () => {
    expect(payableAfterDeductions(117040, 0)).toBe(117040);
    expect(payableAfterDeductions(1000, 5000)).toBe(0);
  });
});

describe('buildDesiredAccrual', () => {
  it('credits the vendor and debits Purchase for the same amount', () => {
    const d = buildDesiredAccrual({ ...base, payable: 117040 });
    expect(d.get('vendor')).toBe(-117040);
    expect(d.get('purchase')).toBe(117040);
    expect([...d.values()].reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('does not book Input GST — the whole net payable goes to Purchase (PO032 has GST 3,75,435)', () => {
    const d = buildDesiredAccrual({ ...base, payable: payableAfterDeductions(2582985, 121800) });
    expect(d.size).toBe(2);
    expect(d.get('purchase')).toBe(2461185);
    expect(d.get('vendor')).toBe(-2461185);
  });

  it('credits a pinned ledger instead of the vendor ledger (PO033 -> USL - S. Ashok Kumar)', () => {
    const d = buildDesiredAccrual({ vendorLedgerId: 'usl-ashok', purchaseLedgerId: 'purchase', payable: 146650 });
    expect(d.get('usl-ashok')).toBe(-146650);
    expect(d.has('vendor')).toBe(false);
  });
});

describe('computeAccrualDelta', () => {
  const approved = buildDesiredAccrual({ ...base, payable: 100000 });

  it('posts the full entry the first time (nothing booked yet)', () => {
    const lines = computeAccrualDelta(approved, new Map());
    expect(lines).toContainEqual({ ledgerId: 'purchase', debit: 100000, credit: 0 });
    expect(lines).toContainEqual({ ledgerId: 'vendor', debit: 0, credit: 100000 });
    expect(netOf(lines)).toBe(0);
  });

  it('posts nothing when the booked payable already matches (idempotent re-approval)', () => {
    expect(computeAccrualDelta(approved, approved)).toEqual([]);
  });

  it('posts only the increase when the PO total goes up after an edit', () => {
    const revised = buildDesiredAccrual({ ...base, payable: 130000 });
    const lines = computeAccrualDelta(revised, approved);
    expect(lines).toContainEqual({ ledgerId: 'purchase', debit: 30000, credit: 0 });
    expect(lines).toContainEqual({ ledgerId: 'vendor', debit: 0, credit: 30000 });
  });

  it('reduces the payable (Dr Vendor / Cr Purchase) when the PO total goes down', () => {
    const revised = buildDesiredAccrual({ ...base, payable: 80000 });
    const lines = computeAccrualDelta(revised, approved);
    expect(lines).toContainEqual({ ledgerId: 'vendor', debit: 20000, credit: 0 });
    expect(lines).toContainEqual({ ledgerId: 'purchase', debit: 0, credit: 20000 });
  });

  it('fully reverses the booking when the PO is no longer approved', () => {
    const lines = computeAccrualDelta(new Map(), approved);
    expect(lines).toContainEqual({ ledgerId: 'vendor', debit: 100000, credit: 0 });
    expect(lines).toContainEqual({ ledgerId: 'purchase', debit: 0, credit: 100000 });
  });

  it('moves the credit to the new vendor ledger if the PO vendor changed', () => {
    const newVendor = buildDesiredAccrual({ vendorLedgerId: 'vendor2', purchaseLedgerId: 'purchase', payable: 100000 });
    const lines = computeAccrualDelta(newVendor, approved);
    expect(lines).toContainEqual({ ledgerId: 'vendor', debit: 100000, credit: 0 });
    expect(lines).toContainEqual({ ledgerId: 'vendor2', debit: 0, credit: 100000 });
    expect(netOf(lines)).toBe(0);
  });

  it('keeps a pinned ledger stable across re-approval (no move back to the vendor ledger)', () => {
    const pinned = buildDesiredAccrual({ vendorLedgerId: 'usl-ashok', purchaseLedgerId: 'purchase', payable: 146650 });
    expect(computeAccrualDelta(pinned, pinned)).toEqual([]);
  });

  it('instalment payments leave exactly the unpaid balance, reaching 0 when fully paid', () => {
    // PO of 25,00,000: Cr at approval; payments debit the vendor ledger
    const booked = buildDesiredAccrual({ ...base, payable: 2500000 }).get('vendor')!; // -25,00,000
    const afterAdvance = booked + 1000000;
    const afterSecond = afterAdvance + 500000;
    const afterFinal = afterSecond + 1000000;
    expect([afterAdvance, afterSecond, afterFinal]).toEqual([-1500000, -1000000, 0]);
  });
});
