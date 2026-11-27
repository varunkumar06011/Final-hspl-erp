/**
 * Which ERP module a file upload belongs to, so Google Drive can file it in the
 * right sub-folder ("Quotations", "Payment Vouchers", ...) without every route
 * having to say so. A middleware records the module from the API path of each
 * request; routes that serve many modules (generic attachments) narrow it down
 * with `setStorageModule(entityType)`.
 */
import { AsyncLocalStorage, AsyncResource } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface StorageContext {
  module: string;
}

const als = new AsyncLocalStorage<StorageContext>();

/** Folder name per first API path segment (`/api/<segment>/...`). */
const MODULE_BY_PATH: Record<string, string> = {
  quotations: 'Quotations',
  'purchase-orders': 'Purchase Orders',
  contracts: 'Purchase Orders',
  invoices: 'Vendor Invoices',
  payments: 'Payment Requests',
  'payment-sheets': 'Payment Sheets',
  vouchers: 'Payment Vouchers',
  'gate-passes': 'Gate Passes',
  'goods-receipts': 'Goods Receipts',
  inventory: 'Inventory',
  'stock-entries': 'Inventory',
  assets: 'Assets',
  photos: 'Site Photos',
  issues: 'Site Issues',
  inspections: 'Inspections',
  documents: 'Documents',
  'document-library': 'Documents',
  'material-purchase-requests': 'Material Requests',
  'site-bills': 'Site Bills',
  settings: 'Project Logos',
  chat: 'Chat',
  labour: 'Labour',
  vendors: 'Vendors',
  'bank-accounts': 'Bank and Cash',
  'cash-accounts': 'Bank and Cash',
  assistant: 'Assistant Uploads',
  attachments: 'Attachments',
};

/** Folder name per attachment `entityType` (generic `/attachments/upload`). */
const MODULE_BY_ENTITY: Record<string, string> = {
  QUOTATION: 'Quotations',
  PURCHASE_ORDER: 'Purchase Orders',
  CONTRACT: 'Purchase Orders',
  INVOICE: 'Vendor Invoices',
  VENDOR_INVOICE: 'Vendor Invoices',
  PAYMENT: 'Payment Requests',
  PAYMENT_REQUEST: 'Payment Requests',
  PAYMENT_SHEET: 'Payment Sheets',
  VOUCHER: 'Payment Vouchers',
  JOURNAL_VOUCHER: 'Payment Vouchers',
  GATE_PASS: 'Gate Passes',
  GOODS_RECEIPT: 'Goods Receipts',
  GRN: 'Goods Receipts',
  STOCK_ENTRY: 'Inventory',
  INVENTORY_ITEM: 'Inventory',
  INVENTORY_TRANSACTION: 'Inventory',
  PHOTO: 'Site Photos',
  DOCUMENT: 'Documents',
  STAFF: 'Employee Documents',
  LEDGER: 'Accounts',
  BUDGET_HEAD: 'Accounts',
  BANK_ACCOUNT: 'Bank and Cash',
  CASH_ACCOUNT: 'Bank and Cash',
  ASSET: 'Assets',
  MPR: 'Material Requests',
  MATERIAL_PURCHASE_REQUEST: 'Material Requests',
  SITE_BILL: 'Site Bills',
  ISSUE: 'Site Issues',
  INSPECTION: 'Inspections',
  VENDOR: 'Vendors',
  USER: 'Employee Documents',
  EMPLOYEE: 'Employee Documents',
  LABOUR: 'Labour',
};

const DEFAULT_MODULE = 'Other';

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Folder name for an API path such as `/api/quotations/123/file`. */
export function moduleFromPath(path: string): string {
  const segments = path.split('?')[0].split('/').filter(Boolean);
  const first = segments[0] === 'api' ? segments[1] : segments[0];
  if (!first) return DEFAULT_MODULE;
  return MODULE_BY_PATH[first] ?? titleCase(first);
}

/** Folder name for an attachment entity type such as `PURCHASE_ORDER`. */
export function moduleFromEntityType(entityType: string | null | undefined): string {
  if (!entityType) return DEFAULT_MODULE;
  const key = entityType.trim().toUpperCase();
  return MODULE_BY_ENTITY[key] ?? titleCase(key);
}

/**
 * Express middleware: remembers the module of this request for later uploads.
 *
 * Multipart parsers (multer/busboy) call `next()` from the request stream's
 * 'data'/'end' events, which Node runs in the socket's async context, not the
 * request's, so the module would be lost before the route sees the file. The
 * request's events are therefore emitted inside this context.
 */
export function storageModuleContext(req: Request, _res: Response, next: NextFunction): void {
  als.run({ module: moduleFromPath(req.originalUrl || req.url || '') }, () => {
    const scope = new AsyncResource('erp-storage-module');
    const emit = req.emit;
    req.emit = function (this: Request, ...args: Parameters<Request['emit']>) {
      return scope.runInAsyncScope(emit, this, ...args);
    } as Request['emit'];
    next();
  });
}

/** Narrow the module of the current request (e.g. from an attachment's entity type). */
export function setStorageModule(module: string): void {
  const store = als.getStore();
  if (store && module) store.module = module;
}

/** Module of the current request, or `fallback` outside a request (scripts, schedulers). */
export function currentStorageModule(fallback?: string): string {
  return als.getStore()?.module ?? fallback ?? DEFAULT_MODULE;
}

/** Run `fn` with a given module (used by the migration script). */
export function withStorageModule<T>(module: string, fn: () => T): T {
  return als.run({ module }, fn);
}
