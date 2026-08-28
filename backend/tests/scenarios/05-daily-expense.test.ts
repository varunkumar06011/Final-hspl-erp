/**
 * Scenario 5: Daily Expense Reimbursement
 *
 * Creates a daily expense → approves (HEAD_GROUPS) → records payment via cash account.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `exp-${Date.now()}`;
const { record, printReport } = makeReporter('DAILY EXPENSE', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let expenseId = '';
let cashAccountId = '';
let paymentId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[EXPENSE] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Daily Expense', () => {
  it('creates a cash account for expense payment', async () => {
    const res = await request
      .post('/api/cash-accounts')
      .set(authAs(ctx.userPhId))
      .send({ name: `Petty Cash ${RUN_ID}`, openingBalance: 100000 });
    expect(res.status).toBe(201);
    cashAccountId = res.body.id;
    record('cashaccount.create', true, `cash=${cashAccountId} bal=100000`);
  });

  it('creates a daily expense (₹15,000 → 2 approvers needed)', async () => {
    const res = await request
      .post('/api/payments/expense')
      .set(authAs(ctx.userPhId))
      .field('description', `Site transportation ${RUN_ID}`)
      .field('amount', 15000)
      .field('category', 'Transportation')
      .field('expenseDate', new Date().toISOString().slice(0, 10))
      .field('paymentMode', 'CASH');
    expect(res.status).toBe(201);
    expenseId = res.body.id;
    const db = await prisma.paymentRequest.findUnique({ where: { id: expenseId } });
    expect(db!.type).toBe('EXPENSE');
    expect(db!.status).toBe('PENDING');
    record('expense.create', true, `expense=${expenseId} amount=15000`);
  });

  it('approves the expense (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/payments/${expenseId}/approve`).set(authAs(ctx.userPhId)).send({ acknowledged: true, comments: 'ok' });
    const res2 = await request.post(`/api/payments/${expenseId}/approve`).set(authAs(ctx.userAdminId)).send({ acknowledged: true, comments: 'ok' });
    expect(res2.body.status).toBe('APPROVED');
    record('expense.approve', true, `status=APPROVED`);
  });

  it('records the expense payment via cash account', async () => {
    const res = await request
      .post(`/api/payments/${expenseId}/pay`)
      .set(authAs(ctx.userPhId))
      .send({ amount: 15000, mode: 'CASH', cashAccountId, reference: `EXP-PAY-${RUN_ID}` });
    expect(res.status).toBe(201);
    paymentId = res.body.id;
    const db = await prisma.paymentRequest.findUnique({ where: { id: expenseId } });
    expect(db!.status).toBe('PAID');
    record('expense.pay', true, `payment=${paymentId} status=PAID`);
  });

  it('verifies cash account balance decreased', async () => {
    const db = await prisma.cashAccount.findUnique({ where: { id: cashAccountId } });
    expect(Number(db!.currentBalance)).toBe(85000);
    record('cash.balance', true, `balance=85000`);
  });

  it('verifies expense + payment persisted in DB', async () => {
    const [exp, pay] = await Promise.all([
      prisma.paymentRequest.findUnique({ where: { id: expenseId } }),
      prisma.payment.findUnique({ where: { id: paymentId } }),
    ]);
    expect(exp).not.toBeNull();
    expect(pay).not.toBeNull();
    record('all.persisted', true, 'expense + payment verified');
  });
});
