/**
 * Scenario 8: Owner Capital Contribution
 *
 * bank account → owner account → owner contribution → verify bank balance
 * increased + owner balance increased
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `own-${Date.now()}`;
const { record, printReport } = makeReporter('OWNER CONTRIBUTION', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let bankAccountId = '';
let ownerAccountId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[OWNER] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Owner Contribution', () => {
  it('creates a bank account', async () => {
    const res = await request
      .post('/api/bank-accounts')
      .set(authAs(ctx.userPhId))
      .send({
        accountName: `ICICI Owner ${RUN_ID}`,
        bankName: 'ICICI',
        accountNumber: '9876543210',
        ifscCode: 'ICICI0005678',
        openingBalance: 500000,
      });
    expect(res.status).toBe(201);
    bankAccountId = res.body.id;
    record('bankaccount.create', true, `bank=${bankAccountId} bal=500000`);
  });

  it('creates an owner account', async () => {
    const res = await request
      .post('/api/owner-accounts')
      .set(authAs(ctx.userPhId))
      .send({ ownerName: `Mr. Owner ${RUN_ID}`, openingBalance: 0 });
    expect(res.status).toBe(201);
    ownerAccountId = res.body.id;
    record('owneraccount.create', true, `owner=${ownerAccountId}`);
  });

  it('records an owner contribution of ₹300,000', async () => {
    const res = await request
      .post(`/api/owner-accounts/${ownerAccountId}/contribution`)
      .set(authAs(ctx.userPhId))
      .send({ bankAccountId, amount: 300000, description: `Capital contribution ${RUN_ID}` });
    expect(res.status).toBe(201);
    record('owner.contribution', true, `amount=300000`);
  });

  it('verifies bank balance increased by 300,000', async () => {
    const db = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
    expect(Number(db!.currentBalance)).toBe(800000);
    record('bank.balance', true, `bal=800000`);
  });

  it('verifies owner balance increased', async () => {
    const db = await prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } });
    expect(Number(db!.currentBalance)).toBe(300000);
    record('owner.balance', true, `bal=300000`);
  });

  it('verifies bank + owner persisted in DB', async () => {
    const [bank, owner] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: bankAccountId } }),
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } }),
    ]);
    expect(bank).not.toBeNull();
    expect(owner).not.toBeNull();
    record('all.persisted', true, 'bank + owner verified');
  });
});
