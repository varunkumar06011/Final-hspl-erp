import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * A vendor can hold several bank accounts (VendorBankAccount). Exactly one is primary and is
 * mirrored onto the vendor's own bankName / accountHolderName / bankAccountNumber / ifscCode
 * columns, so every reader of those columns keeps the primary account. Writes that touch the
 * accounts must go through the helpers here so the mirror never drifts.
 */

export interface BankAccountFields {
  bankName?: string | null;
  accountHolderName?: string | null;
  accountNumber: string;
  ifscCode: string;
}

type AccountRow = { bankName: string | null; accountHolderName: string | null; accountNumber: string; ifscCode: string };

/** The vendor-column values that mirror a primary account (all null when there is none). */
export function mirrorOf(account: AccountRow | null | undefined) {
  return {
    bankName: account?.bankName ?? null,
    accountHolderName: account?.accountHolderName ?? null,
    bankAccountNumber: account?.accountNumber ?? null,
    ifscCode: account?.ifscCode ?? null,
  };
}

/** Makes one account the vendor's only primary and mirrors it onto the vendor. Runs inside `tx`. */
export async function makePrimary(tx: Prisma.TransactionClient, vendorId: string, accountId: string): Promise<void> {
  await tx.vendorBankAccount.updateMany({
    where: { vendorId, isPrimary: true, NOT: { id: accountId } },
    data: { isPrimary: false },
  });
  const account = await tx.vendorBankAccount.update({ where: { id: accountId }, data: { isPrimary: true } });
  await tx.vendor.update({ where: { id: vendorId }, data: mirrorOf(account) });
}

/**
 * Vendor PATCH: turns the vendor's bank fields in `body` into one nested write on its primary
 * account, plus the matching mirror columns. Returns {} when the body has no bank fields.
 *
 * - Number and IFSC both present: the primary account is updated, or created when there is none.
 * - Both cleared: the primary account is removed, unless a request already pays to it. In that
 *   case it is kept, so the history stays intact, and the clear is not applied.
 */
export async function vendorBankUpdateData(vendorId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const keys = ['bankName', 'accountHolderName', 'bankAccountNumber', 'ifscCode'];
  if (!keys.some((k) => body[k] !== undefined)) return {};

  const primary = await prisma.vendorBankAccount.findFirst({ where: { vendorId, isPrimary: true } });
  const pick = (key: string, current: string | null | undefined): string | null =>
    body[key] !== undefined ? ((body[key] as string | null) || null) : (current ?? null);
  const next = {
    bankName: pick('bankName', primary?.bankName),
    accountHolderName: pick('accountHolderName', primary?.accountHolderName),
    accountNumber: pick('bankAccountNumber', primary?.accountNumber),
    ifscCode: pick('ifscCode', primary?.ifscCode),
  };

  if (next.accountNumber && next.ifscCode) {
    const fields = {
      bankName: next.bankName,
      accountHolderName: next.accountHolderName,
      accountNumber: next.accountNumber,
      ifscCode: next.ifscCode,
    };
    return {
      ...mirrorOf(fields as AccountRow),
      bankAccounts: primary
        ? { update: { where: { id: primary.id }, data: fields } }
        : { create: { ...fields, isPrimary: true } },
    };
  }

  if (!primary) return mirrorOf(null);
  const used = await prisma.materialPurchaseRequest.count({ where: { paymentBankAccountId: primary.id } });
  if (used > 0) return {};
  return { ...mirrorOf(null), bankAccounts: { delete: { id: primary.id } } };
}
