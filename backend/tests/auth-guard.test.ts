import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../src/middleware/auth';
import { UserRole } from '@hospital-erp/shared';

vi.mock('../src/config/firebase', () => ({
  verifyFirebaseToken: vi.fn(),
}));

vi.mock('../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { verifyFirebaseToken } from '../src/config/firebase';
import { prisma } from '../src/config/prisma';

const mockVerifyToken = verifyFirebaseToken as unknown as ReturnType<typeof vi.fn>;
const mockFindUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

function createMockReq(overrides?: Partial<AuthenticatedRequest>): AuthenticatedRequest {
  return {
    headers: {},
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('Auth Guard — Pre-provisioned login only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registered phone + valid token → 200 with user profile', async () => {
    mockVerifyToken.mockResolvedValue({
      uid: 'firebase-uid-1',
      phone_number: '+919000000001',
    });
    mockFindUser.mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'firebase-uid-1',
      phone: '+919000000001',
      name: 'Admin One',
      role: UserRole.PROJECT_HEAD,
      projectId: 'project-1',
      isActive: true,
    });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.phone).toBe('+919000000001');
    expect(req.user!.role).toBe(UserRole.PROJECT_HEAD);
  });

  it('unregistered phone + valid token → 403 (no auto-sign-up)', async () => {
    mockVerifyToken.mockResolvedValue({
      uid: 'firebase-uid-stranger',
      phone_number: '+919999999999',
    });
    mockFindUser.mockResolvedValue(null);

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Not authorized') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('inactive user + valid token → 403', async () => {
    mockVerifyToken.mockResolvedValue({
      uid: 'firebase-uid-2',
      phone_number: '+919000000002',
    });
    mockFindUser.mockResolvedValue({
      id: 'user-2',
      firebaseUid: 'firebase-uid-2',
      phone: '+919000000002',
      name: 'Admin Two',
      role: UserRole.HEAD_OF_CONSTRUCTION,
      projectId: 'project-1',
      isActive: false,
    });

    const req = createMockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('inactive') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('invalid/expired token → 401', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Invalid token'));

    const req = createMockReq({
      headers: { authorization: 'Bearer expired-token' },
    });
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('no token → 401', async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('No authorization') })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
