/**
 * Scenario 12: Finance Reports
 *
 * Tests all finance report endpoints (JSON + PDF):
 *   budget-vs-actual, cash-flow, account-summary, owner-equity,
 *   dashboard, bank-reconciliation, cash-reconciliation, vendor-aging
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, makeReporter } from './_helpers';

const RUN_ID = `fin-${Date.now()}`;
const { record, printReport } = makeReporter('FINANCE REPORTS', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[FIN] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Finance Reports', () => {
  it('GET /budget-vs-actual returns budget heads with utilization', async () => {
    const res = await request.get('/api/finance-reports/budget-vs-actual').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('totals');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.totals).toHaveProperty('allocated');
    expect(res.body.totals).toHaveProperty('actual');
    record('budget-vs-actual', true, `heads=${res.body.data.length}`);
  });

  it('GET /cash-flow returns transactions with summary', async () => {
    const res = await request.get('/api/finance-reports/cash-flow').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('totalInflow');
    expect(res.body.summary).toHaveProperty('totalOutflow');
    expect(res.body.summary).toHaveProperty('netFlow');
    record('cash-flow', true, `entries=${res.body.summary.count}`);
  });

  it('GET /account-summary returns bank + cash accounts with totals', async () => {
    const res = await request.get('/api/finance-reports/account-summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bankAccounts');
    expect(res.body).toHaveProperty('cashAccounts');
    expect(res.body).toHaveProperty('totals');
    expect(res.body.totals).toHaveProperty('bankTotal');
    expect(res.body.totals).toHaveProperty('cashTotal');
    expect(res.body.totals).toHaveProperty('grandTotal');
    record('account-summary', true, `bank=${res.body.bankAccounts.length} cash=${res.body.cashAccounts.length}`);
  });

  it('GET /owner-equity returns owner accounts with net equity', async () => {
    const res = await request.get('/api/finance-reports/owner-equity').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accounts');
    expect(res.body).toHaveProperty('totals');
    expect(res.body.totals).toHaveProperty('netOwnerEquity');
    record('owner-equity', true, `accounts=${res.body.accounts.length}`);
  });

  it('GET /dashboard returns consolidated KPIs', async () => {
    const res = await request.get('/api/finance-reports/dashboard').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('budget');
    expect(res.body).toHaveProperty('liquidity');
    expect(res.body).toHaveProperty('ownerEquity');
    expect(res.body.budget).toHaveProperty('totalAllocated');
    expect(res.body.liquidity).toHaveProperty('totalLiquidity');
    record('dashboard', true, `budgetHeads=${res.body.budgetHeadCount}`);
  });

  it('GET /bank-reconciliation returns reconciliation status per account', async () => {
    const res = await request.get('/api/finance-reports/bank-reconciliation').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('reconciledCount');
    expect(res.body.summary).toHaveProperty('totalDiscrepancy');
    record('bank-reconciliation', true, `accounts=${res.body.summary.totalAccounts}`);
  });

  it('GET /cash-reconciliation returns reconciliation status per account', async () => {
    const res = await request.get('/api/finance-reports/cash-reconciliation').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('reconciledCount');
    record('cash-reconciliation', true, `accounts=${res.body.summary.totalAccounts}`);
  });

  it('GET /vendor-aging returns vendor outstanding with aging buckets', async () => {
    const res = await request.get('/api/finance-reports/vendor-aging').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('totals');
    expect(res.body.totals).toHaveProperty('totalInvoiced');
    expect(res.body.totals).toHaveProperty('totalOutstanding');
    expect(res.body.totals).toHaveProperty('current');
    record('vendor-aging', true, `vendors=${res.body.data.length}`);
  });

  it('GET /pdf/budget-vs-actual returns PDF', async () => {
    const res = await request.get('/api/finance-reports/pdf/budget-vs-actual').set(authAs(ctx.userPhId)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    record('pdf.budget-vs-actual', true, `${res.body.length} bytes`);
  });

  it('GET /pdf/cash-flow returns PDF', async () => {
    const res = await request.get('/api/finance-reports/pdf/cash-flow').set(authAs(ctx.userPhId)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    record('pdf.cash-flow', true, `${res.body.length} bytes`);
  });

  it('GET /pdf/account-summary returns PDF', async () => {
    const res = await request.get('/api/finance-reports/pdf/account-summary').set(authAs(ctx.userPhId)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    record('pdf.account-summary', true, `${res.body.length} bytes`);
  });

  it('GET /pdf/owner-equity returns PDF', async () => {
    const res = await request.get('/api/finance-reports/pdf/owner-equity').set(authAs(ctx.userPhId)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    record('pdf.owner-equity', true, `${res.body.length} bytes`);
  });
});
