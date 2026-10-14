/**
 * Contra vouchers (Tally F4): money moved between our own bank / cash accounts.
 * The bank/cash rows must be TRANSFER_IN / TRANSFER_OUT so the dashboard never reads
 * a bank -> cash move as expenditure (it used to post WITHDRAWAL + IN). Prisma is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoucherType } from '@hospital-erp/shared';

vi.mock('../src/config/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../src/middleware/auth', () => ({ authMiddleware: vi.fn(), requireProjectId: vi.fn() }));
vi.mock('../src/middleware/rbac', () => ({ rbacMiddleware: () => vi.fn() }));
vi.mock('../src/services/audit.service', () => ({ logAudit: vi.fn() }));
vi.mock('../src/services/project.service', () => ({ getProjectCode: vi.fn(async () => 'VGH') }));
vi.mock('../src/routes/ledger.routes', () => ({ ensureVendorLedger: vi.fn(), findLedgerByName: vi.fn() }));
vi.mock('../src/services/invoice-payment.service', () => ({ recalcInvoicePaymentStatus: vi.fn() }));

import { postVoucher, isMoneyTransfer, contraLedgerError, bankReversalType, cashReversalType } from '../src/routes/voucher.routes';

const BANK = { id: 'l-bank', name: 'SBI Current', group: 'BANK', linkedEntityType: 'BANK_ACCOUNT', linkedEntityId: 'acct-bank' };
const CASH = { id: 'l-cash', name: 'Main Cash', group: 'CASH', linkedEntityType: 'CASH_ACCOUNT', linkedEntityId: 'acct-cash' };
const LOOSE_CASH = { id: 'l-loose', name: 'Cash (no account)', group: 'CASH', linkedEntityType: null, linkedEntityId: null };
const VENDOR = { id: 'l-vendor', name: 'ABC Traders', group: 'SUNDRY_CREDITORS', linkedEntityType: 'VENDOR', linkedEntityId: 'v-1' };

function fakeTx() {
  const rows = { bank: [] as any[], cash: [] as any[] };
  const tx: any = {
    journalVoucher: { create: vi.fn(async () => ({ id: 'jv-1' })) },
    ledger: { update: vi.fn(async () => ({ currentBalance: 0 })) },
    ledgerEntry: { create: vi.fn(async () => ({})) },
    bankAccount: {
      findUnique: vi.fn(async () => ({ id: 'acct-bank', accountName: 'SBI', currentBalance: 100000 })),
      update: vi.fn(async () => ({ currentBalance: 90000 })),
    },
    cashAccount: {
      findUnique: vi.fn(async () => ({ id: 'acct-cash', name: 'Main Cash', currentBalance: 5000 })),
      update: vi.fn(async () => ({ currentBalance: 15000 })),
    },
    bankTransaction: { create: vi.fn(async ({ data }: any) => rows.bank.push(data)) },
    cashTransaction: { create: vi.fn(async ({ data }: any) => rows.cash.push(data)) },
    billSettlement: { create: vi.fn() },
    budgetHead: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { tx, rows };
}

const post = (voucherType: string, entries: any[], ledgers: any[], tx: any) =>
  postVoucher({
    projectId: 'p-1',
    jvNumber: 'VGH-CONTRA0001',
    voucherType,
    voucherDate: new Date('2026-10-10'),
    description: null,
    totalDebit: 10000,
    totalCredit: 10000,
    entries,
    ledgerMap: new Map(ledgers.map((l) => [l.id, l])),
    budgetHeadMap: new Map(),
    sourceInvoiceId: null,
    billSettlements: [],
    userId: 'u-1',
    tx,
  });

describe('contra vouchers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bank -> cash contra posts TRANSFER_OUT on the bank and TRANSFER_IN on the cash account', async () => {
    const { tx, rows } = fakeTx();
    await post(
      VoucherType.CONTRA,
      [
        { ledgerId: CASH.id, debit: 10000, credit: 0 },
        { ledgerId: BANK.id, debit: 0, credit: 10000 },
      ],
      [BANK, CASH],
      tx,
    );
    expect(rows.bank).toHaveLength(1);
    expect(rows.cash).toHaveLength(1);
    expect(rows.bank[0]).toMatchObject({ type: 'TRANSFER_OUT', amount: 10000, referenceType: 'TRANSFER' });
    expect(rows.cash[0]).toMatchObject({ type: 'TRANSFER_IN', amount: 10000, referenceType: 'TRANSFER' });
  });

  it('a Payment voucher that only moves money between our accounts is treated as a contra too', async () => {
    const { tx, rows } = fakeTx();
    await post(
      VoucherType.PAYMENT,
      [
        { ledgerId: CASH.id, debit: 10000, credit: 0 },
        { ledgerId: BANK.id, debit: 0, credit: 10000 },
      ],
      [BANK, CASH],
      tx,
    );
    expect(rows.bank[0].type).toBe('TRANSFER_OUT');
    expect(rows.cash[0].type).toBe('TRANSFER_IN');
  });

  it('a real vendor payment is still a WITHDRAWAL (counted as spending)', async () => {
    const { tx, rows } = fakeTx();
    await post(
      VoucherType.PAYMENT,
      [
        { ledgerId: VENDOR.id, debit: 10000, credit: 0 },
        { ledgerId: BANK.id, debit: 0, credit: 10000 },
      ],
      [BANK, VENDOR],
      tx,
    );
    expect(rows.bank[0]).toMatchObject({ type: 'WITHDRAWAL', referenceType: 'MANUAL_WITHDRAWAL' });
  });

  it('isMoneyTransfer needs every line to be a linked bank / cash account', () => {
    expect(isMoneyTransfer([BANK, CASH])).toBe(true);
    expect(isMoneyTransfer([BANK, VENDOR])).toBe(false);
    expect(isMoneyTransfer([BANK, LOOSE_CASH])).toBe(false);
    expect(isMoneyTransfer([BANK])).toBe(false);
  });

  it('cancelling a contra undoes it with a transfer the other way, not a refund', () => {
    expect(bankReversalType(false, true)).toBe('TRANSFER_IN');
    expect(cashReversalType(true, true)).toBe('TRANSFER_OUT');
    expect(bankReversalType(false, false)).toBe('REVERSAL_IN');
  });

  it('rejects a contra into a ledger with no bank / cash account behind it', () => {
    const map = new Map([BANK, CASH, LOOSE_CASH, VENDOR].map((l) => [l.id, l]));
    expect(contraLedgerError(VoucherType.CONTRA, [{ ledgerId: CASH.id }, { ledgerId: BANK.id }], map)).toBeNull();
    expect(contraLedgerError(VoucherType.CONTRA, [{ ledgerId: LOOSE_CASH.id }, { ledgerId: BANK.id }], map)).toMatch(/Cash \(no account\)/);
    expect(contraLedgerError(VoucherType.CONTRA, [{ ledgerId: VENDOR.id }, { ledgerId: BANK.id }], map)).toMatch(/ABC Traders/);
    expect(contraLedgerError(VoucherType.PAYMENT, [{ ledgerId: VENDOR.id }, { ledgerId: BANK.id }], map)).toBeNull();
  });
});
