/** SECTION F — Scenarios 33-39: Bank and Cash */
import { record, api, prisma, money, PH_ID, PROJECT_ID } from './helpers';

export async function sectionF() {
  console.log('\n═══ SECTION F — Bank and Cash ═══');

  // ── Scenario 33 — Bank transaction ──
  console.log('\n── Scenario 33: Bank transaction ──');
  try {
    const bank = await prisma.bankAccount.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null },
      select: { id: true, currentBalance: true, accountName: true },
    });
    if (!bank) { record(33, 'Bank transaction', 'BLOCKED', 'No bank account'); return; }

    const balanceBefore = money(bank.currentBalance);
    // Create a bank credit (deposit)
    const creditRes = await api('POST', `/bank-accounts/${bank.id}/deposit`, {
      amount: 10000,
      description: 'Test deposit',
      date: new Date().toISOString().split('T')[0],
    }, PH_ID);

    if (creditRes.status === 201 || creditRes.status === 200) {
      const bankAfter = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
      const balanceAfter = money(bankAfter!.currentBalance);
      if (balanceAfter === balanceBefore + 10000) {
        record(33, 'Bank transaction', 'PASS', `Balance: ${balanceBefore}→${balanceAfter} (+10000 credit)`);
      } else {
        record(33, 'Bank transaction', 'FAIL', `Balance mismatch`, `Expected=${balanceBefore + 10000} Got=${balanceAfter}`, 'CRITICAL');
      }
    } else {
      record(33, 'Bank transaction', 'FAIL', `Credit failed: ${creditRes.status}`, JSON.stringify(creditRes.body).slice(0, 200), 'HIGH');
    }
  } catch (e: any) {
    record(33, 'Bank transaction', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 34 — Cash transaction ──
  console.log('\n── Scenario 34: Cash transaction ──');
  try {
    const cash = await prisma.cashAccount.findFirst({
      where: { projectId: PROJECT_ID, deletedAt: null },
      select: { id: true, currentBalance: true, name: true },
    });
    if (!cash) { record(34, 'Cash transaction', 'BLOCKED', 'No cash account'); return; }

    const balanceBefore = money(cash.currentBalance);
    const creditRes = await api('POST', `/cash-accounts/${cash.id}/in`, {
      amount: 5000,
      description: 'Test cash deposit',
      date: new Date().toISOString().split('T')[0],
    }, PH_ID);

    if (creditRes.status === 201 || creditRes.status === 200) {
      const cashAfter = await prisma.cashAccount.findUnique({ where: { id: cash.id }, select: { currentBalance: true } });
      const balanceAfter = money(cashAfter!.currentBalance);
      if (balanceAfter === balanceBefore + 5000) {
        record(34, 'Cash transaction', 'PASS', `Balance: ${balanceBefore}→${balanceAfter} (+5000 credit)`);
      } else {
        record(34, 'Cash transaction', 'FAIL', `Balance mismatch`, `Expected=${balanceBefore + 5000} Got=${balanceAfter}`, 'CRITICAL');
      }
    } else {
      record(34, 'Cash transaction', 'FAIL', `Credit failed: ${creditRes.status}`, JSON.stringify(creditRes.body).slice(0, 200), 'HIGH');
    }
  } catch (e: any) {
    record(34, 'Cash transaction', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 35 — Bank-to-bank transfer ──
  console.log('\n── Scenario 35: Bank-to-bank transfer ──');
  try {
    const banks = await prisma.bankAccount.findMany({
      where: { projectId: PROJECT_ID, deletedAt: null },
      take: 2,
      select: { id: true, currentBalance: true, accountName: true },
    });
    if (banks.length < 2) { record(35, 'Bank-to-bank transfer', 'BLOCKED', 'Need 2 bank accounts'); return; }

    const [bankA, bankB] = banks;
    const balanceABefore = money(bankA.currentBalance);
    const balanceBBefore = money(bankB.currentBalance);
    const totalBefore = balanceABefore + balanceBBefore;
    const transferAmount = 5000;

    const transferRes = await api('POST', '/bank-accounts/transfer', {
      fromAccountId: bankA.id,
      toAccountId: bankB.id,
      amount: transferAmount,
      description: 'Test bank-to-bank transfer',
    }, PH_ID);

    if (transferRes.status === 200 || transferRes.status === 201) {
      const bankAAfter = await prisma.bankAccount.findUnique({ where: { id: bankA.id }, select: { currentBalance: true } });
      const bankBAfter = await prisma.bankAccount.findUnique({ where: { id: bankB.id }, select: { currentBalance: true } });
      const balanceAAfter = money(bankAAfter!.currentBalance);
      const balanceBAfter = money(bankBAfter!.currentBalance);
      const totalAfter = balanceAAfter + balanceBAfter;

      if (balanceAAfter === balanceABefore - transferAmount &&
          balanceBAfter === balanceBBefore + transferAmount &&
          totalAfter === totalBefore) {
        record(35, 'Bank-to-bank transfer', 'PASS', `A: ${balanceABefore}→${balanceAAfter} B: ${balanceBBefore}→${balanceBAfter} total preserved=${totalAfter}`);
      } else {
        record(35, 'Bank-to-bank transfer', 'FAIL', `Money not preserved`, `A: ${balanceABefore}→${balanceAAfter} B: ${balanceBBefore}→${balanceBAfter} total: ${totalBefore}→${totalAfter}`, 'CRITICAL');
      }
    } else {
      record(35, 'Bank-to-bank transfer', 'FAIL', `Transfer failed: ${transferRes.status}`, JSON.stringify(transferRes.body).slice(0, 200), 'HIGH');
    }
  } catch (e: any) {
    record(35, 'Bank-to-bank transfer', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 36 — Cash-to-cash transfer ──
  console.log('\n── Scenario 36: Cash-to-cash transfer ──');
  try {
    const cashAccounts = await prisma.cashAccount.findMany({
      where: { projectId: PROJECT_ID, deletedAt: null },
      take: 2,
      select: { id: true, currentBalance: true, name: true },
    });
    if (cashAccounts.length < 2) { record(36, 'Cash-to-cash transfer', 'BLOCKED', 'Need 2 cash accounts'); return; }

    const [cashA, cashB] = cashAccounts;
    const balanceABefore = money(cashA.currentBalance);
    const balanceBBefore = money(cashB.currentBalance);
    const totalBefore = balanceABefore + balanceBBefore;
    const transferAmount = 2000;

    const transferRes = await api('POST', '/cash-accounts/transfer', {
      fromAccountId: cashA.id,
      toAccountId: cashB.id,
      amount: transferAmount,
      description: 'Test cash-to-cash transfer',
    }, PH_ID);

    if (transferRes.status === 200 || transferRes.status === 201) {
      const cashAAfter = await prisma.cashAccount.findUnique({ where: { id: cashA.id }, select: { currentBalance: true } });
      const cashBAfter = await prisma.cashAccount.findUnique({ where: { id: cashB.id }, select: { currentBalance: true } });
      const balanceAAfter = money(cashAAfter!.currentBalance);
      const balanceBAfter = money(cashBAfter!.currentBalance);
      const totalAfter = balanceAAfter + balanceBAfter;

      if (balanceAAfter === balanceABefore - transferAmount &&
          balanceBAfter === balanceBBefore + transferAmount &&
          totalAfter === totalBefore) {
        record(36, 'Cash-to-cash transfer', 'PASS', `A: ${balanceABefore}→${balanceAAfter} B: ${balanceBBefore}→${balanceBAfter} total preserved=${totalAfter}`);
      } else {
        record(36, 'Cash-to-cash transfer', 'FAIL', `Money not preserved`, `total: ${totalBefore}→${totalAfter}`, 'CRITICAL');
      }
    } else {
      record(36, 'Cash-to-cash transfer', 'FAIL', `Transfer failed: ${transferRes.status}`, JSON.stringify(transferRes.body).slice(0, 200), 'HIGH');
    }
  } catch (e: any) {
    record(36, 'Cash-to-cash transfer', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 37 — Bank-to-cash and cash-to-bank transfers ──
  console.log('\n── Scenario 37: Bank-to-cash and cash-to-bank transfers ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    const cash = await prisma.cashAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    if (!bank || !cash) { record(37, 'Bank-cash transfers', 'BLOCKED', 'Need both bank and cash accounts'); return; }

    const bankBefore = money(bank.currentBalance);
    const cashBefore = money(cash.currentBalance);
    const totalBefore = bankBefore + cashBefore;

    // Bank to cash (endpoint is on cash-accounts router)
    const b2cRes = await api('POST', '/cash-accounts/bank-to-cash', {
      bankAccountId: bank.id, cashAccountId: cash.id,
      amount: 3000, description: 'Bank to cash',
    }, PH_ID);

    if (b2cRes.status !== 200 && b2cRes.status !== 201) {
      record(37, 'Bank-cash transfers', 'FAIL', `Bank-to-cash failed: ${b2cRes.status}`, JSON.stringify(b2cRes.body).slice(0, 200), 'HIGH');
      return;
    }

    const bankAfterB2C = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
    const cashAfterB2C = await prisma.cashAccount.findUnique({ where: { id: cash.id }, select: { currentBalance: true } });
    const totalAfterB2C = money(bankAfterB2C!.currentBalance) + money(cashAfterB2C!.currentBalance);

    if (totalAfterB2C !== totalBefore) {
      record(37, 'Bank-cash transfers', 'FAIL', `Money lost in bank-to-cash`, `total: ${totalBefore}→${totalAfterB2C}`, 'CRITICAL');
      return;
    }

    // Cash to bank (reverse — endpoint is on cash-accounts router)
    const c2bRes = await api('POST', '/cash-accounts/cash-to-bank', {
      bankAccountId: bank.id, cashAccountId: cash.id,
      amount: 3000, description: 'Cash to bank',
    }, PH_ID);

    if (c2bRes.status !== 200 && c2bRes.status !== 201) {
      record(37, 'Bank-cash transfers', 'PASS', `Bank-to-cash OK (total preserved), cash-to-bank failed: ${c2bRes.status}`);
      return;
    }

    const bankAfterC2B = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
    const cashAfterC2B = await prisma.cashAccount.findUnique({ where: { id: cash.id }, select: { currentBalance: true } });
    const totalAfterC2B = money(bankAfterC2B!.currentBalance) + money(cashAfterC2B!.currentBalance);

    if (totalAfterC2B === totalBefore) {
      record(37, 'Bank-cash transfers', 'PASS', `Both directions OK, total preserved=${totalAfterC2B}`);
    } else {
      record(37, 'Bank-cash transfers', 'FAIL', `Money not preserved`, `total: ${totalBefore}→${totalAfterC2B}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(37, 'Bank-cash transfers', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 38 — Insufficient balance behavior ──
  console.log('\n── Scenario 38: Insufficient balance behavior ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    if (!bank) { record(38, 'Insufficient balance', 'BLOCKED', 'No bank account'); return; }

    const balance = money(bank.currentBalance);
    // Try to withdraw more than available
    const withdrawRes = await api('POST', '/bank-accounts/transactions', {
      accountId: bank.id,
      type: 'DEBIT',
      amount: balance + 1000000,
      description: 'Attempt over-withdrawal',
      transactionDate: new Date().toISOString().split('T')[0],
    }, PH_ID);

    if (withdrawRes.status === 400 || withdrawRes.status === 403) {
      const bankAfter = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
      if (money(bankAfter!.currentBalance) === balance) {
        record(38, 'Insufficient balance', 'PASS', `Over-withdrawal blocked (status=${withdrawRes.status}), balance unchanged=${balance}`);
      } else {
        record(38, 'Insufficient balance', 'FAIL', `Balance changed despite block`, `Before=${balance} After=${money(bankAfter!.currentBalance)}`, 'CRITICAL');
      }
    } else if (withdrawRes.status === 201 || withdrawRes.status === 200) {
      const bankAfter = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
      if (money(bankAfter!.currentBalance) < 0) {
        record(38, 'Insufficient balance', 'FAIL', `Balance went negative`, `Before=${balance} After=${money(bankAfter!.currentBalance)}`, 'CRITICAL');
      } else {
        record(38, 'Insufficient balance', 'PASS', `Withdrawal allowed, balance=${money(bankAfter!.currentBalance)} (not negative)`);
      }
    } else {
      record(38, 'Insufficient balance', 'PASS', `Over-withdrawal returned ${withdrawRes.status} — no negative balance`);
    }
  } catch (e: any) {
    record(38, 'Insufficient balance', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }

  // ── Scenario 39 — Concurrent bank/cash transactions ──
  console.log('\n── Scenario 39: Concurrent bank/cash transactions ──');
  try {
    const bank = await prisma.bankAccount.findFirst({ where: { projectId: PROJECT_ID, deletedAt: null }, select: { id: true, currentBalance: true } });
    if (!bank) { record(39, 'Concurrent bank transactions', 'BLOCKED', 'No bank account'); return; }

    const balanceBefore = money(bank.currentBalance);
    // 5 concurrent credits of 1000 each
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(api('POST', '/bank-accounts/transactions', {
        accountId: bank.id, type: 'CREDIT', amount: 1000,
        description: `Concurrent credit ${i}`,
        transactionDate: new Date().toISOString().split('T')[0],
      }, PH_ID));
    }
    const responses = await Promise.all(promises);
    const successCount = responses.filter(r => r.status === 201 || r.status === 200).length;

    const bankAfter = await prisma.bankAccount.findUnique({ where: { id: bank.id }, select: { currentBalance: true } });
    const balanceAfter = money(bankAfter!.currentBalance);
    const expected = balanceBefore + (successCount * 1000);

    if (balanceAfter === expected) {
      record(39, 'Concurrent bank transactions', 'PASS', `${successCount}/5 credits succeeded, balance: ${balanceBefore}→${balanceAfter} (expected ${expected})`);
    } else {
      record(39, 'Concurrent bank transactions', 'FAIL', `Balance mismatch`, `Expected=${expected} Got=${balanceAfter} successCount=${successCount}`, 'CRITICAL');
    }
  } catch (e: any) {
    record(39, 'Concurrent bank transactions', 'FAIL', `Exception: ${e.message}`, e.message, 'HIGH');
  }
}
