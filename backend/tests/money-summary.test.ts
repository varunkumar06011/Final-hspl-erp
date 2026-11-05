/**
 * Payment Sheets → money paid & received (Prisma/auth mocked; no database needed).
 *  - payments = bank WITHDRAWAL / cash OUT, receipts = bank DEPOSIT / cash IN
 *  - a reversal counts against the side it undoes
 *  - transfers between own accounts are never counted
 *  - the PAID / RECEIVED filter narrows both rows and totals
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

const PROJECT = '00000000-0000-0000-0000-00000000000a';
type Row = Record<string, any>;

const calls = vi.hoisted(() => ({ bankWhere: null as Row | null, cashWhere: null as Row | null }));

vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: Row, _res: Row, next: () => void) => {
    req.user = { id: 'u1', role: 'ADMIN', projectId: PROJECT, isActive: true };
    next();
  },
  requireProjectId: (req: Row) => req.user.projectId,
}));
vi.mock('../src/middleware/rbac', () => ({ rbacMiddleware: () => (_q: Row, _r: Row, next: () => void) => next() }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn() }));
vi.mock('../src/services/storage.service', () => ({ getStorageService: () => ({}), serveFile: vi.fn() }));
vi.mock('../src/services/payment-sheet-pdf.service', () => ({ streamPaymentSheetPdf: vi.fn() }));

vi.mock('../src/config/prisma', () => {
  const d = (s: string) => new Date(s);
  const all = (types: string[]) => (types.length ? types : []);
  const bankRows = [
    { id: 'b1', type: 'WITHDRAWAL', amount: 1000, date: d('2026-11-05T10:00:00Z'), description: 'Cement', referenceId: 'v1', bankAccount: { accountName: 'HDFC' } },
    { id: 'b2', type: 'DEPOSIT', amount: 5000, date: d('2026-11-05T11:00:00Z'), description: 'Owner funds', referenceId: null, bankAccount: { accountName: 'HDFC' } },
    { id: 'b3', type: 'REVERSAL_IN', amount: 200, date: d('2026-11-05T12:00:00Z'), description: 'REVERSAL: Cement', referenceId: 'v1', bankAccount: { accountName: 'HDFC' } },
  ];
  const cashRows = [{ id: 'c1', type: 'OUT', amount: 300, date: d('2026-11-05T09:00:00Z'), description: null, referenceId: null, cashAccount: { name: 'Site cash' } }];
  const filter = (rows: Row[], where: Row) => rows.filter((r) => all(where.type.in).includes(r.type)); // transfers never in the list
  return {
    prisma: {
      bankTransaction: { findMany: vi.fn(async ({ where }: Row) => { calls.bankWhere = where; return filter(bankRows, where); }) },
      cashTransaction: { findMany: vi.fn(async ({ where }: Row) => { calls.cashWhere = where; return filter(cashRows, where); }) },
      journalVoucher: { findMany: vi.fn(async () => [{ id: 'v1', jvNumber: 'VGH-PAY0001', description: 'Paid to vendor' }]) },
      paymentSheet: {},
      paymentSheetNarration: {},
    },
  };
});

import router from '../src/routes/payment-sheet.routes';

const app = express();
app.use('/payment-sheets', router);
const get = (q = '') => supertest(app).get(`/payment-sheets/money-summary${q}`);

describe('money summary', () => {
  it('BOTH: paid is net of reversal, received counted, transfers excluded', async () => {
    const res = await get('?startDate=2026-11-05&endDate=2026-11-05');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ paid: 1000 + 300 - 200, received: 5000, net: 5000 - 1100 });
    const types: string[] = [...calls.bankWhere!.type.in];
    expect(types).not.toContain('TRANSFER_IN');
    expect(types).not.toContain('TRANSFER_OUT');
    expect(calls.bankWhere!.status).toBe('POSTED');
    expect(calls.bankWhere!.bankAccount.projectId).toBe(PROJECT);
    const reversal = res.body.data.find((r: Row) => r.id === 'b3');
    expect(reversal).toMatchObject({ direction: 'PAID', amount: -200, isReversal: true, voucherNumber: 'VGH-PAY0001' });
  });

  it('PAID filter returns only payments and zero received', async () => {
    const res = await get('?direction=PAID');
    expect(res.body.data.every((r: Row) => r.direction === 'PAID')).toBe(true);
    expect(res.body.totals.received).toBe(0);
    expect(res.body.totals.paid).toBe(1100);
  });

  it('RECEIVED filter returns only receipts', async () => {
    const res = await get('?direction=RECEIVED');
    expect(res.body.data.map((r: Row) => r.id)).toEqual(['b2']);
    expect(res.body.totals).toEqual({ paid: 0, received: 5000, net: 5000 });
  });
});
