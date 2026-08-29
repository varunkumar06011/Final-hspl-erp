/**
 * Scenario 19: Transfer Operations
 *
 * Tests all transfer endpoints:
 *   bank-to-bank, cash-to-cash, bank-to-cash, cash-to-bank
 * Also tests account statements.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `xfr-${Date.now()}`;
const { record, printReport } = makeReporter('TRANSFER OPERATIONS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let bank1Id = '';
let bank2Id = '';
let cash1Id = '';
let cash2Id = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[XFR] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Transfer Operations', () => {
  it('creates two bank accounts and two cash accounts', async () => {
    const b1 = await request
      .post('/api/bank-accounts')
      .set(authAs(ctx.userPhId))
      .send({ accountName: `HDFC Src ${RUN_ID}`, bankName: 'HDFC', accountNumber: '1111', ifscCode: 'HDFC0001', openingBalance: 500000 });
    expect(b1.status).toBe(201);
    bank1Id = b1.body.id;

    const b2 = await request
      .post('/api/bank-accounts')
      .set(authAs(ctx.userPhId))
      .send({ accountName: `SBI Dst ${RUN_ID}`, bankName: 'SBI', accountNumber: '2222', ifscCode: 'SBI0002', openingBalance: 100000 });
    expect(b2.status).toBe(201);
    bank2Id = b2.body.id;

    const c1 = await request
      .post('/api/cash-accounts')
      .set(authAs(ctx.userPhId))
      .send({ name: `Cash Src ${RUN_ID}`, openingBalance: 100000 });
    expect(c1.status).toBe(201);
    cash1Id = c1.body.id;

    const c2 = await request
      .post('/api/cash-accounts')
      .set(authAs(ctx.userPhId))
      .send({ name: `Cash Dst ${RUN_ID}`, openingBalance: 50000 });
    expect(c2.status).toBe(201);
    cash2Id = c2.body.id;

    record('accounts.create', true, `2 bank + 2 cash`);
  });

  it('transfers ₹50,000 bank-to-bank (atomic two-sided)', async () => {
    const res = await request
      .post('/api/bank-accounts/transfer')
      .set(authAs(ctx.userPhId))
      .send({ fromAccountId: bank1Id, toAccountId: bank2Id, amount: 50000, description: `Bank transfer ${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('fromTxn');
    expect(res.body).toHaveProperty('toTxn');
    expect(res.body).toHaveProperty('transferPairId');

    const [src, dst] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bank1Id } }),
      prisma.bankAccount.findUnique({ where: { id: bank2Id } }),
    ]);
    expect(Number(src!.currentBalance)).toBe(450000);
    expect(Number(dst!.currentBalance)).toBe(150000);
    record('bank.transfer', true, `src=450000 dst=150000`);
  });

  it('transfers ₹20,000 cash-to-cash (atomic two-sided)', async () => {
    const res = await request
      .post('/api/cash-accounts/transfer')
      .set(authAs(ctx.userPhId))
      .send({ fromAccountId: cash1Id, toAccountId: cash2Id, amount: 20000, description: `Cash transfer ${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('fromTxn');
    expect(res.body).toHaveProperty('toTxn');

    const [src, dst] = await Promise.all([
      prisma.cashAccount.findUnique({ where: { id: cash1Id } }),
      prisma.cashAccount.findUnique({ where: { id: cash2Id } }),
    ]);
    expect(Number(src!.currentBalance)).toBe(80000);
    expect(Number(dst!.currentBalance)).toBe(70000);
    record('cash.transfer', true, `src=80000 dst=70000`);
  });

  it('transfers ₹30,000 bank-to-cash (cross-account)', async () => {
    const res = await request
      .post('/api/cash-accounts/bank-to-cash')
      .set(authAs(ctx.userPhId))
      .send({ bankAccountId: bank1Id, cashAccountId: cash1Id, amount: 30000, description: `Bank to cash ${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('bankTxn');
    expect(res.body).toHaveProperty('cashTxn');

    const [bank, cash] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bank1Id } }),
      prisma.cashAccount.findUnique({ where: { id: cash1Id } }),
    ]);
    expect(Number(bank!.currentBalance)).toBe(420000);
    expect(Number(cash!.currentBalance)).toBe(110000);
    record('bank-to-cash', true, `bank=420000 cash=110000`);
  });

  it('transfers ₹10,000 cash-to-bank (cross-account)', async () => {
    const res = await request
      .post('/api/cash-accounts/cash-to-bank')
      .set(authAs(ctx.userPhId))
      .send({ bankAccountId: bank2Id, cashAccountId: cash1Id, amount: 10000, description: `Cash to bank ${RUN_ID}` });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('cashTxn');
    expect(res.body).toHaveProperty('bankTxn');

    const [bank, cash] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bank2Id } }),
      prisma.cashAccount.findUnique({ where: { id: cash1Id } }),
    ]);
    expect(Number(bank!.currentBalance)).toBe(160000);
    expect(Number(cash!.currentBalance)).toBe(100000);
    record('cash-to-bank', true, `bank=160000 cash=100000`);
  });

  it('rejects transfer to the same account', async () => {
    const res = await request
      .post('/api/bank-accounts/transfer')
      .set(authAs(ctx.userPhId))
      .send({ fromAccountId: bank1Id, toAccountId: bank1Id, amount: 1000 });
    expect(res.status).toBe(400);
    record('transfer.sameAccount', true, `400 as expected`);
  });

  it('rejects transfer with insufficient balance', async () => {
    const res = await request
      .post('/api/bank-accounts/transfer')
      .set(authAs(ctx.userPhId))
      .send({ fromAccountId: bank1Id, toAccountId: bank2Id, amount: 999999999 });
    expect([400, 500]).toContain(res.status);
    record('transfer.insufficient', true, `${res.status} as expected`);
  });

  it('GET bank account statement shows transactions', async () => {
    const res = await request.get(`/api/bank-accounts/${bank1Id}/statement`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('account');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
    // bank1 had: transfer out 50k, bank-to-cash 30k = 2 transactions
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    record('bank.statement', true, `txns=${res.body.data.length}`);
  });

  it('GET cash account statement shows transactions', async () => {
    const res = await request.get(`/api/cash-accounts/${cash1Id}/statement`).set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('account');
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    // cash1 had: transfer in 20k, bank-to-cash in 30k, cash-to-bank out 10k = 3 transactions
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    record('cash.statement', true, `txns=${res.body.data.length}`);
  });
});
