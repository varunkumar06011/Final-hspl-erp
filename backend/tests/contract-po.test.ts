import { describe, it, expect } from 'vitest';
import { POPaymentType, createContractPOSchema, createSubPOSchema, updateContractTermsSchema } from '@hospital-erp/shared';

const uuid = '3f2b8c1e-9d4a-4e6b-8a57-1c2d3e4f5a6b';
const line = { materialName: 'Mason - 12 workers', quantity: 12, unit: 'day', unitPrice: 900, gstRate: 0 };

describe('contract PO schemas', () => {
  it('lets a contract be raised with no estimate (value is optional)', () => {
    const ok = createContractPOSchema.safeParse({
      body: { vendorId: uuid, contractTitle: 'Labour supply - block A', acknowledged: true },
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a blank estimate from the form and treats it as not set', () => {
    const parsed = createContractPOSchema.parse({
      body: { vendorId: uuid, contractTitle: 'Civil', estimatedValue: '', contractEnd: '', acknowledged: true },
    });
    expect(parsed.body.estimatedValue).toBeUndefined();
    expect(parsed.body.contractEnd).toBeUndefined();
  });

  it('requires a title and the acknowledgement', () => {
    expect(createContractPOSchema.safeParse({ body: { vendorId: uuid, contractTitle: '  ', acknowledged: true } }).success).toBe(false);
    expect(createContractPOSchema.safeParse({ body: { vendorId: uuid, contractTitle: 'X' } }).success).toBe(false);
  });

  it('sub-PO needs a period and at least one line, and each period can have a different amount', () => {
    const base = { periodLabel: 'Week 1', paymentType: POPaymentType.AFTER_DELIVERY, acknowledged: true };
    expect(createSubPOSchema.safeParse({ params: { id: uuid }, body: { ...base, items: [line] } }).success).toBe(true);
    expect(createSubPOSchema.safeParse({ params: { id: uuid }, body: { ...base, items: [{ ...line, quantity: 30, unitPrice: 950 }] } }).success).toBe(true);
    expect(createSubPOSchema.safeParse({ params: { id: uuid }, body: { ...base, items: [] } }).success).toBe(false);
    expect(createSubPOSchema.safeParse({ params: { id: uuid }, body: { ...base, periodLabel: '', items: [line] } }).success).toBe(false);
  });

  it('contract terms can raise, lower or clear the estimate and close the contract', () => {
    const parse = (body: object) => updateContractTermsSchema.safeParse({ params: { id: uuid }, body });
    expect(parse({ estimatedValue: 5000000 }).success).toBe(true);
    expect(parse({ estimatedValue: 100 }).success).toBe(true);
    expect(parse({ estimatedValue: null }).success).toBe(true);
    expect(parse({ closed: true }).success).toBe(true);
    expect(parse({ estimatedValue: -1 }).success).toBe(false);
  });
});
