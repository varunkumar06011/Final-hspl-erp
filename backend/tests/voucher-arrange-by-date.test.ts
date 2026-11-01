/**
 * POST /vouchers/arrange-by-date — hands a type's existing voucher numbers back out in date
 * order. Prisma is mocked; checks which numbers move and that nothing but jvNumber changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

const { db } = vi.hoisted(() => ({
  db: {
    vouchers: [] as any[],
    updates: [] as Array<{ id: string; data: any }>,
    ledgerUpdates: [] as Array<{ id: string; voucherNumber: string }>,
  },
}));

vi.mock('../src/config/prisma', () => {
  const tx = {
    journalVoucher: {
      findMany: vi.fn(async ({ where }: any) => db.vouchers.filter((v) => v.voucherType === where.voucherType)),
      update: vi.fn(async ({ where, data }: any) => {
        db.updates.push({ id: where.id, data });
        return {};
      }),
    },
    ledgerEntry: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        db.ledgerUpdates.push({ id: where.journalVoucherId, voucherNumber: data.voucherNumber });
        return { count: 1 };
      }),
    },
  };
  return { prisma: { $transaction: vi.fn(async (fn: any) => fn(tx)) } };
});
vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', projectId: PROJECT_ID, role: 'ADMIN_1' };
    next();
  },
  requireProjectId: () => PROJECT_ID,
}));
vi.mock('../src/middleware/rbac', () => ({ rbacMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../src/services/project.service', () => ({ getProjectCode: vi.fn(async () => 'VGH') }));
vi.mock('../src/services/invoice-payment.service', () => ({ recalcInvoicePaymentStatus: vi.fn() }));
vi.mock('../src/services/payment-notify.service', () => ({ notifyPaymentsMade: vi.fn() }));
vi.mock('../src/routes/ledger.routes', () => ({ ensureVendorLedger: vi.fn(), findLedgerByName: vi.fn() }));

import voucherRouter from '../src/routes/voucher.routes';

const app = express();
app.use(express.json());
app.use('/vouchers', voucherRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
const request = supertest(app);

const pay = (n: number, date: string, createdAt = '2026-01-01T00:00:00Z') => ({
  id: `id-${n}`,
  voucherType: 'PAYMENT',
  jvNumber: `VGH-PAY${String(n).padStart(4, '0')}`,
  date: new Date(date),
  createdAt: new Date(createdAt),
});
const numberOf = (id: string) => db.updates.filter((u) => u.id === id && !u.data.jvNumber.includes('TMP')).at(-1)?.data.jvNumber;

describe('POST /vouchers/arrange-by-date', () => {
  beforeEach(() => {
    db.vouchers = [];
    db.updates = [];
    db.ledgerUpdates = [];
  });

  it('gives the lowest number to the oldest date, keeping the same set of numbers', async () => {
    db.vouchers = [pay(1, '2026-10-05'), pay(2, '2026-10-01'), pay(3, '2026-10-03')];
    const res = await request.post('/vouchers/arrange-by-date').send({ voucherType: 'PAYMENT' });
    expect(res.status).toBe(200);
    expect(res.body.renumbered).toBe(3);
    expect(numberOf('id-2')).toBe('VGH-PAY0001');
    expect(numberOf('id-3')).toBe('VGH-PAY0002');
    expect(numberOf('id-1')).toBe('VGH-PAY0003');
    // only the number and its ledger snapshot are written
    for (const u of db.updates) expect(Object.keys(u.data)).toEqual(['jvNumber']);
    expect(db.ledgerUpdates.map((l) => l.voucherNumber).sort()).toEqual(['VGH-PAY0001', 'VGH-PAY0002', 'VGH-PAY0003']);
  });

  it('leaves vouchers already in order alone', async () => {
    db.vouchers = [pay(1, '2026-10-01'), pay(2, '2026-10-02'), pay(3, '2026-10-02')];
    const res = await request.post('/vouchers/arrange-by-date').send({ voucherType: 'PAYMENT' });
    expect(res.body.renumbered).toBe(0);
    expect(db.updates).toHaveLength(0);
  });

  it('keeps the current order within the same day and only moves what is out of place', async () => {
    db.vouchers = [pay(1, '2026-10-01'), pay(2, '2026-10-04'), pay(3, '2026-10-02'), pay(4, '2026-10-04')];
    const res = await request.post('/vouchers/arrange-by-date').send({ voucherType: 'PAYMENT' });
    expect(res.body.renumbered).toBe(2);
    expect(numberOf('id-3')).toBe('VGH-PAY0002');
    expect(numberOf('id-2')).toBe('VGH-PAY0003');
    expect(numberOf('id-1')).toBeUndefined();
    expect(numberOf('id-4')).toBeUndefined();
  });

  it('keeps gaps: it reuses the numbers that exist, never invents new ones', async () => {
    db.vouchers = [pay(2, '2026-10-09'), pay(7, '2026-10-01')];
    await request.post('/vouchers/arrange-by-date').send({ voucherType: 'PAYMENT' });
    expect(numberOf('id-7')).toBe('VGH-PAY0002');
    expect(numberOf('id-2')).toBe('VGH-PAY0007');
  });

  it('rejects an unknown voucher type', async () => {
    const res = await request.post('/vouchers/arrange-by-date').send({ voucherType: 'NOPE' });
    expect(res.status).toBe(400);
  });
});
