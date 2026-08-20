import { describe, expect, it } from 'vitest';
import {
  approvalActionSchema,
  createInvoiceSchema,
  createPOSchema,
  createQuotationSchema,
} from '@hospital-erp/shared';

const id = '11111111-1111-4111-8111-111111111111';

const requests = [
  {
    schema: createQuotationSchema,
    input: {
      body: {
        vendorId: id,
        items: [{ materialName: 'Cement', quantity: 1, unitPrice: 100 }],
      },
    },
  },
  {
    schema: createPOSchema,
    input: { body: { vendorId: id, quotationId: id } },
  },
  {
    schema: createInvoiceSchema,
    input: {
      body: {
        vendorId: id,
        invoiceNumber: 'INV-1',
        amount: 100,
        taxAmount: 0,
        totalAmount: 100,
      },
    },
  },
];

describe('Acknowledgement validation', () => {
  it.each(requests)('rejects creation without acknowledgement', ({ schema, input }) => {
    expect(() => schema.parse(input)).toThrow('Acknowledgement is required');
  });

  it.each(requests)('accepts true from JSON or multipart forms', ({ schema, input }) => {
    expect(schema.parse({ ...input, body: { ...input.body, acknowledged: 'true' } }).body.acknowledged).toBe(true);
  });

  it('requires acknowledgement for approval and rejection actions', () => {
    const input = { params: { id }, body: { comments: 'Reviewed' } };
    expect(() => approvalActionSchema.parse(input)).toThrow('Acknowledgement is required');
    expect(approvalActionSchema.parse({
      ...input,
      body: { ...input.body, acknowledged: true },
    }).body.acknowledged).toBe(true);
  });
});
