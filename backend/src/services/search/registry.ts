import { Permission } from '@hospital-erp/shared';

/**
 * Presentation + access rules for the search index.
 *
 * What gets INDEXED is never listed here: the indexer reads the Prisma schema
 * and picks up every model and text/number/date column automatically, so new
 * tables and fields are searchable the moment they are migrated.
 *
 * This file only answers two questions the schema cannot:
 *   1. Where does a result open in the app, and who may see it?   (REGISTRY)
 *   2. Which tables are deliberately kept out of search?          (EXCLUDED_MODELS)
 *
 * A model with no REGISTRY entry is still indexed and still searchable; its
 * results are shown to admin roles only, with a humanised name and no link.
 * Adding a page for it later is a one-line entry below.
 */

export interface EntityRegistration {
  /** Human type name shown on results ("Purchase Order"). Defaults to the humanised model name. */
  label?: string;
  /** In-app route that opens the record. `row` holds the record's scalar columns. */
  path?: (id: string, row: Record<string, unknown>) => string | null;
  /** Permission required to see these results — mirror the module's list endpoint. */
  permission?: Permission;
  /** Preferred columns for the result title, first non-empty wins. Derived from the schema when omitted. */
  title?: string[];
  /** Extra columns appended to the subtitle. */
  subtitle?: string[];
}

const byId =
  (base: string) =>
  (id: string): string =>
    `${base}?id=${id}`;

export const REGISTRY: Record<string, EntityRegistration> = {
  Vendor: { path: byId('/vendors'), permission: Permission.VIEW_FINANCIALS, title: ['name'], subtitle: ['vendorCode'] },
  Quotation: { path: byId('/quotations'), permission: Permission.VIEW_FINANCIALS, title: ['quotationNumber'] },
  PurchaseOrder: { label: 'Purchase Order', path: byId('/pos'), permission: Permission.VIEW_FINANCIALS, title: ['poNumber'] },
  VendorInvoice: { label: 'Invoice', path: byId('/invoices'), permission: Permission.VIEW_FINANCIALS, title: ['invoiceCode', 'invoiceNumber'], subtitle: ['invoiceNumber'] },
  PaymentRequest: { label: 'Payment Request', path: byId('/payments'), permission: Permission.VIEW_FINANCIALS, title: ['paymentCode', 'requestNumber'] },
  PaymentSheet: { label: 'Payment Sheet', path: () => '/payments', permission: Permission.VIEW_FINANCIALS },
  JournalVoucher: { label: 'Voucher', path: byId('/vouchers'), permission: Permission.VIEW_FINANCIALS, title: ['jvNumber'] },
  Ledger: { path: byId('/ledgers'), permission: Permission.VIEW_FINANCIALS },
  BankAccount: { label: 'Bank Account', path: byId('/bank-accounts'), permission: Permission.VIEW_FINANCIALS, title: ['accountName'], subtitle: ['bankName', 'accountNumber'] },
  CashAccount: { label: 'Cash Account', path: byId('/cash-accounts'), permission: Permission.VIEW_FINANCIALS },
  OwnerAccount: { label: 'Owner Account', path: byId('/owner-accounts'), permission: Permission.VIEW_FINANCIALS, title: ['ownerName'] },
  BudgetHead: { label: 'Budget Head', path: byId('/budget-heads'), permission: Permission.VIEW_FINANCIALS, title: ['particulars'] },
  BudgetRevision: {
    label: 'Budget Revision',
    path: (_id, row) => (row.budgetHeadId ? `/budget-heads?id=${row.budgetHeadId}` : '/budget-heads'),
    permission: Permission.VIEW_FINANCIALS,
    title: ['newParticulars', 'oldParticulars'],
  },
  Contract: { path: byId('/contracts'), permission: Permission.VIEW_FINANCIALS },
  GoodsReceipt: { label: 'Goods Receipt', path: byId('/goods-receipts'), permission: Permission.VIEW_FINANCIALS, title: ['receiptNumber'] },
  StockEntry: { label: 'Stock Entry', path: () => '/inventory', permission: Permission.MANAGE_INVENTORY, title: ['entryNumber'] },
  GatePass: { label: 'Gate Pass', path: byId('/gate-passes'), permission: Permission.VIEW_GATE_PASSES, title: ['passNumber'] },
  MaterialPurchaseRequest: { label: 'Material Request', path: byId('/material-purchase-requests'), permission: Permission.VIEW_MPR, title: ['mprNumber'] },
  InventoryItem: { label: 'Inventory Item', path: (id) => `/assets/${id}`, title: ['name'], subtitle: ['sku', 'category'] },
  Asset: {
    path: (_id, row) => (row.inventoryItemId ? `/assets/${row.inventoryItemId}` : '/assets'),
    permission: Permission.MANAGE_INVENTORY,
    title: ['assetId'],
    subtitle: ['serialNumber'],
  },
  WorkTask: { label: 'Work Task', path: byId('/work'), title: ['title'] },
  Issue: { path: byId('/issues'), title: ['title'] },
  Inspection: { path: byId('/inspections') },
  Staff: { label: 'Labour', path: byId('/labour') },
  SitePhoto: { label: 'Site Photo', path: byId('/photos'), title: ['caption'] },
};

/**
 * Tables intentionally kept out of search, with the reason. Everything else in
 * the schema is indexed automatically. (A test fails if a model is neither
 * indexable nor listed here, so new tables are always a conscious decision.)
 */
export const EXCLUDED_MODELS: Record<string, string> = {
  User: 'shared across projects; managed from the Users page',
  Document: 'general documents can be PIN-locked; their names must not leak through search',
  Project: 'the tenant itself, not project data',
  PushSubscription: 'device tokens',
  AppNotification: 'per-user inbox, not shared records',
  AuditLog: 'system trail with raw JSON snapshots; has its own page',
  AssetScan: 'high-volume scan log',
  AssetMovement: 'high-volume movement log',
  ApprovalWorkflow: 'plumbing; approvals surface on the record they belong to',
  ApprovalStep: 'plumbing; approvals surface on the record they belong to',
  LedgerEntry: 'derived copy of voucher lines',
  POItemLedgerPost: 'link table',
  StaffAttendance: 'daily log',
  LedgerCustomGroup: 'chart-of-accounts grouping label',
  PaymentSheetNarration: 'free-form page note',
  DropdownOption: 'configuration values',
  BankTransaction: 'high-volume ledger rows; use the Transaction Register',
  CashTransaction: 'high-volume ledger rows; use the Transaction Register',
  InventoryTransaction: 'high-volume stock ledger',
  BillSettlement: 'link table',
  WorkTaskQuotation: 'link table',
  AssistantAction: 'AI assistant action log; per-user, not shared records',
  ChatConversation: 'private conversations; only members may read them',
  ChatMember: 'private conversations; only members may read them',
  ChatMessage: 'private conversations; only members may read them',
  ChatAttachment: 'private conversations; only members may read them',
};

/**
 * Columns never indexed, whatever the model: secrets, credentials, storage
 * paths and technical blobs. Matched against the column name.
 */
export const SENSITIVE_COLUMN =
  /hash|token|password|secret|otp|signature|firebase|filepath|url|photoproof|mimetype|useragent|regeneration|mentions|prefs|snapshot/i;

/** Limits that keep one record from dominating memory or results. */
export const LIMITS = {
  childrenPerParent: 80,
  charsPerSection: 400,
  sectionsPerDoc: 120,
  jsonStringsPerField: 40,
  maxResults: 100,
  residentProjects: 6,
} as const;
