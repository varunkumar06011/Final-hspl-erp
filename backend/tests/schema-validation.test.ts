/**
 * Schema Validation Tests
 * =======================
 *
 * Every API request is validated by a Zod schema defined in shared/schemas/.
 * These schemas are the **contract between the frontend and backend**:
 *  - If they accept bad data, the database fills with garbage and reports are wrong.
 *  - If they reject good data, users can't do their jobs and the app is unusable.
 *
 * These tests verify that each schema:
 *  - Accepts valid inputs (including edge cases like empty optional strings)
 *  - Rejects invalid inputs (wrong types, out-of-range numbers, missing required fields)
 *  - Applies the correct defaults (so the frontend doesn't have to send every field)
 *  - Coerces string query params to numbers (Express sends all query params as strings)
 *
 * The tests are organized by module, matching the order in shared/schemas/modules.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  createVendorSchema,
  updateVendorSchema,
  listVendorsSchema,
  createQuotationSchema,
  createPOSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  createPaymentRequestSchema,
  createExpenseSchema,
  recordPaymentSchema,
  createGatePassSchema,
  verifyGatePassOtpSchema,
  createInventoryItemSchema,
  createInventoryTxnSchema,
  createPhaseSchema,
  updatePhaseSchema,
  createActivitySchema,
  createIssueSchema,
  createInspectionSchema,
  createDocumentSchema,
  createContractSchema,
  createStaffSchema,
  markAttendanceSchema,
  createDropdownOptionSchema,
  updateProjectSettingsSchema,
} from '@hospital-erp/shared';
import {
  VendorStatus,
  InventoryTxnType,
  PhaseStatus,
  IssueSeverity,
  UserRole,
} from '@hospital-erp/shared';

// A valid UUID used throughout the tests.
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

// ─────────────────────────────────────────────────────────────────────────────
// VENDORS — the root entity. Bad vendor data cascades into every PO and invoice.
// ─────────────────────────────────────────────────────────────────────────────
describe('Vendor schemas', () => {
  it('accepts a minimal valid vendor (only name required) and applies defaults for the rest', () => {
    // The frontend only sends the name on quick-add; everything else defaults.
    const parsed = createVendorSchema.parse({ body: { name: 'Acme' } });
    expect(parsed.body.name).toBe('Acme');
    expect(parsed.body.category).toBe('OTHER'); // default category
    expect(parsed.body.rating).toBe(0); // default rating
    expect(parsed.body.status).toBe(VendorStatus.ACTIVE); // default status
  });

  it('rejects an empty vendor name (name is the only required field, it cannot be blank)', () => {
    expect(() => createVendorSchema.parse({ body: { name: '' } })).toThrow();
  });

  it('rejects an invalid email address', () => {
    // A typo'd email would cause notification emails to bounce silently.
    expect(() =>
      createVendorSchema.parse({ body: { name: 'Acme', email: 'not-an-email' } })
    ).toThrow();
  });

  it('accepts an empty string email (the frontend sends "" when the field is left blank)', () => {
    // The schema uses .email().optional().or(z.literal('')) so an empty string
    // is treated as "no email" rather than "invalid email".
    const parsed = createVendorSchema.parse({ body: { name: 'Acme', email: '' } });
    expect(parsed.body.email).toBe('');
  });

  it('accepts a 5-star rating but rejects anything above 5 or below 0', () => {
    // The UI shows rating as 0–5 stars. A 6-star rating would break the badge.
    expect(createVendorSchema.parse({ body: { name: 'A', rating: 5 } }).body.rating).toBe(5);
    expect(() => createVendorSchema.parse({ body: { name: 'A', rating: 6 } })).toThrow();
    expect(() => createVendorSchema.parse({ body: { name: 'A', rating: -1 } })).toThrow();
  });

  it('updateVendorSchema rejects a non-UUID params.id (prevents updating a non-existent vendor)', () => {
    expect(() => updateVendorSchema.parse({ params: { id: 'not-a-uuid' }, body: {} })).toThrow();
    // A valid UUID with a partial body should work.
    expect(
      updateVendorSchema.parse({ params: { id }, body: { name: 'New' } }).body.name
    ).toBe('New');
  });

  it('listVendorsSchema coerces string pagination params to numbers and applies defaults', () => {
    // Express sends query params as strings ("2", "5"). Zod coerces them to numbers.
    const parsed = listVendorsSchema.parse({ query: { page: '2', pageSize: '5' } });
    expect(parsed.query.page).toBe(2);
    expect(parsed.query.pageSize).toBe(5);
  });

  it('listVendorsSchema caps pageSize at 100 (prevents a malicious client from requesting all rows)', () => {
    // Without this cap, a request like ?pageSize=999999 would load the entire
    // vendors table into memory and likely crash the server.
    expect(() => listVendorsSchema.parse({ query: { pageSize: '101' } })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUOTATIONS & PURCHASE ORDERS — the procurement flow.
// ─────────────────────────────────────────────────────────────────────────────
describe('Quotation & Purchase Order schemas', () => {
  it('createQuotationSchema accepts items as a JSON string (sent by multipart form uploads)', () => {
    // The mobile app uploads quotations as multipart/form-data (because of file
    // attachments), so the items array is sent as a JSON string field.
    const parsed = createQuotationSchema.parse({
      body: {
        vendorId: id,
        items: JSON.stringify([{ materialName: 'Cement', quantity: 10, unitPrice: 50 }]),
        acknowledged: 'true',
      },
    });
    expect(parsed.body.items).toHaveLength(1);
    expect(parsed.body.items[0].materialName).toBe('Cement');
  });

  it('createQuotationSchema rejects an empty items array (a quotation with no line items is meaningless)', () => {
    expect(() =>
      createQuotationSchema.parse({
        body: { vendorId: id, items: [], acknowledged: true },
      })
    ).toThrow();
  });

  it('createQuotationSchema rejects a malformed JSON string for items (returns 400, not 500)', () => {
    // Without this, a bad items field would crash the JSON parser and produce
    // a 500 Internal Server Error instead of a clean 400 Bad Request.
    expect(() =>
      createQuotationSchema.parse({
        body: { vendorId: id, items: '{not json', acknowledged: true },
      })
    ).toThrow();
  });

  it('createPOSchema requires a valid quotationId and an acknowledgement checkbox', () => {
    // POs can only be created from an approved quotation. The acknowledgement
    // is a legal CYA — the user confirms they've reviewed the quotation.
    expect(() =>
      createPOSchema.parse({ body: { vendorId: id, quotationId: 'bad' } })
    ).toThrow(); // invalid UUID
    expect(() =>
      createPOSchema.parse({ body: { vendorId: id, quotationId: id } })
    ).toThrow('Acknowledgement is required'); // missing acknowledgement
    const parsed = createPOSchema.parse({
      body: { vendorId: id, quotationId: id, acknowledged: true },
    });
    expect(parsed.body.vendorId).toBe(id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICES — vendor billing. The advance-paid rule prevents overpayment.
// ─────────────────────────────────────────────────────────────────────────────
describe('Invoice schemas', () => {
  const validInvoice = {
    vendorId: id,
    invoiceNumber: 'INV-1',
    amount: 100,
    taxAmount: 10,
    totalAmount: 110,
    acknowledged: true,
  };

  it('createInvoiceSchema accepts a fully valid invoice', () => {
    const parsed = createInvoiceSchema.parse({ body: validInvoice });
    expect(parsed.body.totalAmount).toBe(110);
  });

  it('createInvoiceSchema defaults taxAmount to 0 (older frontends don\'t send it)', () => {
    // This default prevents a null in the DB when the frontend doesn't send taxAmount.
    const parsed = createInvoiceSchema.parse({
      body: { vendorId: id, amount: 100, totalAmount: 100, acknowledged: true },
    });
    expect(parsed.body.taxAmount).toBe(0);
  });

  it('createInvoiceSchema rejects an advancePaid greater than the totalAmount (prevents overpayment)', () => {
    // A vendor can't be paid more in advance than the invoice is worth.
    expect(() =>
      createInvoiceSchema.parse({
        body: { ...validInvoice, advancePaid: 200, totalAmount: 110 },
      })
    ).toThrow('Advance paid');
  });

  it('createInvoiceSchema accepts an advancePaid equal to the totalAmount (100% advance is allowed)', () => {
    const parsed = createInvoiceSchema.parse({
      body: { ...validInvoice, advancePaid: 110, totalAmount: 110 },
    });
    expect(parsed.body.advancePaid).toBe(110);
  });

  it('updateInvoiceSchema requires a UUID params.id', () => {
    expect(() =>
      updateInvoiceSchema.parse({ params: { id: 'x' }, body: { amount: 1 } })
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT REQUESTS & EXPENSES — the financial outflow side.
// ─────────────────────────────────────────────────────────────────────────────
describe('Payment request & expense schemas', () => {
  it('createPaymentRequestSchema accepts a valid payment request', () => {
    const parsed = createPaymentRequestSchema.parse({
      body: { invoiceId: id, vendorId: id, requestNumber: 'PR-1', amount: 500 },
    });
    expect(parsed.body.amount).toBe(500);
  });

  it('createPaymentRequestSchema rejects a missing requestNumber (every payment needs a traceable reference)', () => {
    expect(() =>
      createPaymentRequestSchema.parse({
        body: { invoiceId: id, vendorId: id, amount: 500 },
      })
    ).toThrow();
  });

  it('createPaymentRequestSchema rejects a negative amount (payments must be positive)', () => {
    expect(() =>
      createPaymentRequestSchema.parse({
        body: { invoiceId: id, vendorId: id, requestNumber: 'PR-1', amount: -1 },
      })
    ).toThrow();
  });

  it('createExpenseSchema requires both a description and a category', () => {
    // Expenses (like travel, fuel, misc) need a category for the expense report.
    expect(() => createExpenseSchema.parse({ body: { description: 'x', amount: 10 } })).toThrow();
    const parsed = createExpenseSchema.parse({
      body: { description: 'Travel', amount: 10, category: 'TRAVEL' },
    });
    expect(parsed.body.category).toBe('TRAVEL');
  });

  it('recordPaymentSchema requires a payment mode (bank transfer, cash, UPI, etc.)', () => {
    // The mode is needed for the payment ledger and audit trail.
    expect(() =>
      recordPaymentSchema.parse({ params: { id }, body: { amount: 10 } })
    ).toThrow();
    const parsed = recordPaymentSchema.parse({
      params: { id },
      body: { amount: 10, mode: 'CASH' },
    });
    expect(parsed.body.mode).toBe('CASH');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE PASSES — material entry/exit tracking with OTP verification.
// ─────────────────────────────────────────────────────────────────────────────
describe('Gate Pass schemas', () => {
  it('createGatePassSchema requires a PO, vehicle type, and an OTP recipient for material gatepasses (vehicle number is optional)', () => {
    expect(() => createGatePassSchema.parse({ body: { poId: id } })).toThrow();
    const parsed = createGatePassSchema.parse({
      body: { poId: id, otpRequestedFor: id, vehicleType: 'TRUCK', vehicleNumber: 'AP39AB1234' },
    });
    expect(parsed.body.poId).toBe(id);
    expect(parsed.body.vehicleType).toBe('TRUCK');
    // vehicle number is optional
    const parsedNoVehicle = createGatePassSchema.parse({
      body: { poId: id, otpRequestedFor: id, vehicleType: 'TRUCK' },
    });
    expect(parsedNoVehicle.body.vehicleNumber).toBeUndefined();
  });

  it('createGatePassSchema accepts an optional invoiceId (for invoice-linked deliveries)', () => {
    const parsed = createGatePassSchema.parse({
      body: { poId: id, otpRequestedFor: id, invoiceId: otherId, vehicleType: 'LORRY', vehicleNumber: 'AP39AB1234' },
    });
    expect(parsed.body.invoiceId).toBe(otherId);
  });

  it('createGatePassSchema accepts simple visitor gatepasses without a PO or vehicle', () => {
    const parsed = createGatePassSchema.parse({
      body: { gatePassCategory: 'VISITOR', visitorName: 'Jane Doe', otpRequestedFor: id },
    });
    expect(parsed.body.gatePassCategory).toBe('VISITOR');
    expect(parsed.body.poId).toBeUndefined();
  });

  it('verifyGatePassOtpSchema requires a Firebase idToken (the guard must authenticate before verifying)', () => {
    // The guard's identity is verified via Firebase before the OTP is accepted.
    // This prevents a random person at the gate from approving a gate pass.
    expect(() => verifyGatePassOtpSchema.parse({ params: { id }, body: {} })).toThrow();
    const parsed = verifyGatePassOtpSchema.parse({
      params: { id },
      body: { idToken: 'firebase-token' },
    });
    expect(parsed.body.idToken).toBe('firebase-token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY — stock level tracking. The zero-quantity rule prevents no-op txns.
// ─────────────────────────────────────────────────────────────────────────────
describe('Inventory schemas', () => {
  it('createInventoryItemSchema requires a unit and a name, defaults stock levels to 0', () => {
    expect(() => createInventoryItemSchema.parse({ body: { name: 'Cement' } })).toThrow();
    const parsed = createInventoryItemSchema.parse({
      body: { name: 'Cement', unit: 'BAG' },
    });
    expect(parsed.body.currentStock).toBe(0);
    expect(parsed.body.minStockLevel).toBe(0);
  });

  it('createInventoryTxnSchema rejects a zero quantity (an IN/OUT of 0 is a no-op that corrupts stock)', () => {
    expect(() =>
      createInventoryTxnSchema.parse({
        body: { itemId: id, type: InventoryTxnType.IN, quantity: 0 },
      })
    ).toThrow('Quantity cannot be zero');
  });

  it('createInventoryTxnSchema accepts a positive IN transaction', () => {
    const parsed = createInventoryTxnSchema.parse({
      body: { itemId: id, type: InventoryTxnType.IN, quantity: 50 },
    });
    expect(parsed.body.type).toBe(InventoryTxnType.IN);
  });

  it('createInventoryTxnSchema rejects an invalid transaction type', () => {
    // Only IN, OUT, and ADJUST are valid. Anything else is a frontend bug.
    expect(() =>
      createInventoryTxnSchema.parse({
        body: { itemId: id, type: 'INVALID', quantity: 5 },
      })
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASES & ACTIVITIES — construction project tracking.
// ─────────────────────────────────────────────────────────────────────────────
describe('Phase & Activity schemas', () => {
  it('createPhaseSchema defaults status to NOT_STARTED and budgetAmount to 0', () => {
    // New phases start with sensible defaults so the frontend doesn't have to send them.
    const parsed = createPhaseSchema.parse({ body: { name: 'Foundation' } });
    expect(parsed.body.status).toBe(PhaseStatus.NOT_STARTED);
    expect(parsed.body.budgetAmount).toBe(0);
  });

  it('updatePhaseSchema rejects a progressPercent outside 0–100', () => {
    // 150% progress would break the progress bar UI.
    expect(() =>
      updatePhaseSchema.parse({ params: { id }, body: { progressPercent: 150 } })
    ).toThrow();
    expect(
      updatePhaseSchema.parse({ params: { id }, body: { progressPercent: 50 } }).body
        .progressPercent
    ).toBe(50);
  });

  it('createActivitySchema requires a phaseId (every activity belongs to a phase)', () => {
    expect(() => createActivitySchema.parse({ body: { name: 'Pour' } })).toThrow();
    expect(
      createActivitySchema.parse({ body: { name: 'Pour', phaseId: id } }).body.phaseId
    ).toBe(id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ISSUES, INSPECTIONS, DOCUMENTS — site governance and quality tracking.
// ─────────────────────────────────────────────────────────────────────────────
describe('Issue, Inspection & Document schemas', () => {
  it('createIssueSchema requires at least one addressTo user (an issue addressed to nobody is seen by nobody)', () => {
    expect(() =>
      createIssueSchema.parse({
        body: { category: 'MATERIAL', title: 'Bad cement', addressTo: [] },
      })
    ).toThrow('at least one person');
  });

  it('createIssueSchema defaults severity to MEDIUM (if the user doesn\'t pick, we default rather than reject)', () => {
    const parsed = createIssueSchema.parse({
      body: { category: 'MATERIAL', title: 'Bad cement', addressTo: [id] },
    });
    expect(parsed.body.severity).toBe(IssueSeverity.MEDIUM);
  });

  it('createInspectionSchema requires a name', () => {
    expect(() => createInspectionSchema.parse({ body: {} })).toThrow();
    expect(createInspectionSchema.parse({ body: { name: 'Slab check' } }).body.name).toBe(
      'Slab check'
    );
  });

  it('createDocumentSchema requires at least one resolveTo user (a document must be assigned to someone)', () => {
    expect(() =>
      createDocumentSchema.parse({
        body: { name: 'Permit', fileName: 'p.pdf', filePath: '/p', mimeType: 'application/pdf', resolveTo: [] },
      })
    ).toThrow('at least one person');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACTS, STAFF, ATTENDANCE, DROPDOWN OPTIONS — operational modules.
// ─────────────────────────────────────────────────────────────────────────────
describe('Contract, Staff, Attendance & Dropdown schemas', () => {
  it('createContractSchema requires a startDate and clamps advancePercent to 0–100', () => {
    // A contract without a start date can't be tracked on the timeline.
    expect(() =>
      createContractSchema.parse({
        body: { vendorId: id, type: 'FIXED_PRICE', value: 1000 },
      })
    ).toThrow();
    // advancePercent > 100 makes no sense (you can't pay more than 100% in advance).
    expect(() =>
      createContractSchema.parse({
        body: {
          vendorId: id,
          type: 'FIXED_PRICE',
          startDate: '2026-01-01',
          value: 1000,
          advancePercent: 150,
        },
      })
    ).toThrow();
    // Defaults: advancePercent and retentionPercent both default to 0.
    const parsed = createContractSchema.parse({
      body: {
        vendorId: id,
        type: 'FIXED_PRICE',
        startDate: '2026-01-01',
        value: 1000,
      },
    });
    expect(parsed.body.advancePercent).toBe(0);
    expect(parsed.body.retentionPercent).toBe(0);
  });

  it('createStaffSchema requires type to be COMPANY or LABOUR (the attendance module splits reports by these)', () => {
    expect(() =>
      createStaffSchema.parse({ body: { name: 'Ravi', type: 'OTHER', baseSalary: 1000 } })
    ).toThrow();
    expect(
      createStaffSchema.parse({ body: { name: 'Ravi', type: 'LABOUR', baseSalary: 1000 } }).body
        .type
    ).toBe('LABOUR');
  });

  it('markAttendanceSchema requires at least one attendance record', () => {
    // Marking attendance with zero records is a no-op and likely a frontend bug.
    expect(() =>
      markAttendanceSchema.parse({ body: { date: '2026-01-01', records: [] } })
    ).toThrow();
    const parsed = markAttendanceSchema.parse({
      body: { date: '2026-01-01', records: [{ staffId: id, present: true }] },
    });
    expect(parsed.body.records).toHaveLength(1);
  });

  it('createDropdownOptionSchema requires a type and a value', () => {
    // Dropdown options are configurable lists (e.g. contract types, expense categories).
    expect(() => createDropdownOptionSchema.parse({ body: { value: 'x' } })).toThrow();
    expect(
      createDropdownOptionSchema.parse({ body: { type: 'CATEGORY', value: 'x' } }).body.value
    ).toBe('x');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT SETTINGS — the hospital profile that appears on every PDF export.
// ─────────────────────────────────────────────────────────────────────────────
describe('Project settings schema', () => {
  it('updateProjectSettingsSchema rejects an empty hospital name (it appears on every PDF export)', () => {
    expect(() =>
      updateProjectSettingsSchema.parse({ body: { name: '' } })
    ).toThrow();
  });

  it('updateProjectSettingsSchema accepts a partial update (only send the fields you want to change)', () => {
    const parsed = updateProjectSettingsSchema.parse({ body: { totalBudget: 500000 } });
    expect(parsed.body.totalBudget).toBe(500000);
  });

  it('updateProjectSettingsSchema rejects a negative totalBudget', () => {
    expect(() =>
      updateProjectSettingsSchema.parse({ body: { totalBudget: -1 } })
    ).toThrow();
  });
});
