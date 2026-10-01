import { describe, it, expect } from 'vitest';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';

describe('Cross-Project Isolation Tests', () => {
  // These tests verify the permission matrix logic that enforces project isolation.
  // In a full integration test, these would hit the API with scoped tokens.
  // Here we verify the RBAC + permission logic that gates access.

  it('Project A user with VIEW_FINANCIALS permission has access to financial endpoints', () => {
    expect(hasPermission(UserRole.PROJECT_HEAD, Permission.VIEW_FINANCIALS)).toBe(true);
    expect(hasPermission(UserRole.ADMIN, Permission.VIEW_FINANCIALS)).toBe(true);
  });

  it('Every role has VIEW_FINANCIALS (but scoped to their projectId at the service layer)', () => {
    const roles = [UserRole.SUPERVISOR, UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];
    for (const role of roles) {
      expect(hasPermission(role, Permission.VIEW_FINANCIALS)).toBe(true);
    }
  });

  it('MANAGE_USERS is available to the four heads but not Supervisors', () => {
    expect(hasPermission(UserRole.SUPERVISOR, Permission.MANAGE_USERS)).toBe(false);
    expect(hasPermission(UserRole.PROJECT_HEAD, Permission.MANAGE_USERS)).toBe(true);
    expect(hasPermission(UserRole.HEAD_OF_CONSTRUCTION, Permission.MANAGE_USERS)).toBe(true);
    expect(hasPermission(UserRole.ADMIN, Permission.MANAGE_USERS)).toBe(true);
    expect(hasPermission(UserRole.ADMIN_2, Permission.MANAGE_USERS)).toBe(true);
  });

  // Behavioural isolation tests (project claim in the token, per-project numbering,
  // project management) live in multi-project.test.ts.
});
