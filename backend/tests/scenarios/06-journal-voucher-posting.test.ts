/**
 * Scenario 6: Journal Voucher Posting (Finance Impact)
 *
 * budget head → owner account → JV create → submit → approve (HEAD_GROUPS)
 *   → post → verify budget head actualAmount + owner balance updated
 *
 * Data persists — NO teardown.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContext, authAs, prisma, request, makeReporter } from './_helpers';

const RUN_ID = `jv-${Date.now()}`;
const { record, printReport } = makeReporter('JOURNAL VOUCHER POSTING', RUN_ID);

let ctx: Awaited<ReturnType<typeof getContext>>;
let budgetHeadId = '';
let ownerAccountId = '';
let jvId = '';

beforeAll(async () => {
  ctx = await getContext();
  console.log(`\n[JV] run=${RUN_ID} project=${ctx.projectName}`);
});

afterAll(() => printReport());

describe('Journal Voucher Posting', () => {
  it('creates a budget head', async () => {
    const existing = await prisma.budgetHead.findMany({
      where: { projectId: ctx.projectId, deletedAt: null },
      select: { slNo: true },
    });
    const maxSl = existing.reduce((m, h) => Math.max(m, h.slNo), 0);

    const res = await request
      .post('/api/budget-heads')
      .set(authAs(ctx.userPhId))
      .send({ slNo: maxSl + 1, particulars: `JV Test Head ${RUN_ID}`, allocatedAmount: 2000000 });
    expect(res.status).toBe(201);
    budgetHeadId = res.body.id;
    record('budgethead.create', true, `bh=${budgetHeadId}`);
  });

  it('creates an owner account', async () => {
    const res = await request
      .post('/api/owner-accounts')
      .set(authAs(ctx.userPhId))
      .send({ ownerName: `Owner JV ${RUN_ID}`, openingBalance: 0 });
    expect(res.status).toBe(201);
    ownerAccountId = res.body.id;
    record('owneraccount.create', true, `owner=${ownerAccountId}`);
  });

  it('creates a JV (debit budget head, credit owner)', async () => {
    const res = await request
      .post('/api/journal-vouchers')
      .set(authAs(ctx.userPhId))
      .send({
        type: 'ADJUSTMENT',
        description: `Capital injection ${RUN_ID}`,
        entries: [
          { accountType: 'BUDGET_HEAD', budgetHeadId, debit: 100000, credit: 0, description: 'Fund allocation' },
          { accountType: 'OWNER', ownerAccountId, debit: 0, credit: 100000, description: 'Owner capital' },
        ],
      });
    expect(res.status).toBe(201);
    jvId = res.body.id;
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('DRAFT');
    record('jv.create', true, `jv=${jvId} status=DRAFT`);
  });

  it('submits the JV → PENDING_APPROVAL', async () => {
    const res = await request.post(`/api/journal-vouchers/${jvId}/submit`).set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(200);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('PENDING_APPROVAL');
    record('jv.submit', true, `status=PENDING_APPROVAL`);
  });

  it('approves the JV (HEAD_GROUPS: PH + ADMIN)', async () => {
    await request.post(`/api/journal-vouchers/${jvId}/approve`).set(authAs(ctx.userPhId)).send({ comments: 'ok' });
    const res2 = await request.post(`/api/journal-vouchers/${jvId}/approve`).set(authAs(ctx.userAdminId)).send({ comments: 'ok' });
    expect(res2.body.isFullyApproved).toBe(true);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('APPROVED');
    record('jv.approve', true, `status=APPROVED`);
  });

  it('posts the JV → updates budget head actualAmount + owner balance', async () => {
    const ownerBefore = await prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } });
    const res = await request.post(`/api/journal-vouchers/${jvId}/post`).set(authAs(ctx.userPhId)).send({});
    expect(res.status).toBe(200);
    const db = await prisma.journalVoucher.findUnique({ where: { id: jvId } });
    expect(db!.status).toBe('POSTED');

    const head = await prisma.budgetHead.findUnique({ where: { id: budgetHeadId } });
    const owner = await prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } });
    expect(Number(head!.actualAmount)).toBe(100000);
    expect(Number(owner!.currentBalance)).toBeGreaterThan(Number(ownerBefore!.currentBalance));
    record('jv.post', true, `status=POSTED bhActual=${head!.actualAmount} ownerDelta=${Number(owner!.currentBalance) - Number(ownerBefore!.currentBalance)}`);
  });

  it('verifies JV + budget head + owner persisted in DB', async () => {
    const [jv, head, owner] = await Promise.all([
      prisma.journalVoucher.findUnique({ where: { id: jvId } }),
      prisma.budgetHead.findUnique({ where: { id: budgetHeadId } }),
      prisma.ownerAccount.findUnique({ where: { id: ownerAccountId } }),
    ]);
    expect(jv).not.toBeNull();
    expect(head).not.toBeNull();
    expect(owner).not.toBeNull();
    record('all.persisted', true, 'JV + head + owner verified');
  });
});
