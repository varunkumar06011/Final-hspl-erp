import { describe, it, expect, vi } from 'vitest';
import { Response, NextFunction } from 'express';
import { rbacMiddleware } from '../src/middleware/rbac';
import { AuthenticatedRequest } from '../src/middleware/auth';
import { UserRole, Permission } from '@hospital-erp/shared';

function createMockReq(user: AuthenticatedRequest['user']): AuthenticatedRequest {
  return { user } as unknown as AuthenticatedRequest;
}

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function runMiddleware(
  permission: Permission,
  user: AuthenticatedRequest['user']
): { status: number | undefined; calledNext: boolean } {
  const middleware = rbacMiddleware(permission);
  const req = createMockReq(user);
  const res = createMockRes();
  let calledNext = false;
  const next = (() => { calledNext = true; }) as unknown as NextFunction;

  middleware(req, res, next);

  const statusCall = (res as unknown as { status: ReturnType<typeof vi.fn> }).status.mock.calls[0];
  return {
    status: statusCall?.[0],
    calledNext,
  };
}

describe('Adversarial RBAC Tests', () => {
  it('PROJECT_HEAD can access user management → 200', () => {
    const result = runMiddleware(Permission.MANAGE_USERS, {
      id: '1', firebaseUid: '1', phone: '1', name: 'Head',
      role: UserRole.PROJECT_HEAD, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(true);
    expect(result.status).toBeUndefined();
  });

  it('ADMIN cannot access user management → 403', () => {
    const result = runMiddleware(Permission.MANAGE_USERS, {
      id: '3', firebaseUid: '3', phone: '3', name: 'Admin3',
      role: UserRole.ADMIN, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('ADMIN can approve at step 1 → 200', () => {
    const result = runMiddleware(Permission.APPROVE_PAYMENT_STEP_1, {
      id: '3', firebaseUid: '3', phone: '3', name: 'Admin3',
      role: UserRole.ADMIN, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(true);
  });

  it('ADMIN cannot approve at step 2 → 403', () => {
    const result = runMiddleware(Permission.APPROVE_PAYMENT_STEP_2, {
      id: '3', firebaseUid: '3', phone: '3', name: 'Admin3',
      role: UserRole.ADMIN, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('HEAD_OF_CONSTRUCTION cannot approve at step 1 → 403', () => {
    const result = runMiddleware(Permission.APPROVE_PAYMENT_STEP_1, {
      id: '2', firebaseUid: '2', phone: '2', name: 'Head2',
      role: UserRole.HEAD_OF_CONSTRUCTION, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('ADMIN_2 cannot approve at step 1 → 403', () => {
    const result = runMiddleware(Permission.APPROVE_PAYMENT_STEP_1, {
      id: '4', firebaseUid: '4', phone: '4', name: 'Admin4',
      role: UserRole.ADMIN_2, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('PROJECT_HEAD can edit budget → 200', () => {
    const result = runMiddleware(Permission.EDIT_BUDGET, {
      id: '1', firebaseUid: '1', phone: '1', name: 'Head',
      role: UserRole.PROJECT_HEAD, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(true);
  });

  it('ADMIN cannot edit budget → 403', () => {
    const result = runMiddleware(Permission.EDIT_BUDGET, {
      id: '3', firebaseUid: '3', phone: '3', name: 'Admin3',
      role: UserRole.ADMIN, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('HEAD_OF_CONSTRUCTION cannot edit budget → 403', () => {
    const result = runMiddleware(Permission.EDIT_BUDGET, {
      id: '2', firebaseUid: '2', phone: '2', name: 'Head2',
      role: UserRole.HEAD_OF_CONSTRUCTION, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('ADMIN_2 cannot edit budget → 403', () => {
    const result = runMiddleware(Permission.EDIT_BUDGET, {
      id: '4', firebaseUid: '4', phone: '4', name: 'Admin4',
      role: UserRole.ADMIN_2, projectId: 'p1', isActive: true,
    });
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(403);
  });

  it('no user (unauthenticated) → 401', () => {
    const result = runMiddleware(Permission.VIEW_FINANCIALS, undefined);
    expect(result.calledNext).toBe(false);
    expect(result.status).toBe(401);
  });
});
