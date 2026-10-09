import {
  APP_MODULES,
  canManageModuleAccess as sharedCanManage,
  isModuleEnabled,
  isModuleSwitchedOff,
  type ModuleAccessSubject,
  type UserResponse,
} from '@hospital-erp/shared';

/**
 * Module access of the signed-in user. `directPermissions` (the user's own
 * grants) drives the role defaults; sessions stored before module access
 * existed only carry `extraPermissions`, which is the same thing for them.
 */
export function accessSubject(user: UserResponse | null): ModuleAccessSubject | null {
  if (!user) return null;
  return {
    role: user.role,
    extraPermissions: user.directPermissions ?? user.extraPermissions,
    moduleAccess: user.moduleAccess,
  };
}

export function canUseModule(user: UserResponse | null, key: string): boolean {
  const subject = accessSubject(user);
  return !!subject && isModuleEnabled(subject, key);
}

/** True only when an admin switched the module off for this user. */
export function moduleSwitchedOff(user: UserResponse | null, key: string): boolean {
  const subject = accessSubject(user);
  return !!subject && isModuleSwitchedOff(subject, key);
}

export function canManageModuleAccess(user: UserResponse | null): boolean {
  return !!user && sharedCanManage(user.role, user.directPermissions ?? user.extraPermissions);
}

/** Where to send the user when the page they asked for is not available: their first module. */
export function firstModulePath(user: UserResponse | null, except?: string): string | null {
  const subject = accessSubject(user);
  if (!subject) return null;
  const first = APP_MODULES.find((m) => m.path && m.path !== except && isModuleEnabled(subject, m.key));
  return first?.path ?? null;
}
