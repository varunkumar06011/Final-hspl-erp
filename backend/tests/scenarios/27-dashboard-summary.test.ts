/**
 * Scenario 27: Dashboard Summary
 *
 * Tests the /api/dashboard/summary endpoint which aggregates project-wide
 * KPIs: budget committed/paid/remaining, pending counts, recent records,
 * low-stock items, and total expense amount.
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, request, prisma, makeReporter } from './_helpers';

const RUN_ID = `dash-${Date.now()}`;
const { record, printReport } = makeReporter('DASHBOARD SUMMARY', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[DASH] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Dashboard Summary', () => {
  it('GET /dashboard/summary returns 200 with all KPI fields', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const b = res.body;
    // Core budget fields
    expect(b).toHaveProperty('project');
    expect(b).toHaveProperty('totalBudget');
    expect(b).toHaveProperty('committed');
    expect(b).toHaveProperty('paid');
    expect(b).toHaveProperty('remaining');
    // Count fields
    expect(b).toHaveProperty('pendingPayments');
    expect(b).toHaveProperty('openIssues');
    expect(b).toHaveProperty('lowStockItems');
    expect(b).toHaveProperty('pendingQuotations');
    expect(b).toHaveProperty('pendingPOs');
    expect(b).toHaveProperty('pendingInvoices');
    // Recent arrays
    expect(Array.isArray(b.recentQuotations)).toBe(true);
    expect(Array.isArray(b.recentPOs)).toBe(true);
    expect(Array.isArray(b.recentInvoices)).toBe(true);
    expect(Array.isArray(b.recentPayments)).toBe(true);
    expect(b).toHaveProperty('totalExpenseAmount');
    expect(b).toHaveProperty('pendingQuotationValue');
    record('summary.200', true, `budget=${b.totalBudget} committed=${b.committed} paid=${b.paid}`);
  });

  it('remaining = totalBudget - committed', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const { totalBudget, committed, remaining } = res.body;
    expect(remaining).toBeCloseTo(totalBudget - committed, 2);
    record('summary.remaining', true, `remaining=${remaining}`);
  });

  it('recent arrays are limited to 5 items', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    expect(res.body.recentQuotations.length).toBeLessThanOrEqual(5);
    expect(res.body.recentPOs.length).toBeLessThanOrEqual(5);
    expect(res.body.recentInvoices.length).toBeLessThanOrEqual(5);
    expect(res.body.recentPayments.length).toBeLessThanOrEqual(5);
    record('summary.recentLimit', true, `q=${res.body.recentQuotations.length} po=${res.body.recentPOs.length} inv=${res.body.recentInvoices.length} pay=${res.body.recentPayments.length}`);
  });

  it('committed matches sum of approved/delivered PO grand totals', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const committedFromDb = await prisma.purchaseOrder.aggregate({
      where: {
        projectId: ctx.projectId,
        deletedAt: null,
        status: { in: ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'] },
      },
      _sum: { grandTotal: true },
    });
    const expected = Number(committedFromDb._sum.grandTotal ?? 0);
    expect(res.body.committed).toBeCloseTo(expected, 2);
    record('summary.committedMatch', true, `api=${res.body.committed} db=${expected}`);
  });

  it('paid matches sum of PAID payment amounts', async () => {
    const res = await request.get('/api/dashboard/summary').set(authAs(ctx.userPhId));
    expect(res.status).toBe(200);
    const paidFromDb = await prisma.payment.aggregate({
      where: {
        paymentRequest: { projectId: ctx.projectId, deletedAt: null },
        status: 'PAID',
      },
      _sum: { amount: true },
    });
    const expected = Number(paidFromDb._sum.amount ?? 0);
    expect(res.body.paid).toBeCloseTo(expected, 2);
    record('summary.paidMatch', true, `api=${res.body.paid} db=${expected}`);
  });

  it('rejects unauthenticated request', async () => {
    const res = await request.get('/api/dashboard/summary');
    expect(res.status).toBe(401);
    record('summary.noAuth', true, `401`);
  });

  it('rejects user without VIEW_FINANCIALS permission (SITE_SUPERVISOR)', async () => {
    const sv = await prisma.user.findFirst({
      where: { projectId: ctx.projectId, role: 'SITE_SUPERVISOR', isActive: true },
      select: { id: true },
    });
    if (!sv) { record('summary.rbac', true, 'skipped — no SITE_SUPERVISOR'); return; }
    const res = await request.get('/api/dashboard/summary').set(authAs(sv.id));
    expect(res.status).toBe(403);
    record('summary.rbac', true, `403`);
  });
});
