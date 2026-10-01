/**
 * POST /payments/link-voucher-multi — one posted PAYMENT voucher settling
 * several approved payment requests (e.g. 4 POs to one vendor, one transfer).
 * Prisma is mocked; this exercises the handler's validation and write set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const VOUCHER_ID = '22222222-2222-4222-8222-222222222222';
const reqId = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;

const { db } = vi.hoisted(() => ({
  db: {
    voucher: null as any,
    requests: [] as any[],
    existingLink: null as any,
    claimed: [] as string[],
    created: [] as any[],
  },
}));

vi.mock('../src/config/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    payment: {
      findFirst: vi.fn(async () => db.existingLink),
      create: vi.fn(async ({ data }: any) => {
        db.created.push(data);
        return { id: `pay-${db.created.length}`, ...data };
      }),
    },
    paymentRequest: {
      updateMany: vi.fn(async ({ where }: any) => {
        db.claimed.push(where.id);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    journalVoucher: { findFirst: vi.fn(async () => db.voucher) },
    paymentRequest: {
      findMany: vi.fn(async ({ where }: any) => db.requests.filter((r) => where.id.in.includes(r.id))),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  return { prisma };
});

vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', projectId: PROJECT_ID, role: 'ACCOUNTANT' };
    next();
  },
  requireProjectId: () => PROJECT_ID,
}));
vi.mock('../src/middleware/rbac', () => ({ rbacMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../src/services/sequence.service', () => ({ generateSequenceNumber: vi.fn() }));
vi.mock('../src/services/approval.service', () => ({}));
vi.mock('../src/services/push.service', () => ({ notifyApprovers: vi.fn() }));
vi.mock('../src/services/storage.service', () => ({ getStorageService: vi.fn(), serveFile: vi.fn() }));
vi.mock('../src/routes/voucher.routes', () => ({ postVoucher: vi.fn(), generateVoucherNumber: vi.fn() }));
vi.mock('../src/routes/ledger.routes', () => ({
  ensureVendorLedger: vi.fn(),
  ensureBankLedger: vi.fn(),
  ensureCashLedger: vi.fn(),
  findLedgerByName: vi.fn(),
}));
vi.mock('../src/services/invoice-payment.service', () => ({
  getInvoicePaymentSummary: vi.fn(async () => ({ outstanding: 1_000_000 })),
  recalcInvoicePaymentStatus: vi.fn(async () => {}),
}));

import paymentRouter from '../src/routes/payment.routes';

const app = express();
app.use(express.json());
app.use('/payments', paymentRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
const request = supertest(app);

function makeRequests(amounts: number[]) {
  return amounts.map((amount, i) => ({
    id: reqId(i + 1),
    requestNumber: `ADV-PO${i + 1}`,
    status: 'APPROVED',
    amount,
    invoiceId: null,
    budgetHeadId: null,
    payments: [],
  }));
}

function makeVoucher(total: number, overrides: Record<string, unknown> = {}) {
  return {
    id: VOUCHER_ID,
    jvNumber: 'PAY0099',
    status: 'POSTED',
    voucherType: 'PAYMENT',
    totalDebit: total,
    chequeNumber: null,
    postedAt: new Date('2026-09-30'),
    payments: [],
    ledgerEntries: [{ credit: total, ledger: { linkedEntityType: 'BANK_ACCOUNT', linkedEntityId: 'bank-1' } }],
    ...overrides,
  };
}

const post = (ids: string[]) => request.post('/payments/link-voucher-multi').send({ journalVoucherId: VOUCHER_ID, paymentRequestIds: ids });

describe('POST /payments/link-voucher-multi', () => {
  beforeEach(() => {
    db.voucher = makeVoucher(38000);
    db.requests = makeRequests([10000, 9000, 9500, 9500]);
    db.existingLink = null;
    db.claimed = [];
    db.created = [];
  });

  it('links one voucher to four requests whose amounts add up to the voucher', async () => {
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(201);
    expect(db.claimed.sort()).toEqual([1, 2, 3, 4].map(reqId));
    expect(db.created).toHaveLength(4);
    expect(db.created.every((p) => p.journalVoucherId === VOUCHER_ID && p.bankAccountId === 'bank-1')).toBe(true);
    expect(db.created.reduce((s, p) => s + p.amount, 0)).toBe(38000);
  });

  it('rejects when the requests do not add up to the voucher, and writes nothing', async () => {
    db.requests = makeRequests([10000, 9000, 9500, 9000]);
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must match exactly/);
    expect(db.created).toHaveLength(0);
    expect(db.claimed).toHaveLength(0);
  });

  it('rejects fewer than two requests', async () => {
    const res = await post([reqId(1)]);
    expect(res.status).toBe(400);
    expect(db.created).toHaveLength(0);
  });

  it('rejects the same request listed twice (counts as one)', async () => {
    const res = await post([reqId(1), reqId(1)]);
    expect(res.status).toBe(400);
    expect(db.created).toHaveLength(0);
  });

  it('rejects a voucher that is already linked to a payment', async () => {
    db.voucher = makeVoucher(38000, { payments: [{ id: 'p' }] });
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(409);
    expect(db.created).toHaveLength(0);
  });

  it('rejects a request that is not APPROVED', async () => {
    db.requests[2].status = 'PENDING';
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be APPROVED/);
    expect(db.created).toHaveLength(0);
  });

  it('rejects a request that already has a payment', async () => {
    db.requests[0].payments = [{ id: 'p' }];
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(409);
    expect(db.created).toHaveLength(0);
  });

  it('rejects a voucher that does not credit a bank or cash account', async () => {
    db.voucher = makeVoucher(38000, { ledgerEntries: [{ credit: 38000, ledger: { linkedEntityType: null, linkedEntityId: null } }] });
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bank or cash/);
    expect(db.created).toHaveLength(0);
  });

  it('refuses if another link appears for the voucher inside the transaction', async () => {
    db.existingLink = { id: 'raced' };
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(409);
    expect(db.created).toHaveLength(0);
  });

  it('404s when a selected request does not exist', async () => {
    db.requests = db.requests.slice(0, 3);
    const res = await post([1, 2, 3, 4].map(reqId));
    expect(res.status).toBe(404);
    expect(db.created).toHaveLength(0);
  });
});
