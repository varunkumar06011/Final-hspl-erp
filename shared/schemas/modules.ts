import { z } from 'zod';
import {
  VendorStatus,
  PaymentMode,
  QuotationStatus,
  POStatus,
  InvoiceVerificationStatus,
  GatePassType,
  GatePassStatus,
  InventoryTxnType,
  PhaseStatus,
  ActivityStatus,
  PhotoTag,
  IssueSeverity,
  IssueStatus,
  InspectionStatus,
  DocumentStatus,
  ContractStatus,
} from '../enums';

const uuid = z.string().uuid();
const money = z.coerce.number().min(0);
const qty = z.coerce.number();
const dateStr = z.coerce.date();

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ═══ Vendors ═══
export const createVendorSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    gstNumber: z.string().max(20).optional(),
    panNumber: z.string().max(20).optional(),
    category: z.string().min(1).max(100).default('OTHER'),
    subCategory: z.string().max(100).optional(),
    bankName: z.string().max(100).optional(),
    bankAccountNumber: z.string().max(30).optional(),
    ifscCode: z.string().max(15).optional(),
    address: z.string().max(500).optional(),
    phone: z.string().max(20).optional(),
    email: z.string().email().optional().or(z.literal('')),
    material: z.string().max(200).optional(),
    unitPrice: money.optional(),
    status: z.nativeEnum(VendorStatus).default(VendorStatus.ACTIVE),
    rating: z.coerce.number().int().min(0).max(5).default(0),
  }),
});
export const updateVendorSchema = z.object({
  params: z.object({ id: uuid }),
  body: createVendorSchema.shape.body.partial(),
});
export const listVendorsSchema = z.object({
  query: pagination.extend({ search: z.string().optional(), status: z.nativeEnum(VendorStatus).optional() }),
});

export const recordVendorPaymentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    amount: money,
    date: dateStr.optional(),
    mode: z.nativeEnum(PaymentMode),
    reference: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
    proofUrl: z.string().url().optional().or(z.literal('')),
  }),
});

// ═══ Quotations ═══
const lineItem = z.object({
  description: z.string().min(1).max(500),
  quantity: qty,
  unit: z.string().min(1).max(20),
  rate: money,
});

export const createQuotationSchema = z.object({
  body: z.object({
    vendorId: uuid,
    phaseId: uuid.optional(),
    quotationNumber: z.string().min(1).max(50),
    date: dateStr.optional(),
    status: z.nativeEnum(QuotationStatus).default(QuotationStatus.DRAFT),
    notes: z.string().max(1000).optional(),
    items: z.array(lineItem).min(1, 'At least one line item is required'),
  }),
});
export const updateQuotationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    vendorId: uuid.optional(),
    phaseId: uuid.optional(),
    quotationNumber: z.string().min(1).max(50).optional(),
    status: z.nativeEnum(QuotationStatus).optional(),
    notes: z.string().max(1000).optional(),
    items: z.array(lineItem).min(1).optional(),
  }),
});
export const listQuotationsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.nativeEnum(QuotationStatus).optional() }),
});

// ═══ Purchase Orders ═══
export const createPOSchema = z.object({
  body: z.object({
    vendorId: uuid,
    quotationId: uuid.optional(),
    phaseId: uuid.optional(),
    poNumber: z.string().min(1).max(50),
    date: dateStr.optional(),
    deliveryDate: dateStr.optional(),
    status: z.nativeEnum(POStatus).default(POStatus.DRAFT),
    notes: z.string().max(1000).optional(),
    items: z.array(lineItem).min(1, 'At least one line item is required'),
  }),
});
export const updatePOSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.nativeEnum(POStatus).optional(),
    deliveryDate: dateStr.optional(),
    notes: z.string().max(1000).optional(),
    items: z.array(lineItem).min(1).optional(),
  }),
});
export const listPOsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.nativeEnum(POStatus).optional() }),
});

// ═══ Vendor Invoices ═══
export const createInvoiceSchema = z.object({
  body: z.object({
    vendorId: uuid,
    poId: uuid.optional(),
    invoiceNumber: z.string().min(1).max(50),
    date: dateStr.optional(),
    amount: money,
    taxAmount: money.default(0),
    totalAmount: money,
    notes: z.string().max(1000).optional(),
  }),
});
export const updateInvoiceSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    verificationStatus: z.nativeEnum(InvoiceVerificationStatus).optional(),
    notes: z.string().max(1000).optional(),
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
    paymentMode: z.string().max(50).optional(), // configurable via DropdownOption
    notes: z.string().max(1000).optional(),
  }),
});
export const listPaymentRequestsSchema = z.object({
  query: pagination.extend({ vendorId: uuid.optional(), status: z.string().optional() }),
});
export const recordPaymentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    amount: money,
    mode: z.string().min(1).max(50), // configurable via DropdownOption
    reference: z.string().max(100).optional(),
  }),
});
export const approvalActionSchema = z.object({
  params: z.object({ stepId: uuid }),
  body: z.object({ comments: z.string().max(500).optional() }),
});

// ═══ Gate Passes ═══
const gatePassItem = z.object({
  description: z.string().min(1).max(500),
  quantity: qty,
  unit: z.string().min(1).max(20),
});
export const createGatePassSchema = z.object({
  body: z.object({
    vendorId: uuid,
    poId: uuid.optional(),
    invoiceId: uuid.optional(),
    passNumber: z.string().min(1).max(50),
    type: z.nativeEnum(GatePassType),
    date: dateStr.optional(),
    timeIn: z.string().max(10).optional(),
    vehicleNumber: z.string().max(20).optional(),
    driverName: z.string().max(100).optional(),
    driverPhone: z.string().max(20).optional(),
    carrierName: z.string().max(100).optional(),
    vehiclePhoto: z.string().max(500).optional(),
    approverId: uuid,
    items: z.array(gatePassItem).min(1, 'At least one item is required'),
  }),
});
export const updateGatePassSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.nativeEnum(GatePassStatus).optional(),
    timeIn: z.string().max(10).optional(),
    vehicleNumber: z.string().max(20).optional(),
    driverName: z.string().max(100).optional(),
    driverPhone: z.string().max(20).optional(),
    vehiclePhoto: z.string().max(500).optional(),
    approverId: uuid.optional(),
  }),
});
export const verifyGatePassOtpSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ otp: z.string().min(1).max(10) }),
});
export const listGatePassesSchema = z.object({
  query: pagination.extend({ type: z.nativeEnum(GatePassType).optional(), status: z.nativeEnum(GatePassStatus).optional() }),
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
    phaseId: uuid.optional(),
    activityId: uuid.optional(),
    category: z.string().min(1).max(100), // configurable via DropdownOption
    severity: z.nativeEnum(IssueSeverity).default(IssueSeverity.MEDIUM),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    assignedTo: uuid.optional(),
  }),
});
export const updateIssueSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    severity: z.nativeEnum(IssueSeverity).optional(), // workflow status — keep enum
    status: z.nativeEnum(IssueStatus).optional(), // workflow status — keep enum
    category: z.string().min(1).max(100).optional(), // configurable
    resolution: z.string().max(2000).optional(),
    assignedTo: uuid.optional().nullable(),
  }),
});
export const listIssuesSchema = z.object({
  query: pagination.extend({
    status: z.nativeEnum(IssueStatus).optional(),
    severity: z.nativeEnum(IssueSeverity).optional(),
  }),
});

// ═══ Inspections ═══
export const createInspectionSchema = z.object({
  body: z.object({
    phaseId: uuid.optional(),
    activityId: uuid.optional(),
    scheduledDate: dateStr.optional(),
  }),
});
export const updateInspectionSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
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
    entityType: z.string().min(1).max(50),
    entityId: uuid,
    fileName: z.string().min(1).max(255),
    filePath: z.string().min(1),
    fileType: z.string().min(1).max(50), // configurable via DropdownOption
    mimeType: z.string().min(1).max(100),
  }),
});
export const updateDocumentSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ status: z.nativeEnum(DocumentStatus).optional() }),
});
export const listDocumentsSchema = z.object({
  query: pagination.extend({
    entityType: z.string().optional(),
    entityId: uuid.optional(),
    fileType: z.string().max(50).optional(), // configurable
  }),
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

// ═══ Labour Attendance ═══
export const createLabourAttendanceSchema = z.object({
  body: z.object({
    phaseId: uuid.optional(),
    activityId: uuid.optional(),
    date: dateStr,
    headcount: z.coerce.number().int().min(1),
    category: z.string().min(1).max(100), // configurable via DropdownOption
    cost: money,
    notes: z.string().max(500).optional(),
  }),
});
export const listLabourSchema = z.object({
  query: pagination.extend({
    phaseId: uuid.optional(),
    category: z.string().max(100).optional(),
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
  }),
});
export const updateLabourSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    date: dateStr.optional(),
    headcount: z.coerce.number().int().min(1).optional(),
    category: z.string().min(1).max(100).optional(),
    cost: money.optional(),
    phaseId: uuid.optional().nullable(),
    activityId: uuid.optional().nullable(),
    notes: z.string().max(500).optional(),
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
