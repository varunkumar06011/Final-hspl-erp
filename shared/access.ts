// ═══════════════════════════════════════════════════════════
// Module access — which app modules each user can see and use.
//
// Every user starts on their role's defaults (the sidebar the role always had).
// Admin 1, Admin 2 and super admins ('*') can override any module for any other
// user through `User.moduleAccess`, a map of module key → boolean:
//   true  → module shown, and its `grants` are added to the user's permissions
//   false → module hidden, its page blocked, and writes to its `apiPrefixes`
//           refused by the backend
//   (key missing) → role default
// Admin 1 / Admin 2 / super admins always keep every module (never overridden),
// so the people in control can never lock themselves out.
// ═══════════════════════════════════════════════════════════

import { Permission, SUPER_ADMIN_GRANT, UserRole, hasPermission, isAdminRole } from './enums.js';

export type ModuleSection =
  | 'General'
  | 'Procurement'
  | 'Accounting'
  | 'Budget'
  | 'Reports'
  | 'Site Operations'
  | 'Admin';

export interface AppModule {
  key: string;
  /** English label; the UI translates it via `nav.<label>`. */
  label: string;
  section: ModuleSection;
  /** Page path. Absent for modules that are not a page (the assistant). */
  path?: string;
  /** Permission the role needs to see the module by default. */
  permission?: Permission;
  /** Extra role rule for the default (mirrors the old per-role sidebars). */
  defaultFor?: (role: string) => boolean;
  /** Permissions granted when the module is switched on for a user. */
  grants: Permission[];
  /** API prefixes (under /api) whose writes are refused while the module is switched off. */
  apiPrefixes: string[];
}

const adminOrAccountant = (role: string) => isAdminRole(role) || role === UserRole.ACCOUNTANT;

const FIN = [Permission.VIEW_FINANCIALS];
const FIN_MANAGE = [Permission.VIEW_FINANCIALS, Permission.MANAGE_FINANCE];

export const APP_MODULES: readonly AppModule[] = [
  // ── General ──
  { key: 'dashboard', label: 'Dashboard', section: 'General', path: '/', permission: Permission.VIEW_DASHBOARD, grants: [Permission.VIEW_DASHBOARD], apiPrefixes: [] },
  { key: 'chat', label: 'Chat', section: 'General', path: '/chat', grants: [], apiPrefixes: ['/chat'] },
  { key: 'assistant', label: 'Miko Assistant', section: 'General', grants: [], apiPrefixes: ['/assistant'] },
  { key: 'work', label: 'Work', section: 'General', path: '/work', permission: Permission.MANAGE_WORK_TASKS, grants: [Permission.MANAGE_WORK_TASKS], apiPrefixes: ['/work-tasks'] },
  { key: 'workCalendar', label: 'Work Calendar', section: 'General', path: '/work-calendar', permission: Permission.MANAGE_WORK_TASKS, grants: [Permission.MANAGE_WORK_TASKS], apiPrefixes: ['/work-tasks'] },
  // ── Procurement ──
  { key: 'mpr', label: 'Material Requests', section: 'Procurement', path: '/material-purchase-requests', permission: Permission.VIEW_MPR, grants: [Permission.VIEW_MPR, Permission.CREATE_MPR], apiPrefixes: ['/material-purchase-requests'] },
  { key: 'vendors', label: 'Vendors', section: 'Procurement', path: '/vendors', permission: Permission.VIEW_FINANCIALS, grants: [Permission.VIEW_FINANCIALS, Permission.CREATE_VENDOR], apiPrefixes: ['/vendors'] },
  { key: 'quotations', label: 'Quotations', section: 'Procurement', path: '/quotations', permission: Permission.VIEW_FINANCIALS, grants: [Permission.VIEW_FINANCIALS, Permission.CREATE_QUOTATION], apiPrefixes: ['/quotations'] },
  { key: 'purchaseOrders', label: 'Purchase Orders', section: 'Procurement', path: '/pos', permission: Permission.VIEW_FINANCIALS, grants: [Permission.VIEW_FINANCIALS, Permission.CREATE_PO], apiPrefixes: ['/purchase-orders'] },
  { key: 'gatePasses', label: 'Gate Passes', section: 'Procurement', path: '/gate-passes', permission: Permission.VIEW_GATE_PASSES, grants: [Permission.VIEW_GATE_PASSES, Permission.CREATE_GATE_PASS], apiPrefixes: ['/gate-passes'] },
  { key: 'goodsReceipts', label: 'Goods Receipts', section: 'Procurement', path: '/goods-receipts', permission: Permission.MANAGE_INVENTORY, grants: [Permission.MANAGE_INVENTORY], apiPrefixes: ['/goods-receipts'] },
  { key: 'invoices', label: 'Invoices', section: 'Procurement', path: '/invoices', permission: Permission.VIEW_FINANCIALS, grants: [Permission.VIEW_FINANCIALS, Permission.VERIFY_INVOICE], apiPrefixes: ['/invoices'] },
  { key: 'gstRecords', label: 'GST Records', section: 'Procurement', path: '/gst-records', permission: Permission.VIEW_FINANCIALS, grants: FIN, apiPrefixes: ['/gst-records'] },
  // ── Accounting ──
  { key: 'inwardFunds', label: 'Inward Funds', section: 'Accounting', path: '/inward-funds', permission: Permission.VIEW_FINANCIALS, defaultFor: adminOrAccountant, grants: FIN_MANAGE, apiPrefixes: [] },
  { key: 'expenditure', label: 'Expenditure', section: 'Accounting', path: '/expenditure', permission: Permission.VIEW_FINANCIALS, grants: FIN_MANAGE, apiPrefixes: [] },
  { key: 'payments', label: 'Payments', section: 'Accounting', path: '/payments', permission: Permission.VIEW_FINANCIALS, grants: [Permission.VIEW_FINANCIALS, Permission.CREATE_PAYMENT], apiPrefixes: ['/payments', '/payment-sheets'] },
  { key: 'vouchers', label: 'Accounting Vouchers', section: 'Accounting', path: '/vouchers', permission: Permission.VIEW_FINANCIALS, grants: FIN_MANAGE, apiPrefixes: ['/vouchers'] },
  { key: 'ledgers', label: 'Chart of Accounts', section: 'Accounting', path: '/ledgers', permission: Permission.VIEW_FINANCIALS, defaultFor: (role) => !isAdminRole(role), grants: FIN_MANAGE, apiPrefixes: ['/ledgers'] },
  { key: 'bankAccounts', label: 'Bank Ledgers', section: 'Accounting', path: '/bank-accounts', permission: Permission.VIEW_FINANCIALS, grants: FIN_MANAGE, apiPrefixes: ['/bank-accounts'] },
  { key: 'cashAccounts', label: 'Cash Ledgers', section: 'Accounting', path: '/cash-accounts', permission: Permission.VIEW_FINANCIALS, defaultFor: (role) => !adminOrAccountant(role), grants: FIN_MANAGE, apiPrefixes: ['/cash-accounts'] },
  // ── Budget ──
  { key: 'budgetHeads', label: 'Budget Heads', section: 'Budget', path: '/budget-heads', permission: Permission.VIEW_FINANCIALS, grants: FIN_MANAGE, apiPrefixes: ['/budget-heads', '/budget-revisions'] },
  { key: 'ownerAccounts', label: 'Owner Account', section: 'Budget', path: '/owner-accounts', permission: Permission.VIEW_FINANCIALS, grants: FIN_MANAGE, apiPrefixes: ['/owner-accounts'] },
  // ── Reports ──
  { key: 'financeDashboard', label: 'Finance Dashboard', section: 'Reports', path: '/finance-dashboard', permission: Permission.VIEW_FINANCIALS, grants: FIN, apiPrefixes: [] },
  { key: 'accountingReports', label: 'Accounting Reports', section: 'Reports', path: '/accounting-reports', permission: Permission.VIEW_FINANCIALS, grants: FIN, apiPrefixes: [] },
  { key: 'financeReports', label: 'Finance Reports', section: 'Reports', path: '/finance-reports', permission: Permission.VIEW_FINANCIALS, grants: FIN, apiPrefixes: [] },
  { key: 'paymentReports', label: 'Payment Report', section: 'Reports', path: '/payment-reports', permission: Permission.VIEW_FINANCIALS, defaultFor: (role) => adminOrAccountant(role) || role === UserRole.PROJECT_HEAD, grants: FIN, apiPrefixes: [] },
  { key: 'transactionRegister', label: 'Transaction Register', section: 'Reports', path: '/transaction-register', permission: Permission.VIEW_FINANCIALS, defaultFor: adminOrAccountant, grants: FIN, apiPrefixes: [] },
  // ── Site Operations ──
  { key: 'inventory', label: 'Inventory', section: 'Site Operations', path: '/inventory', permission: Permission.MANAGE_INVENTORY, defaultFor: (role) => !adminOrAccountant(role), grants: [Permission.MANAGE_INVENTORY], apiPrefixes: ['/inventory', '/stock-entries'] },
  { key: 'assets', label: 'Assets', section: 'Site Operations', path: '/assets', permission: Permission.MANAGE_INVENTORY, defaultFor: (role) => !adminOrAccountant(role), grants: [Permission.MANAGE_INVENTORY], apiPrefixes: ['/assets'] },
  { key: 'labour', label: 'Attendance', section: 'Site Operations', path: '/labour', permission: Permission.MANAGE_LABOUR, defaultFor: (role) => !adminOrAccountant(role), grants: [Permission.MANAGE_LABOUR], apiPrefixes: ['/labour'] },
  { key: 'photos', label: 'Site Photos', section: 'Site Operations', path: '/photos', permission: Permission.UPLOAD_PHOTOS, grants: [Permission.UPLOAD_PHOTOS], apiPrefixes: ['/photos'] },
  { key: 'issues', label: 'Issues', section: 'Site Operations', path: '/issues', permission: Permission.MANAGE_ISSUES, grants: [Permission.MANAGE_ISSUES], apiPrefixes: ['/issues'] },
  { key: 'inspections', label: 'Inspections', section: 'Site Operations', path: '/inspections', permission: Permission.MANAGE_INSPECTIONS, defaultFor: (role) => !adminOrAccountant(role), grants: [Permission.MANAGE_INSPECTIONS], apiPrefixes: ['/inspections'] },
  { key: 'documents', label: 'Documents', section: 'Site Operations', path: '/documents', permission: Permission.MANAGE_DOCUMENTS, grants: [Permission.MANAGE_DOCUMENTS], apiPrefixes: ['/documents', '/document-library'] },
  { key: 'contracts', label: 'Contracts', section: 'Site Operations', permission: Permission.MANAGE_CONTRACTS, grants: [Permission.MANAGE_CONTRACTS], apiPrefixes: ['/contracts'] },
  // ── Admin ──
  { key: 'comments', label: 'Comments', section: 'Admin', path: '/comments', grants: [], apiPrefixes: [] },
  { key: 'activityLog', label: 'Activity Log', section: 'Admin', path: '/activity-log', grants: [], apiPrefixes: [] },
  { key: 'audit', label: 'Audit Log', section: 'Admin', path: '/audit', permission: Permission.VIEW_AUDIT_LOG, grants: [Permission.VIEW_AUDIT_LOG], apiPrefixes: [] },
  { key: 'users', label: 'Users', section: 'Admin', path: '/users', permission: Permission.MANAGE_USERS, grants: [Permission.MANAGE_USERS], apiPrefixes: ['/auth/users'] },
  { key: 'projects', label: 'Projects', section: 'Admin', path: '/projects', permission: Permission.MANAGE_PROJECTS, grants: [Permission.MANAGE_PROJECTS], apiPrefixes: ['/projects'] },
  { key: 'settings', label: 'Settings', section: 'Admin', path: '/settings', grants: [], apiPrefixes: ['/settings'] },
];

export const MODULE_SECTIONS: readonly ModuleSection[] = [
  'General',
  'Procurement',
  'Accounting',
  'Budget',
  'Reports',
  'Site Operations',
  'Admin',
];

const MODULE_BY_KEY = new Map(APP_MODULES.map((m) => [m.key, m]));

export function getModule(key: string): AppModule | undefined {
  return MODULE_BY_KEY.get(key);
}

/** Module whose page is at `pathname` (`/assets/123` → assets). The home path '/' matches only itself. */
export function moduleForPath(pathname: string): AppModule | undefined {
  let best: AppModule | undefined;
  for (const m of APP_MODULES) {
    if (!m.path) continue;
    const hit = m.path === '/' ? pathname === '/' : pathname === m.path || pathname.startsWith(`${m.path}/`);
    if (hit && (!best || m.path.length > (best.path?.length ?? 0))) best = m;
  }
  return best;
}

/** Per-user overrides: module key → on/off. Missing key = role default. */
export type ModuleAccessMap = Record<string, boolean>;

/** Keeps only known module keys with boolean values (DB JSON is untrusted). */
export function normalizeModuleAccess(raw: unknown): ModuleAccessMap {
  const out: ModuleAccessMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean' && MODULE_BY_KEY.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Admin 1, Admin 2 and super admins control module access and always keep every
 * module. Other admins (Admin 3, 4, …) can be restricted like anyone else.
 */
export function hasFullModuleControl(
  role: string,
  extraPermissions?: readonly string[] | null,
): boolean {
  return role === UserRole.ADMIN || role === UserRole.ADMIN_2 || !!extraPermissions?.includes(SUPER_ADMIN_GRANT);
}

/** Whether the role (plus the user's own extra permissions) sees the module with no override. */
export function isModuleOnByDefault(
  module: AppModule,
  role: string,
  extraPermissions?: readonly string[] | null,
): boolean {
  if (module.defaultFor && !module.defaultFor(role)) return false;
  return !module.permission || hasPermission(role, module.permission, extraPermissions);
}

export interface ModuleAccessSubject {
  role: string;
  /** The user's own extra permissions, before module grants. */
  extraPermissions?: readonly string[] | null;
  moduleAccess?: ModuleAccessMap | null;
}

/** Explicit override for the module, or undefined when the role default applies. */
export function moduleOverride(subject: ModuleAccessSubject, key: string): boolean | undefined {
  if (hasFullModuleControl(subject.role, subject.extraPermissions)) return undefined;
  const value = subject.moduleAccess?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function isModuleEnabled(subject: ModuleAccessSubject, key: string): boolean {
  const module = MODULE_BY_KEY.get(key);
  if (!module) return true;
  // A super admin ('*') has every module, whatever the role defaults say.
  if (subject.extraPermissions?.includes(SUPER_ADMIN_GRANT)) return true;
  const override = moduleOverride(subject, key);
  if (override !== undefined) return override;
  return isModuleOnByDefault(module, subject.role, subject.extraPermissions);
}

/** True only when an admin explicitly switched the module off for this user. */
export function isModuleSwitchedOff(subject: ModuleAccessSubject, key: string): boolean {
  return moduleOverride(subject, key) === false;
}

/** The user's own extra permissions plus everything granted by modules switched on for them. */
export function effectiveExtraPermissions(subject: ModuleAccessSubject): string[] {
  const out = new Set(subject.extraPermissions ?? []);
  if (!hasFullModuleControl(subject.role, subject.extraPermissions)) {
    for (const [key, on] of Object.entries(subject.moduleAccess ?? {})) {
      if (on !== true) continue;
      for (const p of MODULE_BY_KEY.get(key)?.grants ?? []) out.add(p);
    }
  }
  return [...out];
}

/**
 * Writes to an API path are refused when an admin switched off a module owning
 * that prefix and no other module owning it is still on for the user.
 * `apiPath` is relative to /api (e.g. `/vendors/123`).
 */
export function blockingModuleForApiPath(subject: ModuleAccessSubject, apiPath: string): AppModule | undefined {
  const owners = APP_MODULES.filter((m) =>
    m.apiPrefixes.some((p) => apiPath === p || apiPath.startsWith(`${p}/`) || apiPath.startsWith(`${p}?`)),
  );
  const switchedOff = owners.find((m) => isModuleSwitchedOff(subject, m.key));
  if (!switchedOff) return undefined;
  return owners.some((m) => isModuleEnabled(subject, m.key)) ? undefined : switchedOff;
}

/** Who may open Module Access: full-control admins, or a user granted MANAGE_MODULE_ACCESS personally. */
export function canManageModuleAccess(
  role: string,
  extraPermissions?: readonly string[] | null,
): boolean {
  return hasFullModuleControl(role, extraPermissions) || !!extraPermissions?.includes(Permission.MANAGE_MODULE_ACCESS);
}
