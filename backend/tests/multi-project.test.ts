/**
 * Multi-project tests
 * ===================
 *
 * The ERP hosts several completely separate projects (hospitals/sites) with one
 * shared set of users, logins and PINs. The project a session works in is chosen
 * at login and carried as a signed `projectId` claim in the app JWT.
 *
 * Prisma is mocked (no database needed). Properties verified:
 *  - the JWT claim decides req.user.projectId; archived/unknown projects and old
 *    tokens without a claim fall back to the user's default project
 *  - login / switch-project reject an unavailable project and issue a token
 *    carrying the chosen project
 *  - only admin roles can create projects; codes are unique; the project you are
 *    working in cannot be archived
 *  - document numbers are prefixed with the project code and each project's
 *    numbering restarts at 001 independently
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { hasPermission, Permission, UserRole } from '@hospital-erp/shared';

// Set before the app (and dotenv) load so every module signs/verifies with the same secret.
const JWT_SECRET = vi.hoisted(() => {
  process.env.JWT_SECRET = 'multi-project-test-secret';
  return process.env.JWT_SECRET;
});

const PROJECT_A = '00000000-0000-0000-0000-00000000000a';
const PROJECT_B = '00000000-0000-0000-0000-00000000000b';
const PROJECT_GONE = '00000000-0000-0000-0000-00000000000c';
const ARCHIVED = '00000000-0000-0000-0000-00000000000d';

type Row = Record<string, any>;

const db = vi.hoisted(() => ({
  projects: new Map<string, Row>(),
  users: new Map<string, Row>(),
  vouchers: [] as Row[],
  vendors: [] as Row[],
  audit: [] as Row[],
}));

vi.mock('../src/config/prisma', () => {
  const prisma: Row = {
    project: {
      findUnique: vi.fn(async ({ where }: Row) => {
        if (where.id) return db.projects.get(where.id) ?? null;
        if (where.code) return [...db.projects.values()].find((p) => p.code === where.code) ?? null;
        return null;
      }),
      findFirst: vi.fn(async ({ where }: Row = {}) => {
        const live = [...db.projects.values()].filter((p) => (where?.deletedAt === null ? p.deletedAt === null : true));
        return live.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
      }),
      findMany: vi.fn(async ({ where }: Row = {}) =>
        [...db.projects.values()].filter((p) => (where?.deletedAt === null ? p.deletedAt === null : true))
      ),
      count: vi.fn(async ({ where }: Row = {}) =>
        [...db.projects.values()].filter((p) => (where?.deletedAt === null ? p.deletedAt === null : true)).length
      ),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: `new-${db.projects.size}`, createdAt: Date.now(), deletedAt: null, ...data };
        db.projects.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = { ...db.projects.get(where.id), ...data };
        db.projects.set(where.id, row);
        return row;
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: Row) => {
        if (where.id) return db.users.get(where.id) ?? null;
        if (where.phone) return [...db.users.values()].find((u) => u.phone === where.phone) ?? null;
        return null;
      }),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = { ...db.users.get(where.id), ...data };
        db.users.set(where.id, row);
        return row;
      }),
    },
    journalVoucher: {
      findMany: vi.fn(async ({ where }: Row) =>
        db.vouchers.filter(
          (v) => v.projectId === where.projectId && v.jvNumber.startsWith(where.jvNumber.startsWith)
        )
      ),
    },
    vendor: {
      findMany: vi.fn(async ({ where }: Row) =>
        db.vendors.filter((v) => {
          if (where.projectId && v.projectId !== where.projectId) return false;
          const f = where.vendorCode;
          if (typeof f === 'string') return v.vendorCode === f;
          return v.vendorCode.startsWith(f.startsWith);
        })
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: Row) => {
        db.audit.push(data);
        return data;
      }),
    },
  };
  prisma.$transaction = vi.fn(async (cb: (tx: Row) => unknown) => cb(prisma));
  return { prisma };
});

vi.mock('../src/config/firebase', () => ({ verifyFirebaseToken: vi.fn(), getFirebaseApp: vi.fn() }));
vi.mock('../src/socket', () => ({ emitToProject: vi.fn(), initSocketServer: vi.fn(), io: null }));

import app from '../src/app';
import { authMiddleware } from '../src/middleware/auth';
import { invalidateProjectCache } from '../src/services/project.service';
import { generateProjectSequenceNumber } from '../src/services/sequence.service';
import { generateVoucherNumber } from '../src/routes/voucher.routes';

const request = supertest(app);

const ADMIN_ID = 'user-admin';
const SUP_ID = 'user-sup';

const tokenFor = (userId: string, projectId?: string) =>
  jwt.sign({ userId, ...(projectId ? { projectId } : {}) }, JWT_SECRET, { expiresIn: '1h' });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(async () => {
  db.projects.clear();
  db.users.clear();
  db.vouchers.length = 0;
  db.vendors.length = 0;
  db.audit.length = 0;
  invalidateProjectCache();

  db.projects.set(PROJECT_A, { id: PROJECT_A, code: 'VGH', name: 'Vigrand', status: 'ACTIVE', deletedAt: null, createdAt: 1, logoUrl: null });
  db.projects.set(PROJECT_B, { id: PROJECT_B, code: 'ABC', name: 'ABC Hospital', status: 'ACTIVE', deletedAt: null, createdAt: 2, logoUrl: null });
  db.projects.set(ARCHIVED, { id: ARCHIVED, code: 'OLD', name: 'Old', status: 'ACTIVE', deletedAt: new Date(), createdAt: 3, logoUrl: null });

  const base = { firebaseUid: 'x', isActive: true, termsAcceptedAt: new Date(), pinHash: await bcrypt.hash('1234', 4) };
  db.users.set(ADMIN_ID, { ...base, id: ADMIN_ID, phone: '+919000000001', name: 'Admin', role: UserRole.ADMIN, projectId: PROJECT_A });
  db.users.set(SUP_ID, { ...base, id: SUP_ID, phone: '+919000000002', name: 'Sup', role: UserRole.SUPERVISOR, projectId: PROJECT_A });
});

// ─── Which project does a request belong to? ─────────────────────────────

describe('authMiddleware — active project comes from the signed token', () => {
  async function run(token: string) {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await authMiddleware(req, res, next);
    return { req, res, next };
  }

  it('uses the project in the token, not the user default', async () => {
    const { req, next } = await run(tokenFor(ADMIN_ID, PROJECT_B));
    expect(next).toHaveBeenCalled();
    expect(req.user.projectId).toBe(PROJECT_B);
  });

  it('falls back to the user default when the token has no project (older tokens)', async () => {
    const { req } = await run(tokenFor(ADMIN_ID));
    expect(req.user.projectId).toBe(PROJECT_A);
  });

  it('ignores an archived project in the token', async () => {
    const { req } = await run(tokenFor(ADMIN_ID, ARCHIVED));
    expect(req.user.projectId).toBe(PROJECT_A);
  });

  it('ignores a project that does not exist', async () => {
    const { req } = await run(tokenFor(ADMIN_ID, PROJECT_GONE));
    expect(req.user.projectId).toBe(PROJECT_A);
  });

  it('rejects a token signed with another secret (cannot forge a project claim)', async () => {
    const forged = jwt.sign({ userId: ADMIN_ID, projectId: PROJECT_B }, 'not-the-secret');
    const { res, next } = await run(forged);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Login + switching ───────────────────────────────────────────────────

describe('login and switch-project', () => {
  it('GET /projects/public lists live projects with names only', async () => {
    const res = await request.get('/api/projects/public');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: Row) => p.code)).toEqual(['VGH', 'ABC']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'hasLogo', 'id', 'name']);
  });

  it('pin-login with a chosen project returns a token carrying that project', async () => {
    const res = await request
      .post('/api/auth/pin-login')
      .send({ phone: '+919000000002', pin: '1234', agreedToTerms: true, projectId: PROJECT_B });
    expect(res.status).toBe(200);
    expect(res.body.user.projectId).toBe(PROJECT_B);
    const claims = jwt.verify(res.body.token, JWT_SECRET) as Row;
    expect(claims.userId).toBe(SUP_ID);
    expect(claims.projectId).toBe(PROJECT_B);
  });

  it('pin-login without a project signs in to the user default project', async () => {
    const res = await request
      .post('/api/auth/pin-login')
      .send({ phone: '+919000000002', pin: '1234', agreedToTerms: true });
    expect(res.status).toBe(200);
    expect(res.body.user.projectId).toBe(PROJECT_A);
  });

  it('pin-login to an archived project is refused', async () => {
    const res = await request
      .post('/api/auth/pin-login')
      .send({ phone: '+919000000002', pin: '1234', agreedToTerms: true, projectId: ARCHIVED });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  it('a wrong PIN never reveals whether the project is valid', async () => {
    const res = await request
      .post('/api/auth/pin-login')
      .send({ phone: '+919000000002', pin: '9999', agreedToTerms: true, projectId: ARCHIVED });
    expect(res.status).toBe(401);
  });

  it('switch-project re-issues a token for the new project', async () => {
    const res = await request
      .post('/api/auth/switch-project')
      .set(bearer(tokenFor(SUP_ID, PROJECT_A)))
      .send({ projectId: PROJECT_B });
    expect(res.status).toBe(200);
    expect(res.body.user.projectId).toBe(PROJECT_B);
    expect((jwt.verify(res.body.token, JWT_SECRET) as Row).projectId).toBe(PROJECT_B);
  });

  it('switch-project to an unavailable project is refused', async () => {
    const res = await request
      .post('/api/auth/switch-project')
      .set(bearer(tokenFor(SUP_ID, PROJECT_A)))
      .send({ projectId: ARCHIVED });
    expect(res.status).toBe(400);
  });
});

// ─── Creating / archiving projects ──────────────────────────────────────

describe('project management', () => {
  it('only admin roles hold MANAGE_PROJECTS', () => {
    expect(hasPermission(UserRole.ADMIN, Permission.MANAGE_PROJECTS)).toBe(true);
    expect(hasPermission(UserRole.ADMIN_2, Permission.MANAGE_PROJECTS)).toBe(true);
    expect(hasPermission('ADMIN_7', Permission.MANAGE_PROJECTS)).toBe(true);
    for (const role of [UserRole.SUPERVISOR, UserRole.ACCOUNTANT, UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ACCOUNTS_HEAD]) {
      expect(hasPermission(role, Permission.MANAGE_PROJECTS)).toBe(false);
    }
  });

  it('a non-admin cannot create a project', async () => {
    const res = await request
      .post('/api/projects')
      .set(bearer(tokenFor(SUP_ID, PROJECT_A)))
      .send({ code: 'NEW', name: 'New Hospital' });
    expect(res.status).toBe(403);
  });

  it('an admin creates an empty project with the given code', async () => {
    const res = await request
      .post('/api/projects')
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ code: 'new', name: 'New Hospital', totalBudget: 5000000 });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('NEW');
    expect(res.body.status).toBe('ACTIVE');
    expect(db.audit.some((a) => a.entityType === 'PROJECT' && a.action === 'CREATE')).toBe(true);
  });

  it('rejects a duplicate project code', async () => {
    const res = await request
      .post('/api/projects')
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ code: 'VGH', name: 'Another' });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid code (must be 2-6 letters/digits)', async () => {
    const res = await request
      .post('/api/projects')
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ code: 'V-1', name: 'Bad code' });
    expect(res.status).toBe(400);
  });

  it('cannot archive the project you are currently working in', async () => {
    const res = await request
      .patch(`/api/projects/${PROJECT_A}`)
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ archived: true });
    expect(res.status).toBe(400);
  });

  it('can archive another project, which then disappears from the login list', async () => {
    const res = await request
      .patch(`/api/projects/${PROJECT_B}`)
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ archived: true });
    expect(res.status).toBe(200);
    const list = await request.get('/api/projects/public');
    expect(list.body.data.map((p: Row) => p.code)).toEqual(['VGH']);
  });

  it('the project code cannot be changed', async () => {
    const res = await request
      .patch(`/api/projects/${PROJECT_B}`)
      .set(bearer(tokenFor(ADMIN_ID, PROJECT_A)))
      .send({ code: 'ZZZ', name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('ABC');
  });
});

// ─── Document numbers ───────────────────────────────────────────────────

describe('per-project document numbers', () => {
  it('voucher numbers carry the project code and count independently', async () => {
    db.vouchers.push(
      { projectId: PROJECT_A, jvNumber: 'VGH-PAY0001' },
      { projectId: PROJECT_A, jvNumber: 'VGH-PAY0002' },
      { projectId: PROJECT_A, jvNumber: 'VGH-PAY0003' },
    );
    expect(await generateVoucherNumber('PAYMENT', PROJECT_A)).toBe('VGH-PAY0004');
    expect(await generateVoucherNumber('PAYMENT', PROJECT_B)).toBe('ABC-PAY0001');
    expect(await generateVoucherNumber('RECEIPT', PROJECT_B)).toBe('ABC-RCPT0001');
  });

  it('vendor codes restart at 001 in a new project without touching the old one', async () => {
    db.vendors.push({ projectId: PROJECT_A, vendorCode: 'VGH-001' }, { projectId: PROJECT_A, vendorCode: 'VGH-002' });
    expect(await generateProjectSequenceNumber('vendor', 'vendorCode', '', 3, PROJECT_A)).toBe('VGH-003');
    expect(await generateProjectSequenceNumber('vendor', 'vendorCode', '', 3, PROJECT_B)).toBe('ABC-001');
  });

  it('numbers issued for one project never collide with another project’s', async () => {
    const a = await generateProjectSequenceNumber('vendor', 'vendorCode', '', 3, PROJECT_A);
    const b = await generateProjectSequenceNumber('vendor', 'vendorCode', '', 3, PROJECT_B);
    expect(a).not.toBe(b);
  });
});
