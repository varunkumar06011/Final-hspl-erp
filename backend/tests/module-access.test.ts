import { describe, expect, it } from 'vitest';
import {
  APP_MODULES,
  Permission,
  UserRole,
  blockingModuleForApiPath,
  effectiveExtraPermissions,
  hasFullModuleControl,
  hasPermission,
  isModuleEnabled,
  moduleForPath,
  normalizeModuleAccess,
  updateModuleAccessSchema,
} from '@hospital-erp/shared';

const supervisor = { role: UserRole.SUPERVISOR, extraPermissions: [] as string[] };
const siteSupervisor = { role: UserRole.SITE_SUPERVISOR, extraPermissions: [] as string[] };

describe('module registry', () => {
  it('has unique keys and paths', () => {
    const keys = APP_MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const paths = APP_MODULES.flatMap((m) => (m.path ? [m.path] : []));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('never grants approval override through a module', () => {
    for (const m of APP_MODULES) expect(m.grants).not.toContain(Permission.APPROVAL_OVERRIDE);
  });

  it('maps page paths, including detail pages, to their module', () => {
    expect(moduleForPath('/')?.key).toBe('dashboard');
    expect(moduleForPath('/assets/abc')?.key).toBe('assets');
    expect(moduleForPath('/pos')?.key).toBe('purchaseOrders');
    expect(moduleForPath('/no-access')).toBeUndefined();
  });
});

describe('role defaults (match the sidebars before module access)', () => {
  it('keeps the admin layout: no Chart of Accounts or inventory for Admin 1', () => {
    const admin = { role: UserRole.ADMIN, extraPermissions: [] };
    expect(isModuleEnabled(admin, 'ledgers')).toBe(false);
    expect(isModuleEnabled(admin, 'inventory')).toBe(false);
    expect(isModuleEnabled(admin, 'inwardFunds')).toBe(true);
    expect(isModuleEnabled(admin, 'transactionRegister')).toBe(true);
  });

  it('keeps the supervisor layout', () => {
    expect(isModuleEnabled(supervisor, 'ledgers')).toBe(true);
    expect(isModuleEnabled(supervisor, 'cashAccounts')).toBe(true);
    expect(isModuleEnabled(supervisor, 'dashboard')).toBe(false);
    expect(isModuleEnabled(supervisor, 'paymentReports')).toBe(false);
    expect(isModuleEnabled(supervisor, 'inwardFunds')).toBe(false);
  });

  it('honours a user’s own extra permissions', () => {
    expect(isModuleEnabled({ ...supervisor, extraPermissions: [Permission.VIEW_DASHBOARD] }, 'dashboard')).toBe(true);
  });
});

describe('overrides', () => {
  it('switches a module on and grants only its permissions', () => {
    const user = { ...siteSupervisor, moduleAccess: { vendors: true } };
    expect(isModuleEnabled(user, 'vendors')).toBe(true);
    const perms = effectiveExtraPermissions(user);
    expect(hasPermission(user.role, Permission.CREATE_VENDOR, perms)).toBe(true);
    expect(hasPermission(user.role, Permission.CREATE_PAYMENT, perms)).toBe(false);
    // Sharing VIEW_FINANCIALS does not make other modules appear.
    expect(isModuleEnabled(user, 'quotations')).toBe(false);
  });

  it('switches a module off', () => {
    expect(isModuleEnabled({ ...supervisor, moduleAccess: { vendors: false } }, 'vendors')).toBe(false);
  });

  it('never restricts Admin 1, Admin 2 or a super admin', () => {
    for (const u of [
      { role: UserRole.ADMIN, extraPermissions: [] },
      { role: UserRole.ADMIN_2, extraPermissions: [] },
      { role: UserRole.SUPERVISOR, extraPermissions: ['*'] },
    ]) {
      expect(hasFullModuleControl(u.role, u.extraPermissions)).toBe(true);
      expect(isModuleEnabled({ ...u, moduleAccess: { chat: false } }, 'chat')).toBe(true);
      expect(blockingModuleForApiPath({ ...u, moduleAccess: { vendors: false } }, '/vendors')).toBeUndefined();
    }
  });

  it('lets Admin 3+ be restricted', () => {
    expect(hasFullModuleControl('ADMIN_3', [])).toBe(false);
    expect(isModuleEnabled({ role: 'ADMIN_3', extraPermissions: [], moduleAccess: { payments: false } }, 'payments')).toBe(false);
  });

  it('drops unknown keys and non-boolean values from stored JSON', () => {
    expect(normalizeModuleAccess({ vendors: false, bogus: true, chat: 'yes' })).toEqual({ vendors: false });
    expect(normalizeModuleAccess(null)).toEqual({});
    expect(normalizeModuleAccess([true])).toEqual({});
  });
});

describe('API write guard', () => {
  it('blocks writes into a switched-off module, including sub-paths', () => {
    const user = { ...supervisor, moduleAccess: { vendors: false } };
    expect(blockingModuleForApiPath(user, '/vendors')?.key).toBe('vendors');
    expect(blockingModuleForApiPath(user, '/vendors/123/approve')?.key).toBe('vendors');
    expect(blockingModuleForApiPath(user, '/vendors-extra')).toBeUndefined();
    expect(blockingModuleForApiPath(user, '/quotations')).toBeUndefined();
  });

  it('does not block a role-default-hidden module that was never switched off', () => {
    expect(blockingModuleForApiPath(siteSupervisor, '/vendors')).toBeUndefined();
  });

  it('keeps a shared API open while another module using it is on', () => {
    const workOff = { ...supervisor, moduleAccess: { work: false } };
    expect(blockingModuleForApiPath(workOff, '/work-tasks/1')).toBeUndefined();
    const bothOff = { ...supervisor, moduleAccess: { work: false, workCalendar: false } };
    expect(blockingModuleForApiPath(bothOff, '/work-tasks/1')?.key).toBeDefined();
  });
});

describe('updateModuleAccessSchema', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('accepts known modules with on/off/default values', () => {
    expect(updateModuleAccessSchema.safeParse({ body: { userIds: [id], changes: { vendors: true, chat: null } } }).success).toBe(true);
  });
  it('rejects unknown modules and empty user lists', () => {
    expect(updateModuleAccessSchema.safeParse({ body: { userIds: [id], changes: { nope: true } } }).success).toBe(false);
    expect(updateModuleAccessSchema.safeParse({ body: { userIds: [], changes: {} } }).success).toBe(false);
  });
});
