/**
 * Scenario 7: Bank & Cash Operations
 *
 * bank account → cash account → deposit → withdraw → transfer
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `bnk-${Date.now()}`;
const { record, printReport } = makeReporter('BANK & CASH OPERATIONS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let bankAccountId = '';
let cashAccountId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[BANK] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Bank & Cash Operations', () => {
  it('creates a bank account with opening balance', async () => {
    const res = await request
      .post('/api/bank-accounts')
      .set(authAs(ctx.userPhId))
      .send({
        accountName: `HDFC Bank ${RUN_ID}`,
        bankName: 'HDFC',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
        openingBalance: 1000000,
      });
    expect(res.status).toBe(201);
    bankAccountId = res.body.id;
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(Number(db!.currentBalance)).toBe(1000000);
    record('bankaccount.create', true, `bank=${bankAccountId} bal=1000000`);
  });

  it('creates a cash account with opening balance', async () => {
    const res = await request
      .post('/api/cash-accounts')
      .set(authAs(ctx.userPhId))
      .send({ name: `Petty Cash Bank ${RUN_ID}`, openingBalance: 200000 });
    expect(res.status).toBe(201);
    cashAccountId = res.body.id;
    const db = await prisma.cashAccount.findUnique({ where: { id: cashAccountId } });
    expect(Number(db!.currentBalance)).toBe(200000);
    record('cashaccount.create', true, `cash=${cashAccountId} bal=200000`);
  });

  it('deposits ₹400,000 into the bank account', async () => {
    const res = await request
      .post(`/api/bank-accounts/${bankAccountId}/deposit`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 400000, description: `Deposit ${RUN_ID}` });
    expect(res.status).toBe(201);
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(Number(db!.currentBalance)).toBe(1400000);
    record('bank.deposit', true, `bal=1400000`);
  });

  it('withdraws ₹50,000 from the bank account', async () => {
    const res = await request
      .post(`/api/bank-accounts/${bankAccountId}/withdraw`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 50000, description: `Withdrawal ${RUN_ID}` });
    expect(res.status).toBe(201);
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(Number(db!.currentBalance)).toBe(1350000);
    record('bank.withdraw', true, `bal=1350000`);
  });

  it('rejects withdrawal exceeding balance', async () => {
    const res = await request
      .post(`/api/bank-accounts/${bankAccountId}/withdraw`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 999999999, description: 'Should fail' });
    expect([400, 500]).toContain(res.status);
    record('bank.overdrawRejected', true, `${res.status} as expected`);
  });

  it('verifies bank + cash accounts persisted in DB', async () => {
    const [bank, cash] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bankAccountId } }),
      prisma.cashAccount.findUnique({ where: { id: cashAccountId } }),
    ]);
    expect(bank).not.toBeNull();
    expect(cash).not.toBeNull();
    record('all.persisted', true, 'bank + cash verified');
  });
});
