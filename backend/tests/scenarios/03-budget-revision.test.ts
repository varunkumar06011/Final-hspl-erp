/**
 * Scenario 3: Budget Planning & Revision
 *
 * budget head → request revision → review (approve) → verify applied
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `bud-${Date.now()}`;
const { record, printReport } = makeReporter('BUDGET REVISION', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let budgetHeadId = '';
let revisionId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[BUDGET] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Budget Revision', () => {
  it('creates a budget head', async () => {
    // Find the max slNo to avoid collision
    const existing = await prisma.budgetHead.findMany({
      where: { projectId: ctx.projectId, deletedAt: null },
      select: { slNo: true },
    });
    const maxSl = existing.reduce((m, h) => Math.max(m, h.slNo), 0);

    const res = await request
      .post('/api/budget-heads')
      .set(authAs(ctx.userPhId))
      .send({ slNo: maxSl + 1, particulars: `Electrical Works ${RUN_ID}`, allocatedAmount: 5000000 });
    expect(res.status).toBe(201);
    budgetHeadId = res.body.id;
    record('budgethead.create', true, `bh=${budgetHeadId} slNo=${maxSl + 1}`);
  });

  it('requests a budget revision (increase allocation)', async () => {
    const res = await request
      .post('/api/budget-revisions/request')
      .set(authAs(ctx.userPhId))
      .send({ budgetHeadId, newAllocated: 6000000, reason: 'Increased scope of electrical work' });
    expect(res.status).toBe(201);
    revisionId = res.body.id;
    const db = await prisma.budgetRevision.findUnique({ where: { id: revisionId } });
    expect(db!.status).toBe('PENDING');
    record('revision.request', true, `rev=${revisionId} status=PENDING`);
  });

  it('rejects review from non-admin (PH cannot review)', async () => {
    const res = await request
      .post(`/api/budget-revisions/${revisionId}/review`)
      .set(authAs(ctx.userPhId))
      .send({ approved: true, comments: 'ok' });
    expect(res.status).toBe(403);
    record('revision.nonAdminRejected', true, `403 as expected`);
  });

  it('approves the revision (ADMIN reviews → APPLIED)', async () => {
    const res = await request
      .post(`/api/budget-revisions/${revisionId}/review`)
      .set(authAs(ctx.userAdminId))
      .send({ approved: true, comments: 'Approved — scope confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPLIED');
    record('revision.approve', true, `status=APPLIED`);
  });

  it('verifies the budget head allocation was updated', async () => {
    const db = await prisma.budgetHead.findUnique({ where: { id: budgetHeadId } });
    expect(Number(db!.allocatedAmount)).toBe(6000000);
    record('budgethead.updated', true, `allocated=6000000`);
  });

  it('verifies revision + budget head persisted in DB', async () => {
    const [rev, head] = await Promise.all([
      prisma.budgetRevision.findUnique({ where: { id: revisionId } }),
      prisma.budgetHead.findUnique({ where: { id: budgetHeadId } }),
    ]);
    expect(rev).not.toBeNull();
    expect(head).not.toBeNull();
    record('all.persisted', true, 'revision + head verified');
  });
});
