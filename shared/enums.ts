// ═══════════════════════════════════════════════════════════
// Enums — defined ONCE here, imported by both frontend and backend
// Prisma schema and frontend dropdowns/badges both reference this file
// ═══════════════════════════════════════════════════════════

export enum UserRole {
  SUPERVISOR = 'SUPERVISOR',
  PROJECT_HEAD = 'PROJECT_HEAD',
  HEAD_OF_CONSTRUCTION = 'HEAD_OF_CONSTRUCTION',
  ADMIN = 'ADMIN',
  ADMIN_2 = 'ADMIN_2',
}

export const APPROVER_ROLES = [
  UserRole.PROJECT_HEAD,
  UserRole.HEAD_OF_CONSTRUCTION,
  UserRole.ADMIN,
  UserRole.ADMIN_2,
] as const;

export enum ProjectStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum VendorStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLACKLISTED = 'BLACKLISTED',
}

export enum VendorCategory {
  LABOUR_SUPPLIER = 'LABOUR_SUPPLIER',
  ELECTRICAL_CONTRACTOR = 'ELECTRICAL_CONTRACTOR',
  WOOD_WORK_CONTRACTOR = 'WOOD_WORK_CONTRACTOR',
  MACHINERY_SUPPLIER = 'MACHINERY_SUPPLIER',
  TOOL_SUPPLIER = 'TOOL_SUPPLIER',
  MATERIAL_SUPPLIER = 'MATERIAL_SUPPLIER',
  SUBCONTRACTOR = 'SUBCONTRACTOR',
  SERVICE_PROVIDER = 'SERVICE_PROVIDER',
  EQUIPMENT_SUPPLIER = 'EQUIPMENT_SUPPLIER',
  OTHER = 'OTHER',
}

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONVERTED_TO_PO = 'CONVERTED_TO_PO',
}

export enum POStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  DELIVERED = 'DELIVERED',
  PARTIALLY_DELIVERED = 'PARTIALLY_DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum InvoiceVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED',
  OTHER = 'OTHER',
}

export enum StockStatus {
  PENDING = 'PENDING',
  RECEIVED = 'RECEIVED',
  ON_THE_WAY = 'ON_THE_WAY',
  YET_TO_START = 'YET_TO_START',
}

export enum PaymentMode {
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  CASH = 'CASH',
  UPI = 'UPI',
  DD = 'DD',
}

export enum ApprovalStatus {
  CREATED = 'CREATED',
  VERIFICATION = 'VERIFICATION',
  APPROVAL_1 = 'APPROVAL_1',
  APPROVAL_2 = 'APPROVAL_2',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

export enum ApprovalStepStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum InventoryTxnType {
  IN = 'IN',
  OUT = 'OUT',
  ADJUST = 'ADJUST',
}

export enum PhaseStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DELAYED = 'DELAYED',
  ON_HOLD = 'ON_HOLD',
}

export enum ActivityStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DELAYED = 'DELAYED',
  ON_HOLD = 'ON_HOLD',
}

export enum PhotoTag {
  BEFORE = 'BEFORE',
  DURING = 'DURING',
  AFTER = 'AFTER',
}

export enum IssueCategory {
  MATERIAL = 'MATERIAL',
  LABOUR = 'LABOUR',
  WEATHER = 'WEATHER',
  DESIGN = 'DESIGN',
  PERMIT = 'PERMIT',
  QUALITY = 'QUALITY',
  SAFETY = 'SAFETY',
  OTHER = 'OTHER',
}

export enum IssueSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum InspectionStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  DEFECTS_FOUND = 'DEFECTS_FOUND',
  CORRECTIVE_ACTION = 'CORRECTIVE_ACTION',
  RE_INSPECTION = 'RE_INSPECTION',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
}

export enum GatePassType {
  INWARD = 'INWARD',
  OUTWARD = 'OUTWARD',
}

export enum GatePassStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum GoodsReceiptStatus {
  PENDING_INSPECTION = 'PENDING_INSPECTION',
  READY_TO_POST = 'READY_TO_POST',
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
}

export enum IssueStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum DocumentStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ContractType {
  FIXED_PRICE = 'FIXED_PRICE',
  TIME_MATERIAL = 'TIME_MATERIAL',
  LUMP_SUM = 'LUMP_SUM',
  UNIT_RATE = 'UNIT_RATE',
}

export enum ContractStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  TERMINATED = 'TERMINATED',
  ON_HOLD = 'ON_HOLD',
}

export enum MilestoneStatus {
  PENDING = 'PENDING',
  INVOICED = 'INVOICED',
  PAID = 'PAID',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

// ═══════════════════════════════════════════════════════════
// Permission Matrix
// ═══════════════════════════════════════════════════════════

export enum Permission {
  // Financial
  CREATE_VENDOR = 'CREATE_VENDOR',
  CREATE_QUOTATION = 'CREATE_QUOTATION',
  CREATE_PO = 'CREATE_PO',
  VERIFY_INVOICE = 'VERIFY_INVOICE',
  APPROVE_PAYMENT_STEP_1 = 'APPROVE_PAYMENT_STEP_1',
  APPROVE_PAYMENT_STEP_2 = 'APPROVE_PAYMENT_STEP_2',
  VIEW_FINANCIALS = 'VIEW_FINANCIALS',
  EDIT_BUDGET = 'EDIT_BUDGET',
  // User management
  MANAGE_USERS = 'MANAGE_USERS',
  // Approvals config
  MANAGE_APPROVALS_CONFIG = 'MANAGE_APPROVALS_CONFIG',
  // Payments
  CREATE_PAYMENT = 'CREATE_PAYMENT',
  // Site operations
  CREATE_GATE_PASS = 'CREATE_GATE_PASS',
  MANAGE_INVENTORY = 'MANAGE_INVENTORY',
  // Construction
  MANAGE_PHASES = 'MANAGE_PHASES',
  MANAGE_ACTIVITIES = 'MANAGE_ACTIVITIES',
  UPLOAD_PHOTOS = 'UPLOAD_PHOTOS',
  MANAGE_ISSUES = 'MANAGE_ISSUES',
  MANAGE_INSPECTIONS = 'MANAGE_INSPECTIONS',
  // Governance
  MANAGE_DOCUMENTS = 'MANAGE_DOCUMENTS',
  MANAGE_CONTRACTS = 'MANAGE_CONTRACTS',
  MANAGE_LABOUR = 'MANAGE_LABOUR',
  // Audit
  VIEW_AUDIT_LOG = 'VIEW_AUDIT_LOG',
}

export const PERMISSION_MATRIX: Record<UserRole, Permission[]> = {
  [UserRole.SUPERVISOR]: [
    Permission.CREATE_VENDOR,
    Permission.CREATE_QUOTATION,
    Permission.CREATE_PO,
    Permission.VERIFY_INVOICE,
    Permission.VIEW_FINANCIALS,
    Permission.CREATE_GATE_PASS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PHASES,
    Permission.MANAGE_ACTIVITIES,
    Permission.UPLOAD_PHOTOS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_INSPECTIONS,
    Permission.MANAGE_DOCUMENTS,
    Permission.MANAGE_CONTRACTS,
    Permission.MANAGE_LABOUR,
    Permission.VIEW_AUDIT_LOG,
  ],
  [UserRole.PROJECT_HEAD]: [
    Permission.CREATE_VENDOR,
    Permission.CREATE_QUOTATION,
    Permission.CREATE_PO,
    Permission.VERIFY_INVOICE,
    Permission.APPROVE_PAYMENT_STEP_1,
    Permission.VIEW_FINANCIALS,
    Permission.EDIT_BUDGET,
    Permission.MANAGE_USERS,
    Permission.MANAGE_APPROVALS_CONFIG,
    Permission.CREATE_GATE_PASS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PHASES,
    Permission.MANAGE_ACTIVITIES,
    Permission.UPLOAD_PHOTOS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_INSPECTIONS,
    Permission.MANAGE_DOCUMENTS,
    Permission.MANAGE_CONTRACTS,
    Permission.MANAGE_LABOUR,
    Permission.VIEW_AUDIT_LOG,
  ],
  [UserRole.HEAD_OF_CONSTRUCTION]: [
    Permission.CREATE_VENDOR,
    Permission.CREATE_QUOTATION,
    Permission.CREATE_PO,
    Permission.VERIFY_INVOICE,
    Permission.APPROVE_PAYMENT_STEP_2,
    Permission.VIEW_FINANCIALS,
    Permission.VIEW_AUDIT_LOG,
    Permission.MANAGE_USERS,
    Permission.CREATE_GATE_PASS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PHASES,
    Permission.MANAGE_ACTIVITIES,
    Permission.UPLOAD_PHOTOS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_INSPECTIONS,
    Permission.MANAGE_DOCUMENTS,
    Permission.MANAGE_LABOUR,
  ],
  [UserRole.ADMIN]: [
    Permission.CREATE_VENDOR,
    Permission.CREATE_QUOTATION,
    Permission.CREATE_PO,
    Permission.VERIFY_INVOICE,
    Permission.APPROVE_PAYMENT_STEP_1,
    Permission.VIEW_FINANCIALS,
    Permission.MANAGE_USERS,
    Permission.CREATE_GATE_PASS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PHASES,
    Permission.MANAGE_ACTIVITIES,
    Permission.UPLOAD_PHOTOS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_INSPECTIONS,
    Permission.MANAGE_DOCUMENTS,
    Permission.MANAGE_LABOUR,
  ],
  [UserRole.ADMIN_2]: [
    Permission.CREATE_VENDOR,
    Permission.CREATE_QUOTATION,
    Permission.CREATE_PO,
    Permission.VERIFY_INVOICE,
    Permission.APPROVE_PAYMENT_STEP_2,
    Permission.VIEW_FINANCIALS,
    Permission.MANAGE_USERS,
    Permission.CREATE_GATE_PASS,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_PHASES,
    Permission.MANAGE_ACTIVITIES,
    Permission.UPLOAD_PHOTOS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_INSPECTIONS,
    Permission.MANAGE_DOCUMENTS,
    Permission.MANAGE_LABOUR,
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}
