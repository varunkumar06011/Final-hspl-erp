import { describe, it, expect } from 'vitest';
import { createMPRSchema, updateMPRSchema, changeMPRPaymentMethodSchema } from '@hospital-erp/shared';

const base = { items: [{ materialName: 'Cement', quantity: 5 }], vendorId: '11111111-1111-4111-8111-111111111111' };
const parse = (body: Record<string, unknown>) => createMPRSchema.safeParse({ body: { ...base, ...body } });

describe('request payment type', () => {
  it('is mandatory when raising a request', () => {
    const r = parse({});
    expect(r.success).toBe(false);
  });

  it('accepts cash and cheque without any account details', () => {
    expect(parse({ paymentMethod: 'CASH' }).success).toBe(true);
    expect(parse({ paymentMethod: 'CHEQUE' }).success).toBe(true);
  });

  it('rejects an unknown payment type', () => {
    expect(parse({ paymentMethod: 'UPI' }).success).toBe(false);
  });

  it('checks account number and IFSC and upper-cases the IFSC', () => {
    const ok = parse({ paymentMethod: 'BANK_TRANSFER', accountDetails: { accountNumber: '123456789012', ifscCode: 'sbin0001234' } });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.body.accountDetails?.ifscCode).toBe('SBIN0001234');
    expect(parse({ paymentMethod: 'BANK_TRANSFER', accountDetails: { accountNumber: '12ab', ifscCode: 'SBIN0001234' } }).success).toBe(false);
    expect(parse({ paymentMethod: 'BANK_TRANSFER', accountDetails: { accountNumber: '123456789012', ifscCode: 'SBIN1001234' } }).success).toBe(false);
  });

  it('stays optional when editing and has its own change schema', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(updateMPRSchema.safeParse({ params: { id }, body: {} }).success).toBe(true);
    expect(changeMPRPaymentMethodSchema.safeParse({ params: { id }, body: {} }).success).toBe(false);
    expect(changeMPRPaymentMethodSchema.safeParse({ params: { id }, body: { paymentMethod: 'CASH' } }).success).toBe(true);
  });
});
