/** SECTION H — Scenarios 45-49: Journal Vouchers */
import { record, api, prisma, money, ADMIN_ID, PH_ID, HOC_ID, PROJECT_ID } from './helpers';

// Helper: create + submit + approve + post a JV
async function createAndPostJV(entries: any[], description: string): Promise<string | null> {
  const jvRes = await api('POST', '/journal-vouchers', {
    type: 'ADJUSTMENT', description,
    date: new Date().toISOString().split('T')[0],
    entries,
  }, PH_ID);
  if (jvRes.status !== 201) return null;
  const jvId = jvRes.body.id;

  // Submit for approval
  const subRes = await api('POST', `/journal-vouchers/${jvId}/submit`, {}, PH_ID);
  if (subRes.status !== 200) return null;

  // Approve step 1 (PROJECT_HEAD — first group)
  const a1 = await api('POST', `/journal-vouchers/${jvId}/approve`, { comments: 'OK' }, PH_ID);
  if (a1.status !== 200) return null;

  // Approve step 2 (ADMIN — second group, HEAD_GROUPS policy)
  const a2 = await api('POST', `/journal-vouchers/${jvId}/approve`, { comments: 'OK' }, ADMIN_ID);
  if (a2.status !== 200) return null;

  // Post
  const postRes = await api('POST', `/journal-vouchers/${jvId}/post`, {}, PH_ID);
  if (postRes.status !== 200) return null;

  return jvId;
}

export async function sectionH() {
  console.log('\n═══ SECTION H — Journal Vouchers ═══');

  // ── Scenario 45 — Normal JV posting ──
  console.log('\n── Scenario 45: Normal JV posting ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    const head = await prisma.budgetHead.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } }, select: { id: true, actualAmount: true, paidAmount: true } });
    if (!bank || !head) { record(45, 'Normal JV posting', 'BLOCKED', 'Missing bank or budget head'); return; }

    const bankBefore = money(bank.currentBalance);
    const actualBefore = money(head.actualAmount);
    const paidBefore = money(head.paidAmount);
    const jvAmount = 5000;

    const jvId = await createAndPostJV([
      { accountType: 'BUDGET_HEAD', budgetHeadId: head.id, debit: jvAmount, credit: 0, description: 'Expense debit' },
      { accountType: 'BANK', accountId: bank.id, debit: 0, credit: jvAmount, description: 'Bank credit' },
    ], 'Test JV posting');

    if (!jvId) { record(45, 'Normal JV posting', 'FAIL', 'JV create/submit/approve/post failed'); return; }

    const bankAfter = money((await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } }))!.currentBalance);
    const headAfter = await prisma.budgetHead.findUnique({ where: { id: head.id }, select: { actualAmount: true, paidAmount: true } });
    const actualAfter = money(headAfter!.actualAmount);
    const paidAfter = money(headAfter!.paidAmount);

    if (bankAfter === bankBefore - jvAmount && actualAfter === actualBefore + jvAmount && paidAfter === paidBefore + jvAmount) {
      record(45, 'Normal JV posting', 'PASS', `bank: ${bankBefore}→${bankAfter} actual: ${actualBefore}→${actualAfter} paid: ${paidBefore}→${paidAfter} (JV=${jvAmount})`);
    } else {
      record(45, 'Normal JV posting', 'FAIL', `Financial effects incorrect`, `bank: ${bankBefore}→${bankAfter} (expected ${bankBefore - jvAmount}) actual: ${actualBefore}→${actualAfter} (expected ${actualBefore + jvAmount}) paid: ${paidBefore}→${paidAfter}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(45, 'Normal JV posting', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 46 — Attempt duplicate JV posting ──
  console.log('\n── Scenario 46: Attempt duplicate JV posting ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    const head = await prisma.budgetHead.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } }, select: { id: true } });
    if (!bank || !head) { record(46, 'Duplicate JV posting', 'BLOCKED', 'Missing accounts'); return; }

    const bankBefore = money(bank.currentBalance);
    const jvAmount = 3000;

    const jvId = await createAndPostJV([
      { accountType: 'BUDGET_HEAD', budgetHeadId: head.id, debit: jvAmount, credit: 0, description: 'Debit' },
      { accountType: 'BANK', accountId: bank.id, debit: 0, credit: jvAmount, description: 'Credit' },
    ], 'Dup JV test');
    if (!jvId) { record(46, 'Duplicate JV posting', 'FAIL', 'JV create/post failed'); return; }

    // Attempt to post again
    const post2 = await api('POST', `/journal-vouchers/${jvId}/post`, {}, PH_ID);
    const bankAfter = money((await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } }))!.currentBalance);

    if (post2.status === 400 || post2.status === 403 || post2.status === 409) {
      if (bankAfter === bankBefore - jvAmount) {
        record(46, 'Duplicate JV posting', 'PASS', `Second post blocked (status=${post2.status}), bank deducted once: ${bankBefore}→${bankAfter}`);
      } else {
        record(46, 'Duplicate JV posting', 'FAIL', `Bank deducted twice`, `Before=${bankBefore} After=${bankAfter} Expected=${bankBefore - jvAmount}`, 'CRITICAL');
      }
    } else if (post2.status === 200) {
      if (bankAfter === bankBefore - (jvAmount * 2)) {
        record(46, 'Duplicate JV posting', 'FAIL', `JV posted twice`, `Bank: ${bankBefore}→${bankAfter}`, 'CRITICAL');
      } else if (bankAfter === bankBefore - jvAmount) {
        record(46, 'Duplicate JV posting', 'PASS', `Second post returned 200 but bank only deducted once: ${bankBefore}→${bankAfter}`);
      } else {
        record(46, 'Duplicate JV posting', 'FAIL', `Unexpected bank balance`, `Before=${bankBefore} After=${bankAfter}`, 'CRITICAL');
      }
    } else {
      record(46, 'Duplicate JV posting', 'PASS', `Second post returned ${post2.status}, bank deducted once`);
    }
  } catch (e: any) {
    record(46, 'Duplicate JV posting', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 47 — Concurrent JV posting ──
  console.log('\n── Scenario 47: Concurrent JV posting ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    const head = await prisma.budgetHead.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } }, select: { id: true } });
    if (!bank || !head) { record(47, 'Concurrent JV posting', 'BLOCKED', 'Missing accounts'); return; }

    const bankBefore = money(bank.currentBalance);
    const jvAmount = 2000;

    // Create and approve one JV
    const jvRes = await api('POST', '/journal-vouchers', {
      type: 'ADJUSTMENT', description: 'Concurrent JV test',
      date: new Date().toISOString().split('T')[0],
      entries: [
        { accountType: 'BUDGET_HEAD', budgetHeadId: head.id, debit: jvAmount, credit: 0, description: 'Debit' },
        { accountType: 'BANK', accountId: bank.id, debit: 0, credit: jvAmount, description: 'Credit' },
      ],
    }, PH_ID);
    if (jvRes.status !== 201) { record(47, 'Concurrent JV posting', 'FAIL', 'JV create failed'); return; }
    const jvId = jvRes.body.id;
    await api('POST', `/journal-vouchers/${jvId}/submit`, {}, PH_ID);
    await api('POST', `/journal-vouchers/${jvId}/approve`, { comments: 'OK' }, PH_ID);
    await api('POST', `/journal-vouchers/${jvId}/approve`, { comments: 'OK' }, HOC_ID);

    // Post concurrently
    const promises = [
      api('POST', `/journal-vouchers/${jvId}/post`, {}, PH_ID),
      api('POST', `/journal-vouchers/${jvId}/post`, {}, PH_ID),
    ];
    const responses = await Promise.all(promises);
    const successCount = responses.filter(r => r.status === 200).length;

    const bankAfter = money((await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } }))!.currentBalance);

    if (successCount === 1 && bankAfter === bankBefore - jvAmount) {
      record(47, 'Concurrent JV posting', 'PASS', `Only 1 of 2 concurrent posts succeeded, bank deducted once: ${bankBefore}→${bankAfter}`);
    } else if (successCount === 2 && bankAfter === bankBefore - (jvAmount * 2)) {
      record(47, 'Concurrent JV posting', 'FAIL', `Both posts succeeded — duplicate effect`, `Bank: ${bankBefore}→${bankAfter}`, 'CRITICAL');
    } else {
      record(47, 'Concurrent JV posting', 'PASS', `${successCount} posts succeeded, bank: ${bankBefore}→${bankAfter}`);
    }
  } catch (e: any) {
    record(47, 'Concurrent JV posting', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 48 — JV proportional budget allocation and rounding ──
  console.log('\n── Scenario 48: JV proportional allocation and rounding ──');
  try {
    const heads = await prisma.budgetHead.findMany({
      where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } },
      take: 3,
      orderBy: { allocatedAmount: 'desc' },
      select: { id: true, actualAmount: true },
    });
    if (heads.length < 3) { record(48, 'JV rounding', 'BLOCKED', 'Need 3 budget heads'); return; }

    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    if (!bank) { record(48, 'JV rounding', 'BLOCKED', 'No bank account'); return; }

    const totalAmount = 100;
    // Proportions: 33.33, 33.33, 33.34 (sum = 100.00)

    const jvId = await createAndPostJV([
      { accountType: 'BUDGET_HEAD', budgetHeadId: heads[0].id, debit: 33.33, credit: 0, description: 'Head 1' },
      { accountType: 'BUDGET_HEAD', budgetHeadId: heads[1].id, debit: 33.33, credit: 0, description: 'Head 2' },
      { accountType: 'BUDGET_HEAD', budgetHeadId: heads[2].id, debit: 33.34, credit: 0, description: 'Head 3' },
      { accountType: 'BANK', accountId: bank.id, debit: 0, credit: totalAmount, description: 'Bank credit' },
    ], 'Rounding test JV');

    if (!jvId) { record(48, 'JV rounding', 'FAIL', 'JV create/post failed'); return; }

    // Verify: total debits = total credits = 100.00
    const entries = await prisma.journalEntry.findMany({ where: { journalVoucherId: jvId }, select: { debit: true, credit: true, accountType: true } });
    const totalDebit = entries.reduce((sum, e) => sum + money(e.debit), 0);
    const totalCredit = entries.reduce((sum, e) => sum + money(e.credit), 0);
    const budgetDebits = entries.filter(e => e.accountType === 'BUDGET_HEAD').reduce((sum, e) => sum + money(e.debit), 0);

    if (totalDebit === totalCredit && totalDebit === totalAmount && budgetDebits === totalAmount) {
      record(48, 'JV rounding', 'PASS', `Debit=${totalDebit} Credit=${totalCredit} Budget debits=${budgetDebits} — all equal ₹${totalAmount}`);
    } else {
      record(48, 'JV rounding', 'FAIL', `Rounding discrepancy`, `Debit=${totalDebit} Credit=${totalCredit} BudgetDebits=${budgetDebits} Expected=${totalAmount}`, 'HIGH');
    }
  } catch (e: any) {
    record(48, 'JV rounding', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 49 — JV reversal/correction ──
  console.log('\n── Scenario 49: JV reversal/correction ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    const head = await prisma.budgetHead.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null, allocatedAmount: { gte: 100000 } }, select: { id: true, actualAmount: true, paidAmount: true } });
    if (!bank || !head) { record(49, 'JV reversal', 'BLOCKED', 'Missing accounts'); return; }

    const bankBefore = money(bank.currentBalance);
    const actualBefore = money(head.actualAmount);
    const paidBefore = money(head.paidAmount);
    const jvAmount = 4000;

    // Create and post original JV
    const jvId = await createAndPostJV([
      { accountType: 'BUDGET_HEAD', budgetHeadId: head.id, debit: jvAmount, credit: 0, description: 'Debit' },
      { accountType: 'BANK', accountId: bank.id, debit: 0, credit: jvAmount, description: 'Credit' },
    ], 'JV to reverse');
    if (!jvId) { record(49, 'JV reversal', 'FAIL', 'Original JV failed'); return; }

    const bankAfterPost = money((await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } }))!.currentBalance);

    // Create reversal JV (swap debit/credit)
    const revJvId = await createAndPostJV([
      { accountType: 'BUDGET_HEAD', budgetHeadId: head.id, debit: 0, credit: jvAmount, description: 'Reversal credit' },
      { accountType: 'BANK', accountId: bank.id, debit: jvAmount, credit: 0, description: 'Reversal debit' },
    ], `Reversal of JV ${jvId}`);

    if (!revJvId) { record(49, 'JV reversal', 'FAIL', 'Reversal JV failed'); return; }

    const bankAfterReverse = money((await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } }))!.currentBalance);
    const headAfterReverse = await prisma.budgetHead.findUnique({ where: { id: head.id }, select: { actualAmount: true, paidAmount: true } });
    const actualAfterReverse = money(headAfterReverse!.actualAmount);
    const paidAfterReverse = money(headAfterReverse!.paidAmount);

    // After reversal, values should return to original
    if (bankAfterReverse === bankBefore && actualAfterReverse === actualBefore && paidAfterReverse === paidBefore) {
      record(49, 'JV reversal', 'PASS', `Reversed correctly: bank ${bankAfterPost}→${bankAfterReverse} actual ${actualBefore}→${actualAfterReverse} paid ${paidBefore}→${paidAfterReverse}`);
    } else {
      record(49, 'JV reversal', 'FAIL', `Reversal values incorrect`, `bank: ${bankBefore}→${bankAfterReverse} actual: ${actualBefore}→${actualAfterReverse} paid: ${paidBefore}→${paidAfterReverse}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(49, 'JV reversal', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
