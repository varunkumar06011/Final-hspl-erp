import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  project: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: db }));

const myWork = vi.hoisted(() => ({ getMyWork: vi.fn() }));
vi.mock('../src/services/my-work.service', () => myWork);

import {
  createLinkCode,
  getTaskHubApprovals,
  isValidTaskHubSecret,
  noteApprovalWrite,
  recordUrl,
  redeemLinkCode,
  resetLinkCodesForTests,
  signNudge,
  stopTaskHubNudges,
  TaskHubLinkError,
} from '../src/services/taskhub.service';

const userRow = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  firebaseUid: 'f',
  phone: '+91',
  name: 'Ravi',
  role: 'PROJECT_HEAD',
  projectId: null,
  isActive: true,
  termsAcceptedAt: null,
  extraPermissions: [],
  moduleAccess: null,
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  kind: 'PO',
  id: 'po1',
  number: 'VGH-PO001',
  party: 'Lakshmi Steel',
  amount: 1000,
  summary: null,
  why: null,
  status: 'PENDING_APPROVAL',
  action: 'APPROVE',
  requestedBy: 'Sita',
  waitingOn: ['PROJECT_HEAD'],
  waitingSince: new Date('2026-10-20').toISOString(),
  path: '/pos?id=po1',
  flags: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TASKHUB_SYNC_SECRET = 'shared-secret';
  process.env.FRONTEND_URL = 'https://erp.example.com/,http://localhost:5174';
  delete process.env.ERP_PUBLIC_URL;
  delete process.env.TASKHUB_WEBHOOK_URL;
});

describe('shared secret', () => {
  it('accepts only the exact secret', () => {
    expect(isValidTaskHubSecret('shared-secret')).toBe(true);
    expect(isValidTaskHubSecret('shared-secreT')).toBe(false);
    expect(isValidTaskHubSecret(undefined)).toBe(false);
    expect(isValidTaskHubSecret(['shared-secret'])).toBe(false);
  });

  it('accepts nothing when no secret is configured', () => {
    delete process.env.TASKHUB_SYNC_SECRET;
    expect(isValidTaskHubSecret('')).toBe(false);
    expect(isValidTaskHubSecret('anything')).toBe(false);
  });
});

describe('link codes', () => {
  beforeEach(() => resetLinkCodesForTests());

  it('gives an approver a 6-digit code that redeems once to their user', async () => {
    const { code, expiresAt } = createLinkCode({ id: 'u1', role: 'ADMIN_2' });
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    db.user.findUnique.mockResolvedValue(userRow({ id: 'u1', role: 'HEAD_OF_CONSTRUCTION' }));
    const user = await redeemLinkCode(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(user).toEqual({ id: 'u1', name: 'Ravi', role: 'HEAD_OF_CONSTRUCTION', roleLabel: 'Head of Construction' });
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    await expect(redeemLinkCode(code)).rejects.toMatchObject({ code: 'CODE_INVALID' });
  });

  it('refuses roles that are not approvers, but lets a super admin in', () => {
    expect(() => createLinkCode({ id: 'u1', role: 'ACCOUNTANT' })).toThrow(TaskHubLinkError);
    expect(createLinkCode({ id: 'u1', role: 'ACCOUNTANT', extraPermissions: ['*'] }).code).toMatch(/^\d{6}$/);
  });

  it('a new code replaces the same person\'s earlier one', async () => {
    const first = createLinkCode({ id: 'u1', role: 'ADMIN' }).code;
    const second = createLinkCode({ id: 'u1', role: 'ADMIN' }).code;
    db.user.findUnique.mockResolvedValue(userRow({ id: 'u1', role: 'ADMIN' }));
    if (first !== second) await expect(redeemLinkCode(first)).rejects.toMatchObject({ code: 'CODE_INVALID' });
    await expect(redeemLinkCode(second)).resolves.toMatchObject({ id: 'u1' });
  });

  it('expires codes after 10 minutes', async () => {
    vi.useFakeTimers();
    try {
      const { code } = createLinkCode({ id: 'u1', role: 'ADMIN' });
      vi.advanceTimersByTime(10 * 60_000 + 1);
      await expect(redeemLinkCode(code)).rejects.toMatchObject({ code: 'CODE_INVALID' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed codes and codes of deactivated users', async () => {
    await expect(redeemLinkCode('12345')).rejects.toMatchObject({ code: 'CODE_INVALID' });
    const { code } = createLinkCode({ id: 'u1', role: 'ADMIN' });
    db.user.findUnique.mockResolvedValue(userRow({ isActive: false }));
    await expect(redeemLinkCode(code)).rejects.toMatchObject({ code: 'CODE_INVALID' });
  });
});

describe('approvals for Task Hub', () => {
  it('lists decisions from every live project, oldest first, with links into the right project', async () => {
    db.user.findUnique.mockResolvedValue(userRow());
    db.project.findMany.mockResolvedValue([
      { id: 'p1', code: 'VGH', name: 'V Grand' },
      { id: 'p2', code: 'ABC', name: 'ABC Hospital' },
    ]);
    myWork.getMyWork.mockImplementation(async (projectId: string) => ({
      needsAction:
        projectId === 'p1'
          ? [item(), item({ id: 'g1', kind: 'GRN', action: 'INSPECT' })]
          : [item({ id: 'q1', kind: 'QUOTATION', action: 'FINALIZE', path: '/quotations?id=q1', waitingSince: new Date('2026-10-01').toISOString() })],
      drafts: [item({ id: 'd1' })],
      sentBack: [],
      waiting: [],
    }));

    const res = await getTaskHubApprovals('11111111-1111-1111-1111-111111111111');
    expect(res.eligible).toBe(true);
    expect(res.user?.roleLabel).toBe('Project Head');
    expect(res.items.map((i) => i.id)).toEqual(['q1', 'po1']);
    expect(res.items[0].project.code).toBe('ABC');
    expect(res.items[0].url).toBe('https://erp.example.com/quotations?id=q1&project=p2');
    expect(myWork.getMyWork).toHaveBeenCalledWith('p1', expect.objectContaining({ role: 'PROJECT_HEAD' }));
  });

  it('returns nothing for a user who lost the approver role, and no user when deactivated', async () => {
    db.user.findUnique.mockResolvedValue(userRow({ role: 'ACCOUNTANT' }));
    const res = await getTaskHubApprovals('u');
    expect(res).toMatchObject({ eligible: false, items: [] });
    expect(res.user?.role).toBe('ACCOUNTANT');
    expect(myWork.getMyWork).not.toHaveBeenCalled();

    db.user.findUnique.mockResolvedValue(userRow({ isActive: false }));
    expect((await getTaskHubApprovals('u')).user).toBeNull();
  });

  it('builds record links with an explicit ERP address when set', () => {
    process.env.ERP_PUBLIC_URL = 'https://app.vgrand.in';
    expect(recordUrl('/pos', 'p1')).toBe('https://app.vgrand.in/pos?project=p1');
  });
});

describe('approvals-changed nudge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TASKHUB_WEBHOOK_URL = 'https://taskhub.example.com/api/erp/webhook';
  });
  afterEach(() => {
    stopTaskHubNudges();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends one signed nudge for a burst of approval writes, and none for other tables', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    noteApprovalWrite('Ledger', 'create');
    noteApprovalWrite('ApprovalStep', 'findMany');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();

    noteApprovalWrite('ApprovalStep', 'update');
    await vi.advanceTimersByTimeAsync(2000);
    noteApprovalWrite('PurchaseOrder', 'update');
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://taskhub.example.com/api/erp/webhook');
    const body = JSON.parse(init.body);
    expect(body.event).toBe('erp.approvals.changed');
    expect(body.models.sort()).toEqual(['ApprovalStep', 'PurchaseOrder']);
    const ts = init.headers['x-erp-timestamp'];
    const expected = crypto.createHmac('sha256', 'shared-secret').update(`${ts}.${init.body}`).digest('hex');
    expect(init.headers['x-erp-signature']).toBe(expected);
    expect(signNudge(ts, init.body)).toBe(expected);
  });

  it('still sends during a steady stream of writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 10; i++) {
      noteApprovalWrite('ApprovalStep', 'update');
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does nothing without a webhook address', async () => {
    delete process.env.TASKHUB_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    noteApprovalWrite('ApprovalStep', 'update');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('routes', { timeout: 30_000 }, () => {
  const app = async () => {
    const express = (await import('express')).default;
    const router = (await import('../src/routes/taskhub.routes')).default;
    const a = express();
    a.use(express.json());
    a.use('/t', router);
    return a;
  };
  const request = async () => (await import('supertest')).default;

  it('refuses server calls without the right secret', async () => {
    const r = await request();
    const a = await app();
    expect((await r(a).get('/t/approvals?erpUserId=11111111-1111-1111-1111-111111111111')).status).toBe(401);
    expect((await r(a).post('/t/link').set('x-taskhub-secret', 'nope').send({ code: '123456' })).status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('answers 503 when the integration is not configured', async () => {
    delete process.env.TASKHUB_SYNC_SECRET;
    const res = await (await request())(await app()).get('/t/approvals?erpUserId=x').set('x-taskhub-secret', '');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TASKHUB_NOT_CONFIGURED');
  });

  it('serves approvals and validates the user id with the secret', async () => {
    const r = await request();
    const a = await app();
    expect((await r(a).get('/t/approvals?erpUserId=bad').set('x-taskhub-secret', 'shared-secret')).status).toBe(400);
    db.user.findUnique.mockResolvedValue(null);
    const ok = await r(a)
      .get('/t/approvals?erpUserId=11111111-1111-1111-1111-111111111111')
      .set('x-taskhub-secret', 'shared-secret');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ user: null, eligible: false, items: [] });
  });

  it('turns a bad code into a 400 with a reason code', async () => {
    const res = await (await request())(await app())
      .post('/t/link')
      .set('x-taskhub-secret', 'shared-secret')
      .send({ code: '12' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CODE_INVALID');
  });
});
