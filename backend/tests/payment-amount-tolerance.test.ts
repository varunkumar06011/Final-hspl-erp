/**
 * Payment voucher amount matching: a payment request may be marked PAID when
 * the paid amount / voucher total is within ±₹1 of the approved amount.
 * Covers the shared helper and the /pay, /:id/link-voucher and
 * /link-voucher-multi endpoints (Prisma mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { isWithinPaymentTolerance, splitPaidAmount, toPaise } from '@hospital-erp/shared';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const VOUCHER_ID = '22222222-2222-4222-8222-222222222222';
const reqId = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
const BANK_ID = '44444444-4444-4444-8444-444444444444';

const { db } = vi.hoisted(() => ({
  db: {
    voucher: null as any,
    requests: [] as any[],
    claimed: [] as string[],
    created: [] as any[],
    // /pay runs a long transaction (accounts, ledgers, voucher posting) that is
    // out of scope here: when set, $transaction only records that it was reached.
    stubTransaction: false,
    transactionCalls: 0,
  },
}));

vi.mock('../src/config/prisma', () => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    payment: {
      findFirst: vi.fn(async () => null),
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
      findFirst: vi.fn(async ({ where }: any) => db.requests.find((r) => r.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => db.requests.filter((r) => where.id.in.includes(r.id))),
    },
    $transaction: vi.fn(async (fn: any) => {
      db.transactionCalls++;
      if (db.stubTransaction) return { id: 'pay-stub' };
      return fn(tx);
    }),
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
vi.mock('../src/services/payment-notify.service', () => ({ notifyPaymentsMade: vi.fn() }));
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

function makeRequest(n: number, amount: number, overrides: Record<string, unknown> = {}) {
  return {
    id: reqId(n),
    requestNumber: `PR${n}`,
    paymentCode: `PAY-${n}`,
    status: 'APPROVED',
    amount,
    invoiceId: null,
    invoice: null,
    purchaseOrder: null,
    budgetHeadId: null,
    payments: [],
    ...overrides,
  };
}

function makeVoucher(total: number) {
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
  };
}

beforeEach(() => {
  db.voucher = null;
  db.requests = [];
  db.claimed = [];
  db.created = [];
  db.stubTransaction = false;
  db.transactionCalls = 0;
});

// The requested cases: voucher amount ₹1,000
const CASES: Array<[label: string, paid: number, ok: boolean]> = [
  ['exact amount', 1000, true],
  ['₹1 less', 999, true],
  ['₹1 more', 1001, true],
  ['₹1.01 less', 998.99, false],
  ['₹1.01 more', 1001.01, false],
  ['₹2 less', 998, false],
  ['₹2 more', 1002, false],
];

describe('isWithinPaymentTolerance', () => {
  it.each(CASES)('%s (₹1,000 vs ₹%s)', (_label, paid, ok) => {
    expect(isWithinPaymentTolerance(1000, paid)).toBe(ok);
  });

  it('handles decimal amounts without floating-point error', () => {
    // 0.1 + 0.2 style noise must not tip the boundary either way
    expect(isWithinPaymentTolerance(1000.1, 999.1)).toBe(true);
    expect(isWithinPaymentTolerance(1000.1, 1001.1)).toBe(true);
    expect(isWithinPaymentTolerance(0.1 + 0.2, 1.3)).toBe(true);
    expect(isWithinPaymentTolerance(1234.56, 1235.56)).toBe(true);
    expect(isWithinPaymentTolerance(1234.56, 1233.55)).toBe(false);
    expect(isWithinPaymentTolerance(1234.56, 1234.565)).toBe(true);
    expect(isWithinPaymentTolerance('1,000.50', '999.50')).toBe(true);
  });

  it('rejects zero, negative and invalid paid amounts', () => {
    expect(isWithinPaymentTolerance(1000, 0)).toBe(false);
    expect(isWithinPaymentTolerance(1000, -1000)).toBe(false);
    expect(isWithinPaymentTolerance(0.5, -0.4)).toBe(false);
    expect(isWithinPaymentTolerance(1000, NaN)).toBe(false);
    expect(isWithinPaymentTolerance(1000, Infinity)).toBe(false);
    expect(isWithinPaymentTolerance(1000, 'abc')).toBe(false);
    expect(isWithinPaymentTolerance(NaN, 1000)).toBe(false);
  });

  it('toPaise rounds to whole paise', () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(999.99)).toBe(99999);
  });
});

describe('splitPaidAmount', () => {
  it('keeps exact amounts when the total matches', () => {
    expect(splitPaidAmount([500, 300, 200], 1000)).toEqual([500, 300, 200]);
  });

  it('puts the ≤ ₹1 difference on the largest request, summing to the paid total', () => {
    expect(splitPaidAmount([300, 500, 200], 999)).toEqual([300, 499, 200]);
    expect(splitPaidAmount([300, 500, 200], 1001)).toEqual([300, 501, 200]);
    const parts = splitPaidAmount([333.33, 333.33, 333.34], 1000.5)!;
    expect(toPaise(parts.reduce((s, p) => s + p, 0))).toBe(100050);
  });

  it('refuses totals more than ₹1 off and invalid inputs', () => {
    expect(splitPaidAmount([500, 500], 998.99)).toBeNull();
    expect(splitPaidAmount([500, 500], 1001.01)).toBeNull();
    expect(splitPaidAmount([500, 500], -1000)).toBeNull();
    expect(splitPaidAmount([500, -500], 0)).toBeNull();
    expect(splitPaidAmount([], 0)).toBeNull();
  });
});

describe('POST /payments/:id/pay — amount within ±₹1', () => {
  const pay = (amount: number) =>
    request.post(`/payments/${reqId(1)}/pay`).send({ amount, mode: 'BANK_TRANSFER', bankAccountId: BANK_ID });

  it.each(CASES)('%s (₹%s)', async (_label, paid, ok) => {
    db.requests = [makeRequest(1, 1000)];
    db.stubTransaction = true;
    const res = await pay(paid);
    if (ok) {
      expect(res.status).toBe(201);
      expect(db.transactionCalls).toBe(1);
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/within ₹1 of the approved amount/);
      expect(db.transactionCalls).toBe(0);
    }
  });

  it('accepts decimal amounts within ₹1 and rejects beyond', async () => {
    db.requests = [makeRequest(1, 1500.75)];
    db.stubTransaction = true;
    expect((await pay(1499.75)).status).toBe(201);
    expect((await pay(1501.75)).status).toBe(201);
    expect((await pay(1499.74)).status).toBe(400);
  });

  it('still rejects a negative amount (validation)', async () => {
    db.requests = [makeRequest(1, 1)];
    db.stubTransaction = true;
    const res = await pay(-0.5);
    expect(res.status).toBe(400);
    expect(db.transactionCalls).toBe(0);
  });

  it('still rejects a zero amount, even when the approved amount is under ₹1', async () => {
    db.requests = [makeRequest(1, 0.5)];
    db.stubTransaction = true;
    const res = await pay(0);
    expect(res.status).toBe(400);
    expect(db.transactionCalls).toBe(0);
  });
});

describe('POST /payments/:id/link-voucher — voucher within ±₹1', () => {
  const link = () => request.post(`/payments/${reqId(1)}/link-voucher`).send({ journalVoucherId: VOUCHER_ID });

  it.each(CASES)('%s (voucher ₹%s)', async (_label, total, ok) => {
    db.requests = [makeRequest(1, 1000)];
    db.voucher = makeVoucher(total);
    const res = await link();
    if (ok) {
      expect(res.status).toBe(201);
      expect(db.claimed).toEqual([reqId(1)]);
      // the actual paid amount is recorded; the approved amount is untouched
      expect(db.created).toHaveLength(1);
      expect(db.created[0].amount).toBe(total);
      expect(db.requests[0].amount).toBe(1000);
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/within ₹1 of the approved amount/);
      expect(db.created).toHaveLength(0);
      expect(db.claimed).toHaveLength(0);
    }
  });

  it('records a decimal voucher total as paid', async () => {
    db.requests = [makeRequest(1, 2500.4)];
    db.voucher = makeVoucher(2499.9);
    const res = await link();
    expect(res.status).toBe(201);
    expect(db.created[0].amount).toBe(2499.9);
  });
});

describe('POST /payments/link-voucher-multi — total within ±₹1', () => {
  const ids = [1, 2, 3].map(reqId);
  const linkMulti = () =>
    request.post('/payments/link-voucher-multi').send({ journalVoucherId: VOUCHER_ID, paymentRequestIds: ids });

  beforeEach(() => {
    db.requests = [makeRequest(1, 300), makeRequest(2, 500), makeRequest(3, 200)];
  });

  it.each(CASES)('%s (voucher ₹%s for requests totalling ₹1,000)', async (_label, total, ok) => {
    db.voucher = makeVoucher(total);
    const res = await linkMulti();
    if (ok) {
      expect(res.status).toBe(201);
      expect(db.created).toHaveLength(3);
      // recorded amounts add up to exactly what the voucher paid
      expect(toPaise(db.created.reduce((s, p) => s + p.amount, 0))).toBe(toPaise(total));
      expect(db.requests.map((r) => r.amount)).toEqual([300, 500, 200]);
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/within ₹1 of each other/);
      expect(db.created).toHaveLength(0);
      expect(db.claimed).toHaveLength(0);
    }
  });

  it('puts the difference on the largest request', async () => {
    db.voucher = makeVoucher(999.5);
    const res = await linkMulti();
    expect(res.status).toBe(201);
    const byRequest = Object.fromEntries(db.created.map((p) => [p.paymentRequestId, p.amount]));
    expect(byRequest).toEqual({ [reqId(1)]: 300, [reqId(2)]: 499.5, [reqId(3)]: 200 });
  });
});
