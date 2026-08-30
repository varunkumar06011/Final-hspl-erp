import { z } from 'zod';
import {
  VendorStatus,
  QuotationStatus,
  POStatus,
  InvoiceVerificationStatus,
  InventoryTxnType,
  InventoryItemType,
  AssetStatus,
  PhaseStatus,
  ActivityStatus,
  PhotoTag,
  IssueSeverity,
  WorkTaskType,
  WorkTaskStatus,
  WorkTaskPriority,
  InspectionStatus,
  ContractStatus,
  POPaymentType,
  BudgetHeadStatus,
  BankTxnType,
  CashTxnType,
  JVType,
  JournalAccountType,
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
  gstRate: z.coerce.number().finite().min(0).max(100).default(0),
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
    acknowledged: acknowledgement,
    workTaskId: uuid.optional(),
  }),
});
export const updateQuotationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    items: z.preprocess(
      (val) => (val === undefined ? undefined : typeof val === 'string' ? JSON.parse(val) : val),
      z.array(quotationLineItem).min(1).optional(),
    ),
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
    paymentType: z.nativeEnum(POPaymentType),
    paymentTerms: z.string().max(500).optional(),
    deliveryDate: z.coerce.date().optional().or(z.literal('').transform(() => undefined)),
    acknowledged: acknowledgement,
    budgetHeadId: uuid.optional(),
  }),
});
export const updatePOSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({}),
});
export const editPOSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    items: z.array(z.object({
      materialName: z.string().min(1).max(200),
      quantity: qty,
      unit: z.string().min(1).max(20),
      unitPrice: money,
      gstRate: z.coerce.number().min(0).max(100),
    })).min(1, 'At least one item is required'),
    editReason: z.string().min(1, 'Edit reason is required').max(500),
  }),
});
export const regeneratePOSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({}).optional(),
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
      cgstAmount: money.optional(),
      sgstAmount: money.optional(),
      igstAmount: money.optional(),
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
    cgstAmount: money.optional(),
    sgstAmount: money.optional(),
    igstAmount: money.optional(),
    totalAmount: money.optional(),
    advancePaid: money.optional(),
    advanceType: z.string().max(50).optional(),
    advanceOtherType: z.string().max(100).optional(),
    deliveryDate: dateStr.optional(),
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
    budgetHeadId: uuid.optional(),
  }),
});
export const createExpenseSchema = z.object({
  body: z.object({
    description: nonEmptyText(500),
    amount: positiveMoney,
    category: nonEmptyText(100),
    expenseDate: dateStr.optional(),
    paymentMode: z.string().trim().max(50).optional(),
    budgetHeadId: uuid.optional(),
  }),
});
export const createAdvancePaymentSchema = z.object({
  body: z.object({
    poId: uuid,
    vendorId: uuid,
    requestNumber: nonEmptyText(50),
    amount: positiveMoney,
    paymentMode: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(1000).optional(),
    acknowledged: acknowledgement,
    budgetHeadId: uuid.optional(),
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
    bankAccountId: uuid.optional(),
    cashAccountId: uuid.optional(),
  }),
  // ── E11: Require at least one ledger account (bank or cash) ──
  // Without this, a payment can be recorded without touching any account,
  // breaking the "every payment posts to a real account" rule.
}).refine(
  (data) => !!data.body.bankAccountId || !!data.body.cashAccountId,
  { message: 'Either bankAccountId or cashAccountId is required to record a payment', path: ['body'] },
);
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
    vehicleType: z.enum(['LORRY', 'TRUCK', 'MINI_TRUCK', 'TRAILER', 'CAR', 'BIKE', 'AUTO', 'VAN', 'OTHER']).optional(),
    vehicleNumber: z.string().trim().max(20).optional(),
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
  if (body.gatePassCategory === 'MATERIAL') {
    if (!body.poId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body', 'poId'], message: 'Purchase order is required for a material gatepass' });
    }
    if (!body.vehicleType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body', 'vehicleType'], message: 'Vehicle type is required for a material gatepass' });
    }
    if (body.vehicleNumber && !/^[A-Z]{2}[- ]?\d{1,2}[- ]?[A-Z]{1,3}[- ]?\d{1,4}$/i.test(body.vehicleNumber)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body', 'vehicleNumber'], message: 'Enter a valid vehicle number, for example AP39AB1234' });
    }
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
const goodsReceiptDeliveredItem = z.object({
  materialName: nonEmptyText(200),
  deliveredQty: qty,
  unit: z.string().trim().max(20).nullable().optional(),
});
const goodsReceiptDispositionItem = z.object({
  id: uuid,
  acceptedQty: qty,
  rejectedQty: qty,
  rejectionReason: z.string().trim().max(500).optional(),
  itemType: z.nativeEnum(InventoryItemType).default(InventoryItemType.CONSUMABLE),
});
export const createGoodsReceiptSchema = z.object({
  body: z.object({
    gatePassId: uuid,
    items: z.preprocess(
      (value) => (typeof value === 'string' ? JSON.parse(value) : value),
      z.array(goodsReceiptDeliveredItem).min(1),
    ),
  }),
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
    itemType: z.nativeEnum(InventoryItemType).default(InventoryItemType.CONSUMABLE),
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
  query: pagination.extend({ search: z.string().optional(), category: z.string().optional(), itemType: z.nativeEnum(InventoryItemType).optional() }),
});
export const listInventoryTxnsSchema = z.object({
  query: pagination.extend({
    itemId: uuid.optional(),
    type: z.nativeEnum(InventoryTxnType).optional(),
  }),
});

// ═══ Assets ═══
export const listAssetsSchema = z.object({
  query: pagination.extend({
    inventoryItemId: uuid.optional(),
    status: z.nativeEnum(AssetStatus).optional(),
    location: z.string().optional(),
    search: z.string().optional(),
    category: z.string().optional(),
    warrantyExpiring: z.coerce.number().optional(), // days threshold
    amcExpiring: z.coerce.number().optional(), // days threshold
  }),
});
export const updateAssetSerialSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    serialNumber: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
  }),
});
export const updateAssetDetailsSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    serialNumber: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
    udi: z.string().max(200).optional(),
    gtin: z.string().max(200).optional(),
    warrantyExpiry: z.string().datetime().optional(),
    amcVendor: z.string().max(200).optional(),
    amcExpiry: z.string().datetime().optional(),
    usefulLifeYears: z.coerce.number().finite().min(0).max(100).optional(),
    depreciationMethod: z.enum(['STRAIGHT_LINE', 'WRITTEN_DOWN_VALUE']).optional(),
    salvageValue: money.optional(),
  }),
});
export const createAssetSchema = z.object({
  params: z.object({ itemId: uuid }),
  body: z.object({
    serialNumber: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
    location: z.string().min(1).max(200).default('Main Store'),
    udi: z.string().max(200).optional(),
    gtin: z.string().max(200).optional(),
    warrantyExpiry: z.string().datetime().optional(),
    amcVendor: z.string().max(200).optional(),
    amcExpiry: z.string().datetime().optional(),
    usefulLifeYears: z.coerce.number().finite().min(0).max(100).optional(),
    depreciationMethod: z.enum(['STRAIGHT_LINE', 'WRITTEN_DOWN_VALUE']).optional(),
    salvageValue: money.optional(),
    vendorName: z.string().max(200).optional(),
    poNumber: z.string().max(100).optional(),
    invoiceNumber: z.string().max(100).optional(),
    receiptNumber: z.string().max(100).optional(),
    unitPrice: money.optional(),
    totalCost: money.optional(),
    receiptDate: z.string().datetime().optional(),
  }),
});
export const issueAssetSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    issuedToDept: z.string().max(200).optional(),
    issuedToPerson: z.string().max(200).optional(),
    location: z.string().min(1).max(200),
    notes: z.string().max(500).optional(),
  }).refine((v) => v.issuedToDept || v.issuedToPerson, 'Either department or person must be provided'),
});
export const returnAssetSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    location: z.string().min(1).max(200).default('Main Store'),
    notes: z.string().max(500).optional(),
  }),
});
export const relocateAssetSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    location: z.string().min(1).max(200),
    reason: z.string().max(500).optional(),
  }),
});
export const sendMaintenanceSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    reason: z.string().min(1).max(500),
    maintenanceVendor: z.string().max(200).optional(),
    technician: z.string().max(200).optional(),
    notes: z.string().max(500).optional(),
    cost: money.optional(),
  }),
});
export const completeMaintenanceSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    completionNotes: z.string().max(500).optional(),
    finalCost: money.optional(),
    returnToLocation: z.string().max(200).optional(),
    issueDirectly: z.boolean().default(false),
    issuedToDept: z.string().max(200).optional(),
    issuedToPerson: z.string().max(200).optional(),
  }),
});
export const retireAssetSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    reason: z.string().min(1).max(500),
  }),
});
export const scanAssetSchema = z.object({
  params: z.object({ assetId: z.string().regex(/^VGH-AST-\d+$/) }),
  body: z.object({
    location: z.string().max(200).optional(),
  }).optional(),
});

export const generateAssetsSchema = z.object({
  params: z.object({ itemId: uuid }),
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
    status: z.string().optional(),
  }),
});
export const closeIssueSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    closureNotes: z.string().trim().max(2000).optional(),
  }),
});

// ═══ Work Tasks (calendar) ═══
const workTaskBody = z.object({
  title: nonEmptyText(200),
  description: z.string().trim().max(2000).optional(),
  type: z.nativeEnum(WorkTaskType).default(WorkTaskType.OTHER),
  priority: z.nativeEnum(WorkTaskPriority).default(WorkTaskPriority.MEDIUM),
  status: z.nativeEnum(WorkTaskStatus).default(WorkTaskStatus.PLANNED),
  scheduledDate: dateStr,
  deadlineDate: dateStr.optional(),
  assignedTo: uuid.optional(),
  assignedVendorId: uuid.optional(),
  linkedQuotationId: uuid.optional(),
  linkedPoId: uuid.optional(),
});
export const createWorkTaskSchema = z.object({
  body: workTaskBody,
});
export const updateWorkTaskSchema = z.object({
  params: z.object({ id: uuid }),
  body: workTaskBody.partial(),
});
export const listWorkTasksSchema = z.object({
  query: pagination.extend({
    status: z.nativeEnum(WorkTaskStatus).optional(),
    type: z.nativeEnum(WorkTaskType).optional(),
    priority: z.nativeEnum(WorkTaskPriority).optional(),
    assignedTo: uuid.optional(),
  }),
});
export const calendarWorkTasksSchema = z.object({
  query: z.object({
    startDate: dateStr,
    endDate: dateStr,
  }),
});

// Generate a quotation directly from a work task (Work tab). Reuses the same
// line-item shape as a normal quotation; the work task is linked afterwards.
export const generateWorkTaskQuotationSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    vendorId: uuid,
    items: itemsField,
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

// ═══════════════════════════════════════════════════════════
// Finance Module — Budget Heads, Bank, Cash
// ═══════════════════════════════════════════════════════════

// ── Budget Heads ──
export const createBudgetHeadSchema = z.object({
  body: z.object({
    slNo: z.coerce.number().int().min(1),
    particulars: nonEmptyText(200),
    allocatedAmount: positiveMoney,
  }),
});
export const updateBudgetHeadSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    slNo: z.coerce.number().int().min(1).optional(),
    particulars: nonEmptyText(200).optional(),
    allocatedAmount: money.optional(),
    status: z.nativeEnum(BudgetHeadStatus).optional(),
  }),
});
export const listBudgetHeadsSchema = z.object({
  query: pagination.extend({
    search: z.string().optional(),
    status: z.nativeEnum(BudgetHeadStatus).optional(),
  }),
});
export const importBudgetSchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          sl_no: z.coerce.number().int().min(1),
          particulars: z.string().min(1).max(200),
          amount: positiveMoney,
        }),
      )
      .min(1, 'At least one budget item is required'),
  }),
});

// ── Bank Accounts ──
export const createBankAccountSchema = z.object({
  body: z.object({
    accountName: nonEmptyText(200),
    bankName: z.string().max(200).optional(),
    accountNumber: z.string().max(50).optional(),
    ifscCode: z.string().max(15).optional(),
    openingBalance: money.default(0),
  }),
});
export const updateBankAccountSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    accountName: nonEmptyText(200).optional(),
    bankName: z.string().max(200).optional(),
    accountNumber: z.string().max(50).optional(),
    ifscCode: z.string().max(15).optional(),
    isActive: z.boolean().optional(),
  }),
});
export const listBankAccountsSchema = z.object({
  query: pagination.extend({
    search: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  }),
});
export const bankDepositSchema = z.object({
  body: z.object({
    amount: positiveMoney,
    date: dateStr.optional(),
    description: z.string().max(500).optional(),
  }),
});
export const bankWithdrawSchema = bankDepositSchema;
export const bankTransferSchema = z.object({
  body: z.object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: positiveMoney,
    date: dateStr.optional(),
    description: z.string().max(500).optional(),
  }),
});
export const listBankTransactionsSchema = z
  .object({
    query: pagination.extend({
      startDate: dateStr.optional(),
      endDate: dateStr.optional(),
      type: z.nativeEnum(BankTxnType).optional(),
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

// ── Cash Accounts ──
export const createCashAccountSchema = z.object({
  body: z.object({
    name: nonEmptyText(200),
    openingBalance: money.default(0),
  }),
});
export const updateCashAccountSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    name: nonEmptyText(200).optional(),
    isActive: z.boolean().optional(),
  }),
});
export const listCashAccountsSchema = z.object({
  query: pagination.extend({
    search: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  }),
});
export const cashTransferSchema = z.object({
  body: z.object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: positiveMoney,
    date: dateStr.optional(),
    description: z.string().max(500).optional(),
  }),
});
// Bank → Cash withdrawal (money leaves bank, enters cash)
export const bankToCashSchema = z.object({
  body: z.object({
    bankAccountId: uuid,
    cashAccountId: uuid,
    amount: positiveMoney,
    date: dateStr.optional(),
    description: z.string().max(500).optional(),
  }),
});
// Cash → Bank deposit (money leaves cash, enters bank)
export const cashToBankSchema = bankToCashSchema;
export const listCashTransactionsSchema = z
  .object({
    query: pagination.extend({
      startDate: dateStr.optional(),
      endDate: dateStr.optional(),
      type: z.nativeEnum(CashTxnType).optional(),
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

// ═══════════════════════════════════════════════════════════
// Finance Module — Journal Vouchers & Owner Account (Phase 2)
// ═══════════════════════════════════════════════════════════

// ── Owner Account ──
export const createOwnerAccountSchema = z.object({
  body: z.object({
    ownerName: nonEmptyText(200),
    openingBalance: money.default(0),
  }),
});
export const updateOwnerAccountSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    ownerName: nonEmptyText(200).optional(),
    isActive: z.boolean().optional(),
  }),
});
export const listOwnerAccountsSchema = z.object({
  query: pagination.extend({
    search: z.string().optional(),
  }),
});
// Owner contribution: money into company bank → owner balance increases
export const ownerContributionSchema = z.object({
  body: z.object({
    bankAccountId: uuid,
    amount: positiveMoney,
    date: dateStr.optional(),
    description: z.string().max(500).optional(),
  }),
});

// ── Journal Vouchers ──
const journalEntryInput = z.object({
  accountType: z.nativeEnum(JournalAccountType),
  accountId: uuid.optional(),      // bank/cash account ID if BANK/CASH
  budgetHeadId: uuid.optional(),   // if BUDGET_HEAD
  ownerAccountId: uuid.optional(), // if OWNER
  debit: money.default(0),
  credit: money.default(0),
  description: z.string().max(500).optional(),
});

export const createJournalVoucherSchema = z
  .object({
    body: z.object({
      type: z.nativeEnum(JVType),
      date: dateStr.optional(),
      description: z.string().max(1000).optional(),
      entries: z.array(journalEntryInput).min(2, 'At least 2 entries required (one debit, one credit)'),
    }),
  })
  .superRefine((data, ctx) => {
    const { entries } = data.body;
    const totalDebit = entries.reduce((sum, e) => sum + Number(e.debit), 0);
    const totalCredit = entries.reduce((sum, e) => sum + Number(e.credit), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'entries'],
        message: `Total debit (${totalDebit}) must equal total credit (${totalCredit})`,
      });
    }

    if (totalDebit <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body', 'entries'],
        message: 'Total debit/credit must be greater than 0',
      });
    }

    // Validate that accountId is provided for BANK/CASH entries
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if ((entry.accountType === JournalAccountType.BANK || entry.accountType === JournalAccountType.CASH) && !entry.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body', 'entries', i, 'accountId'],
          message: `Account ID is required for ${entry.accountType} entries`,
        });
      }
      if (entry.accountType === JournalAccountType.BUDGET_HEAD && !entry.budgetHeadId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body', 'entries', i, 'budgetHeadId'],
          message: 'Budget head ID is required for BUDGET_HEAD entries',
        });
      }
      if (entry.accountType === JournalAccountType.OWNER && !entry.ownerAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body', 'entries', i, 'ownerAccountId'],
          message: 'Owner account ID is required for OWNER entries',
        });
      }
      // Each entry should have either debit or credit, not both
      if (Number(entry.debit) > 0 && Number(entry.credit) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['body', 'entries', i],
          message: 'An entry cannot have both debit and credit',
        });
      }
    }
  });

export const listJournalVouchersSchema = z.object({
  query: pagination.extend({
    search: z.string().optional(),
    type: z.nativeEnum(JVType).optional(),
    status: z.string().optional(),
  }),
});
export const jvApprovalActionSchema = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    comments: z.string().max(1000).optional(),
    reason: z.string().max(1000).optional(),
  }),
});
