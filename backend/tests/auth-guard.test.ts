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
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
  },
}));

import { verifyFirebaseToken } from '../src/config/firebase';
import { prisma } from '../src/config/prisma';
import { register, updateUser } from '../src/controllers/auth.controller';

const mockVerifyToken = verifyFirebaseToken as unknown as ReturnType<typeof vi.fn>;
const mockFindUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockFindExistingUser = prisma.user.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockCreateUser = prisma.user.create as unknown as ReturnType<typeof vi.fn>;
const mockUpdateUser = prisma.user.update as unknown as ReturnType<typeof vi.fn>;
const mockFindProject = prisma.project.findFirst as unknown as ReturnType<typeof vi.fn>;

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

describe('Self registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Supervisor in the active project after Firebase phone verification', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'firebase-new', phone_number: '+919111111111' });
    mockFindExistingUser.mockResolvedValue(null);
    mockFindProject.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mockCreateUser.mockImplementation(async ({ data }: any) => ({
      id: '22222222-2222-4222-8222-222222222222',
      ...data,
    }));

    const req = createMockReq({ body: { idToken: 'valid-token', name: 'New Supervisor' } });
    const res = createMockRes();

    await register(req as unknown as Request, res, vi.fn());

    expect(mockCreateUser).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firebaseUid: 'firebase-new',
        phone: '+919111111111',
        name: 'New Supervisor',
        role: UserRole.SUPERVISOR,
        projectId: '11111111-1111-4111-8111-111111111111',
        isActive: true,
      }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('Privileged role assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents assigning the same active head role to two users in one project', async () => {
    mockFindUser.mockResolvedValue({
      id: 'user-supervisor',
      projectId: 'project-1',
      role: UserRole.SUPERVISOR,
      isActive: true,
    });
    mockFindExistingUser.mockResolvedValue({ name: 'Nagarjuna Sir' });

    const req = createMockReq({
      params: { id: 'user-supervisor' },
      body: { role: UserRole.PROJECT_HEAD },
      user: {
        id: 'admin-user',
        firebaseUid: 'admin-firebase',
        phone: '+919000000001',
        name: 'Admin',
        role: UserRole.ADMIN,
        projectId: 'project-1',
        isActive: true,
      },
    });
    const res = createMockRes();

    await updateUser(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
