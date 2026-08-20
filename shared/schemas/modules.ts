import { z } from 'zod';
import {
  VendorStatus,
  QuotationStatus,
  POStatus,
  InvoiceVerificationStatus,
  InventoryTxnType,
  PhaseStatus,
  ActivityStatus,
  PhotoTag,
  IssueSeverity,
  InspectionStatus,
  ContractStatus,
  PaymentStatus,
  StockStatus,
} from '../enums.js';

const uuid = z.string().uuid();
const money = z.coerce.number().min(0);
const qty = z.coerce.number();
const dateStr = z.coerce.date();
const acknowledgement = z.preprocess(
  (value) => value === true || value === 'true',
  z.literal(true, { errorMap: () => ({ message: 'Acknowledgement is required' }) })
);

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ═══ Vendors ═══
const vendorMaterial = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(200),
  unit: z.string().max(20).optional(),
  pricePerUnit: z.coerce.number().min(0).optional(),
});
export const createVendorSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    contactPersonName: z.string().max(200).optional(),
    contactPersonPhone: z.string().max(20).optional(),
    referenceBy: z.string().max(200).optional(),
    gstNumber: z.string().max(20).optional(),
    panNumber: z.string().max(20).optional(),
    category: z.string().min(1).max(100).default('OTHER'),
    bankName: z.string().max(100).optional(),
    bankAccountNumber: z.string().max(30).optional(),
    ifscCode: z.string().max(15).optional(),
    address: z.string().max(500).optional(),
    phone: z.string().max(20).optional(),
    email: z.string().email().optional().or(z.literal('')),
    status: z.nativeEnum(VendorStatus).default(VendorStatus.ACTIVE), // workflow status — keep enum
    rating: z.coerce.number().int().min(0).max(5).default(0),
    materials: z.array(vendorMaterial).optional(),
  }),
});
export const updateVendorSchema = z.object({
  params: z.object({ id: uuid }),
  body: createVendorSchema.shape.body.partial(),
});
export const listVendorsSchema = z.object({
  query: pagination.extend({ search: z.string().optional(), status: z.nativeEnum(VendorStatus).optional() }),
});

// ═══ Quotations ═══
const quotationLineItem = z.object({
  materialName: z.string().min(1).max(200),
  quantity: qty,
  unit: z.string().max(20).optional(),
  unitPrice: money,
});

// Accept items as JSON string (multipart/form-data) or array (JSON body)
const itemsField = z.preprocess(
  (val) => (typeof val === 'string' ? JSON.parse(val) : val),
  z.array(quotationLineItem).min(1, 'At least one line item is required')
);

export const createQuotationSchema = z.object({
  body: z.object({
    vendorId: uuid,
    items: itemsField,
    gstAmount: money.optional(),
    acknowledged: acknowledgement,
  }),
});
export const updateQuotationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    items: z.preprocess(
      (val) => (val === undefined ? undefined : typeof val === 'string' ? JSON.parse(val) : val),
      z.array(quotationLineItem).min(1).optional()
    ),
    gstAmount: money.optional(),
  }),
});
export const listQuotationsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.nativeEnum(QuotationStatus).optional() }),
});

// ═══ Purchase Orders ═══
export const createPOSchema = z.object({
  body: z.object({
    vendorId: uuid,
    quotationId: uuid,
    gstAmount: money.optional(),
    acknowledged: acknowledgement,
  }),
});
export const updatePOSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    gstAmount: money.optional(),
  }),
});
export const listPOsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.nativeEnum(POStatus).optional() }),
});

// ═══ Project Settings ═══
export const updateProjectSettingsSchema = z.object({
  body: z.object({
    officeAddress: z.string().max(1000).optional(),
    hospitalAddress: z.string().max(1000).optional(),
    totalBudget: z.coerce.number().min(0).optional(),
  }),
});

// ═══ Vendor Invoices ═══
export const createInvoiceSchema = z.object({
  body: z.object({
    vendorId: uuid,
    poId: uuid.optional(),
    invoiceNumber: z.string().min(1).max(50).optional(),
    amount: money,
    taxAmount: money.default(0),
    totalAmount: money,
    advancePaid: money.optional(),
    advanceType: z.string().max(50).optional(),
    advanceOtherType: z.string().max(100).optional(),
    deliveryDate: dateStr.optional(),
    acknowledged: acknowledgement,
  }),
});
export const updateInvoiceSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    amount: money.optional(),
    taxAmount: money.optional(),
    totalAmount: money.optional(),
    advancePaid: money.optional(),
    advanceType: z.string().max(50).optional(),
    advanceOtherType: z.string().max(100).optional(),
    deliveryDate: dateStr.optional(),
  }),
});
export const updateInvoiceStatusSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    paymentStatus: z.nativeEnum(PaymentStatus).optional(),
    stockStatus: z.nativeEnum(StockStatus).optional(),
  }),
});
export const listInvoicesSchema = z.object({
  query: pagination.extend({
    vendorId: uuid.optional(),
    verificationStatus: z.nativeEnum(InvoiceVerificationStatus).optional(),
  }),
});

// ═══ Payment Requests ═══
export const createPaymentRequestSchema = z.object({
  body: z.object({
    invoiceId: uuid,
    vendorId: uuid,
    requestNumber: z.string().min(1).max(50),
    amount: money,
    paymentMode: z.string().max(50).optional(),
    notes: z.string().max(1000).optional(),
  }),
});
export const createExpenseSchema = z.object({
  body: z.object({
    description: z.string().min(1).max(500),
    amount: money,
    category: z.string().min(1).max(100),
    expenseDate: dateStr.optional(),
    paymentMode: z.string().max(50).optional(),
  }),
});
export const listPaymentRequestsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.string().optional(), type: z.string().optional() }),
});
export const recordPaymentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    amount: money,
    mode: z.string().min(1).max(50),
    reference: z.string().max(100).optional(),
  }),
});
export const approvalActionSchema = z.object({
  params: z.object({ id: uuid, stepId: uuid.optional() }),
  body: z.object({
    comments: z.string().max(500).optional(),
    reason: z.string().min(1).max(500).optional(),
    acknowledged: acknowledgement,
  }),
});

// ═══ Gate Passes ═══
export const createGatePassSchema = z.object({
  body: z.object({
    poId: uuid,
    invoiceId: uuid,
    otpRequestedFor: uuid,
  }),
});
export const listGatePassesSchema = z.object({
  query: pagination.extend({ status: z.string().optional() }),
});
export const verifyGatePassOtpSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ otp: z.string().min(4).max(10) }),
});

// ═══ Inventory ═══
export const createInventoryItemSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    sku: z.string().max(50).optional(),
    category: z.string().max(100).optional(),
    unit: z.string().min(1).max(20),
    currentStock: qty.default(0),
    minStockLevel: qty.default(0),
    location: z.string().max(200).optional(),
  }),
});
export const updateInventoryItemSchema = z.object({
  params: z.object({ id: uuid }),
  body: createInventoryItemSchema.shape.body.partial(),
});
export const createInventoryTxnSchema = z.object({
  body: z.object({
    itemId: uuid,
    gatePassId: uuid.optional(),
    type: z.nativeEnum(InventoryTxnType),
    quantity: qty.refine((v) => v !== 0, 'Quantity cannot be zero'),
    notes: z.string().max(500).optional(),
  }),
});
export const listInventorySchema = z.object({
  query: pagination.extend({ search: z.string().optional(), category: z.string().optional() }),
});
export const listInventoryTxnsSchema = z.object({
  query: pagination.extend({ itemId: uuid.optional(), type: z.nativeEnum(InventoryTxnType).optional() }),
});

// ═══ Phases & Activities ═══
export const createPhaseSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    plannedStart: dateStr.optional(),
    plannedEnd: dateStr.optional(),
    budgetAmount: money.default(0),
    status: z.nativeEnum(PhaseStatus).default(PhaseStatus.NOT_STARTED),
  }),
});
export const updatePhaseSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    plannedStart: dateStr.optional(),
    plannedEnd: dateStr.optional(),
    actualStart: dateStr.optional(),
    actualEnd: dateStr.optional(),
    budgetAmount: money.optional(),
    progressPercent: z.coerce.number().min(0).max(100).optional(),
    status: z.nativeEnum(PhaseStatus).optional(),
  }),
});
export const createActivitySchema = z.object({
  body: z.object({
    phaseId: uuid,
    name: z.string().min(1).max(200),
    plannedStart: dateStr.optional(),
    plannedEnd: dateStr.optional(),
    assignedVendorId: uuid.optional(),
    budgetAmount: money.default(0),
    status: z.nativeEnum(ActivityStatus).default(ActivityStatus.NOT_STARTED),
  }),
});
export const updateActivitySchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    actualStart: dateStr.optional(),
    actualEnd: dateStr.optional(),
    progressPercent: z.coerce.number().min(0).max(100).optional(),
    status: z.nativeEnum(ActivityStatus).optional(),
    assignedVendorId: uuid.optional().nullable(),
  }),
});
export const listPhasesSchema = z.object({ query: pagination });
export const listActivitiesSchema = z.object({
  query: pagination.extend({
    phaseId: uuid.optional(),
    status: z.nativeEnum(ActivityStatus).optional(),
    search: z.string().optional(),
  }),
});

// ═══ Site Photos ═══
export const createPhotoSchema = z.object({
  body: z.object({
    phaseId: uuid.optional(),
    activityId: uuid.optional(),
    zone: z.string().max(100).optional(),
    imageUrl: z.string().min(1),
    caption: z.string().max(500).optional(),
    takenAt: dateStr.optional(),
    tag: z.nativeEnum(PhotoTag).default(PhotoTag.DURING),
  }),
});
export const listPhotosSchema = z.object({
  query: pagination.extend({ phaseId: uuid.optional(), tag: z.nativeEnum(PhotoTag).optional() }),
});

// ═══ Issues ═══
export const createIssueSchema = z.object({
  body: z.object({
    category: z.string().min(1).max(100),
    severity: z.nativeEnum(IssueSeverity).default(IssueSeverity.MEDIUM),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    addressTo: z.array(uuid).min(1, 'Select at least one person to address to'),
  }),
});
export const updateIssueSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    severity: z.nativeEnum(IssueSeverity).optional(),
    category: z.string().min(1).max(100).optional(),
    addressTo: z.array(uuid).optional(),
  }),
});
export const listIssuesSchema = z.object({
  query: pagination.extend({
    severity: z.nativeEnum(IssueSeverity).optional(),
  }),
});

// ═══ Inspections ═══
export const createInspectionSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    date: dateStr.optional(),
    scheduledDate: dateStr.optional(),
  }),
});
export const updateInspectionSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    date: dateStr.optional(),
    scheduledDate: dateStr.optional(),
    checklist: z
      .array(z.object({ item: z.string(), result: z.enum(['PASS', 'FAIL', 'N/A']) }))
      .optional(),
    defects: z
      .array(z.object({ description: z.string(), severity: z.nativeEnum(IssueSeverity) }))
      .optional(),
    correctiveAction: z.string().max(2000).optional(),
    status: z.nativeEnum(InspectionStatus).optional(),
    completedDate: dateStr.optional(),
  }),
});
export const listInspectionsSchema = z.object({
  query: pagination.extend({ status: z.nativeEnum(InspectionStatus).optional() }),
});

// ═══ Documents ═══
export const createDocumentSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    resolveTo: z.array(uuid).min(1, 'Select at least one person to resolve to'),
    fileName: z.string().min(1).max(255),
    filePath: z.string().min(1),
    mimeType: z.string().min(1).max(100),
  }),
});
export const listDocumentsSchema = z.object({
  query: pagination.extend({}),
});

// ═══ Contracts ═══
const milestone = z.object({
  name: z.string().min(1).max(200),
  dueDate: dateStr.optional(),
  amount: money,
});
export const createContractSchema = z.object({
  body: z.object({
    vendorId: uuid,
    type: z.string().min(1).max(100), // configurable via DropdownOption
    startDate: dateStr,
    endDate: dateStr.optional(),
    value: money,
    advancePercent: z.coerce.number().min(0).max(100).default(0),
    retentionPercent: z.coerce.number().min(0).max(100).default(0),
    milestones: z.array(milestone).optional(),
  }),
});
export const updateContractSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.nativeEnum(ContractStatus).optional(),
    endDate: dateStr.optional(),
  }),
});
export const listContractsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.nativeEnum(ContractStatus).optional() }),
});

// ═══ Attendance (Staff + Daily Attendance) ═══
export const createStaffSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    type: z.enum(['COMPANY', 'LABOUR']),
    role: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    baseSalary: money,
  }),
});
export const updateStaffSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    role: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    baseSalary: money.optional(),
    active: z.boolean().optional(),
  }),
});
export const listStaffSchema = z.object({
  query: pagination.extend({
    type: z.enum(['COMPANY', 'LABOUR']).optional(),
    active: z.enum(['true', 'false']).optional(),
  }),
});
export const markAttendanceSchema = z.object({
  body: z.object({
    date: dateStr,
    records: z.array(z.object({
      staffId: uuid,
      present: z.boolean(),
      notes: z.string().max(500).optional(),
    })).min(1),
  }),
});
export const listAttendanceSchema = z.object({
  query: pagination.extend({
    staffId: uuid.optional(),
    type: z.enum(['COMPANY', 'LABOUR']).optional(),
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
  }),
});

// ═══ Dropdown Options ═══
export const createDropdownOptionSchema = z.object({
  body: z.object({
    type: z.string().min(1).max(100),
    value: z.string().min(1).max(200),
    label: z.string().max(200).optional(),
  }),
});
export const listDropdownOptionsSchema = z.object({
  query: pagination.extend({
    type: z.string().min(1).max(100),
    isActive: z.coerce.boolean().optional(),
  }),
});

// ═══ Attachments ═══
export const listAttachmentsSchema = z.object({
  query: pagination.extend({
    entityType: z.string().min(1).max(50).optional(),
    entityId: uuid.optional(),
    fileType: z.string().max(20).optional(),
  }),
});
