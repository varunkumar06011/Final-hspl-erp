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
  StockStatus,
} from '../enums.js';

const uuid = z.string().uuid();
const money = z.coerce.number().finite().min(0);
const positiveMoney = z.coerce.number().finite().gt(0);
const qty = z.coerce.number().finite().min(0);
const positiveQty = z.coerce.number().finite().gt(0);
const dateStr = z.coerce.date();
const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);
const acknowledgement = z.preprocess(
  (value) => value === true || value === 'true',
  z.literal(true, { errorMap: () => ({ message: 'Acknowledgement is required' }) }),
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
  query: pagination.extend({
    search: z.string().optional(),
    status: z.nativeEnum(VendorStatus).optional(),
  }),
});

// ═══ Quotations ═══
const quotationLineItem = z.object({
  materialName: nonEmptyText(200),
  quantity: positiveQty,
  unit: z.string().trim().max(20).optional(),
  unitPrice: money,
});

// Accept items as JSON string (multipart/form-data) or array (JSON body)
const itemsField = z.preprocess(
  (val) => (typeof val === 'string' ? JSON.parse(val) : val),
  z.array(quotationLineItem).min(1, 'At least one line item is required'),
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
      z.array(quotationLineItem).min(1).optional(),
    ),
    gstAmount: money.optional(),
  }),
});
export const listQuotationsSchema = z.object({
  query: pagination.extend({
    vendorId: uuid.optional(),
    status: z.nativeEnum(QuotationStatus).optional(),
  }),
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
  query: pagination.extend({
    vendorId: uuid.optional(),
    status: z.nativeEnum(POStatus).optional(),
  }),
});

// ═══ Project Settings ═══
export const updateProjectSettingsSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Hospital name is required').max(200).optional(),
    officeAddress: z.string().max(1000).optional(),
    hospitalAddress: z.string().max(1000).optional(),
    gstNumber: z.string().max(50).optional(),
    totalBudget: z.coerce.number().min(0).optional(),
  }),
});

// ═══ Vendor Invoices ═══
export const createInvoiceSchema = z
  .object({
    body: z.object({
      vendorId: uuid,
      poId: uuid.optional(),
      invoiceNumber: z.string().trim().max(50).optional(),
      amount: positiveMoney,
      taxAmount: money.default(0),
      totalAmount: positiveMoney,
      advancePaid: money.optional(),
      advanceType: z.string().trim().max(50).optional(),
      advanceOtherType: z.string().trim().max(100).optional(),
      deliveryDate: dateStr.optional(),
      acknowledged: acknowledgement,
    }),
  })
  .superRefine((data, ctx) => {
    const { amount, taxAmount, totalAmount, advancePaid = 0 } = data.body;
    if (Math.abs(Number(totalAmount) - (Number(amount) + Number(taxAmount))) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'totalAmount'],
        message: 'Total amount must equal invoice amount plus tax amount',
      });
    }
    if (Number(advancePaid) > Number(totalAmount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'advancePaid'],
        message: `Advance paid (${advancePaid}) cannot exceed invoice total (${totalAmount})`,
      });
    }
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
    requestNumber: nonEmptyText(50),
    amount: positiveMoney,
    paymentMode: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(1000).optional(),
  }),
});
export const createExpenseSchema = z.object({
  body: z.object({
    description: nonEmptyText(500),
    amount: positiveMoney,
    category: nonEmptyText(100),
    expenseDate: dateStr.optional(),
    paymentMode: z.string().trim().max(50).optional(),
  }),
});
export const listPaymentRequestsSchema = z.object({
  query: pagination.extend({
    vendorId: uuid.optional(),
    status: z.string().optional(),
    type: z.string().optional(),
  }),
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
const gatePassItem = z.object({
  materialName: nonEmptyText(200),
  quantity: positiveQty,
  unit: z.string().trim().max(20).nullable().optional(),
});
export const createGatePassSchema = z.object({
  body: z.object({
    gatePassCategory: z.enum(['MATERIAL', 'VISITOR']).default('MATERIAL'),
    poId: uuid.optional(),
    items: z.preprocess(
      (value) => (typeof value === 'string' ? JSON.parse(value) : value),
      z.array(gatePassItem).optional(),
    ),
    invoiceId: uuid.optional(),
    otpRequestedFor: uuid,
    visitorName: z.string().trim().max(200).optional(),
    visitorPhone: z.string().trim().max(30).optional(),
    visitDate: dateStr.optional(),
    visitTime: z.string().trim().max(20).optional(),
    purpose: z.string().trim().max(500).optional(),
    vehicleType: z.string().trim().max(50).optional(),
    vehicleNumber: z.string().trim().max(50).optional(),
    driverName: z.string().trim().max(200).optional(),
    driverMobile: z.string().trim().max(30).optional(),
    materialMovement: z
      .preprocess((value) => value === true || value === 'true', z.boolean())
      .default(true),
    gatePassType: z.enum(['RETURNABLE', 'NON_RETURNABLE']).default('NON_RETURNABLE'),
    photoProofPath: z.string().trim().max(1000).optional(),
    remarks: z.string().trim().max(1000).optional(),
  }),
}).superRefine((data, ctx) => {
  const body = data.body;
  if (body.gatePassCategory === 'VISITOR' && !body.visitorName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body', 'visitorName'], message: 'Visitor name is required' });
  }
  if (body.gatePassCategory === 'MATERIAL' && !body.poId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body', 'poId'], message: 'Purchase order is required for a material gatepass' });
  }
});
export const listGatePassesSchema = z.object({
  query: pagination.extend({ status: z.string().optional() }),
});
export const verifyGatePassOtpSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({ idToken: z.string().min(1, 'Firebase ID token is required') }),
});

// ═══ Goods Receipts ═══
const goodsReceiptDispositionItem = z.object({
  id: uuid,
  acceptedQty: qty,
  rejectedQty: qty,
  rejectionReason: z.string().trim().max(500).optional(),
});
export const createGoodsReceiptSchema = z.object({
  body: z.object({ gatePassId: uuid }),
});
export const inspectGoodsReceiptSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    items: z.preprocess(
      (value) => (typeof value === 'string' ? JSON.parse(value) : value),
      z.array(goodsReceiptDispositionItem).min(1),
    ),
  }),
});
export const postGoodsReceiptSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({}),
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
    quantity: z.coerce
      .number()
      .finite()
      .refine((v) => v !== 0, 'Quantity cannot be zero'),
    notes: z.string().max(500).optional(),
  }),
});
export const listInventorySchema = z.object({
  query: pagination.extend({ search: z.string().optional(), category: z.string().optional() }),
});
export const listInventoryTxnsSchema = z.object({
  query: pagination.extend({
    itemId: uuid.optional(),
    type: z.nativeEnum(InventoryTxnType).optional(),
  }),
});

// ═══ Phases & Activities ═══
export const createPhaseSchema = z
  .object({
    body: z.object({
      name: nonEmptyText(200),
      plannedStart: dateStr.optional(),
      plannedEnd: dateStr.optional(),
      budgetAmount: money.default(0),
      status: z.nativeEnum(PhaseStatus).default(PhaseStatus.NOT_STARTED),
    }),
  })
  .superRefine((data, ctx) => {
    if (
      data.body.plannedStart &&
      data.body.plannedEnd &&
      data.body.plannedEnd < data.body.plannedStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'plannedEnd'],
        message: 'Planned end date cannot be before planned start date',
      });
    }
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
export const createActivitySchema = z
  .object({
    body: z.object({
      phaseId: uuid,
      name: nonEmptyText(200),
      plannedStart: dateStr.optional(),
      plannedEnd: dateStr.optional(),
      assignedVendorId: uuid.optional(),
      budgetAmount: money.default(0),
      status: z.nativeEnum(ActivityStatus).default(ActivityStatus.NOT_STARTED),
    }),
  })
  .superRefine((data, ctx) => {
    if (
      data.body.plannedStart &&
      data.body.plannedEnd &&
      data.body.plannedEnd < data.body.plannedStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'plannedEnd'],
        message: 'Planned end date cannot be before planned start date',
      });
    }
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
    category: nonEmptyText(100),
    severity: z.nativeEnum(IssueSeverity).default(IssueSeverity.MEDIUM),
    title: nonEmptyText(200),
    description: z.string().trim().max(2000).optional(),
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
    name: nonEmptyText(200),
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
  name: nonEmptyText(200),
  dueDate: dateStr.optional(),
  amount: money,
});
export const createContractSchema = z
  .object({
    body: z.object({
      vendorId: uuid,
      type: nonEmptyText(100),
      startDate: dateStr,
      endDate: dateStr.optional(),
      value: money,
      advancePercent: z.coerce.number().finite().min(0).max(100).default(0),
      retentionPercent: z.coerce.number().finite().min(0).max(100).default(0),
      milestones: z.array(milestone).optional(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.body.endDate && data.body.endDate < data.body.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'endDate'],
        message: 'End date cannot be before start date',
      });
    }
  });
export const updateContractSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    status: z.nativeEnum(ContractStatus).optional(),
    endDate: dateStr.optional(),
  }),
});
export const listContractsSchema = z.object({
  query: pagination.extend({
    vendorId: uuid.optional(),
    status: z.nativeEnum(ContractStatus).optional(),
  }),
});

// ═══ Attendance (Staff + Daily Attendance) ═══
export const createStaffSchema = z.object({
  body: z.object({
    name: nonEmptyText(200),
    type: z.enum(['COMPANY', 'LABOUR']),
    role: z.string().trim().max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+() .-]{7,20}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('')),
    baseSalary: money,
  }),
});
export const updateStaffSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+() .-]{7,20}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('')),
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
    records: z
      .array(
        z.object({
          staffId: uuid,
          present: z.boolean(),
          notes: z.string().max(500).optional(),
        }),
      )
      .min(1),
  }),
});
export const listAttendanceSchema = z
  .object({
    query: pagination.extend({
      staffId: uuid.optional(),
      type: z.enum(['COMPANY', 'LABOUR']).optional(),
      startDate: dateStr.optional(),
      endDate: dateStr.optional(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.query.startDate && data.query.endDate && data.query.endDate < data.query.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query', 'endDate'],
        message: 'End date cannot be before start date',
      });
    }
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
