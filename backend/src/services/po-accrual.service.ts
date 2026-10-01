/**
 * PO vendor-payable accrual.
 *
 * When a PO is fully approved we owe the vendor, so the books are updated straight away:
 *   Dr Purchase      Cr Vendor ledger      (grand total less PO deductions)
 * A later payment voucher debits the vendor ledger, bringing it back to zero.
 *
 * `reconcilePoAccrual` is idempotent: it compares what the PO's payable *should*
 * be (grand total while the PO is approved/delivered, zero otherwise) with what
 * is already booked on vouchers carrying `sourcePoId = po.id` and posts only the
 * difference. The same call therefore handles first approval, a revised
 * grand total after an edit + re-approval, and reversal on reject/deactivate.
 *
 * POs flagged `accrualExempt` (approved before this existed — their books were
 * handled by the accountant) are skipped unless `force` is passed.
 */
import { Prisma } from '@prisma/client';
import { POStatus, VoucherType, LedgerGroup } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { ensureVendorLedger, findLedgerByName } from '../routes/ledger.routes';
import { postVoucher, generateVoucherNumber } from '../routes/voucher.routes';

const ACTIVE_PO_STATUSES: string[] = [POStatus.APPROVED, POStatus.PARTIALLY_DELIVERED, POStatus.DELIVERED];

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AccrualLine {
  ledgerId: string;
  debit: number;
  credit: number;
}

/**
 * What we actually owe the vendor: the grand total less any deductions agreed
 * at PO creation (TDS, retention, advance adjustment, "pay after delivery"...).
 * Payments are made against this net amount, so it is what gets credited.
 */
export function payableAfterDeductions(grandTotal: number, totalDeductions: number): number {
  return Math.max(0, round2(grandTotal - Math.max(0, totalDeductions)));
}

/** Net (debit − credit) per ledger that the PO's payable should currently have. */
export function buildDesiredAccrual(args: {
  payable: number;
  vendorLedgerId: string;
  purchaseLedgerId: string;
}): Map<string, number> {
  // Input GST is deliberately NOT split out here: it is only claimable against
  // the vendor's tax invoice, which the accountant books separately. The whole
  // payable sits in Purchase until Post to Ledger moves it to an expense ledger.
  const payable = round2(args.payable);
  const desired = new Map<string, number>();
  desired.set(args.purchaseLedgerId, payable);
  desired.set(args.vendorLedgerId, -payable);
  return desired;
}

/** Voucher lines that move `existing` to `desired` (both are net debit − credit per ledger). */
export function computeAccrualDelta(desired: Map<string, number>, existing: Map<string, number>): AccrualLine[] {
  const lines: AccrualLine[] = [];
  const ids = new Set([...desired.keys(), ...existing.keys()]);
  for (const ledgerId of ids) {
    const delta = round2((desired.get(ledgerId) ?? 0) - (existing.get(ledgerId) ?? 0));
    if (Math.abs(delta) < 0.005) continue;
    lines.push(delta > 0 ? { ledgerId, debit: delta, credit: 0 } : { ledgerId, debit: 0, credit: -delta });
  }
  return lines;
}

async function getOrCreatePurchaseLedgerId(projectId: string): Promise<string> {
  const existing = await findLedgerByName('Purchase', projectId);
  if (existing) return existing;
  const created = await prisma.ledger.create({
    data: {
      projectId,
      name: 'Purchase',
      group: LedgerGroup.PURCHASE,
      linkedEntityType: 'NONE',
      openingBalance: 0,
      currentBalance: 0,
      isActive: true,
    },
  });
  return created.id;
}

/** True when a voucher booking this PO's payable exists. Goods receipt / invoice posting check this to avoid double-booking. */
export async function hasPoAccrual(
  poId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const jv = await client.journalVoucher.findFirst({
    where: { sourcePoId: poId, deletedAt: null },
    select: { id: true },
  });
  return !!jv;
}

export type AccrualResult =
  | { action: 'skipped'; reason: 'not-found' | 'exempt' }
  | { action: 'none' }
  | { action: 'posted'; jvNumber: string; lines: AccrualLine[]; kind: 'booked' | 'revised' | 'reversed' };

export async function reconcilePoAccrual(
  poId: string,
  userId: string,
  opts: { force?: boolean; tx?: Prisma.TransactionClient; dryRun?: boolean; creditLedgerId?: string } = {},
): Promise<AccrualResult> {
  const run = async (tx: Prisma.TransactionClient): Promise<AccrualResult> => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        projectId: true,
        poNumber: true,
        status: true,
        deletedAt: true,
        grandTotal: true,
        totalDeductions: true,
        vendorId: true,
        accrualExempt: true,
        accrualLedgerId: true,
        vendor: { select: { name: true } },
      },
    });
    if (!po) return { action: 'skipped', reason: 'not-found' };
    if (po.accrualExempt && !opts.force) return { action: 'skipped', reason: 'exempt' };

    const entries = await tx.ledgerEntry.findMany({
      where: { journalVoucher: { sourcePoId: po.id, deletedAt: null } },
      select: { ledgerId: true, debit: true, credit: true },
    });
    const existing = new Map<string, number>();
    for (const e of entries) {
      existing.set(e.ledgerId, round2((existing.get(e.ledgerId) ?? 0) + Number(e.debit) - Number(e.credit)));
    }

    const payable = payableAfterDeductions(Number(po.grandTotal), Number(po.totalDeductions ?? 0));
    const active = !po.deletedAt && ACTIVE_PO_STATUSES.includes(po.status) && payable > 0;
    if (!active && entries.length === 0) return { action: 'none' };

    let desired = new Map<string, number>();
    if (active) {
      // Normally the vendor's own ledger; a PO can be pinned to another ledger
      // (e.g. a loan account the payment was already made against).
      const overrideLedgerId = opts.creditLedgerId ?? po.accrualLedgerId;
      const [vendorLedgerId, purchaseLedgerId] = await Promise.all([
        overrideLedgerId ?? ensureVendorLedger(po.vendorId, po.projectId),
        getOrCreatePurchaseLedgerId(po.projectId),
      ]);
      desired = buildDesiredAccrual({ payable, vendorLedgerId, purchaseLedgerId });
    }

    const lines = computeAccrualDelta(desired, existing);
    if (lines.length === 0) return { action: 'none' };

    const kind = !active ? 'reversed' : entries.length === 0 ? 'booked' : 'revised';
    if (opts.dryRun) return { action: 'posted', jvNumber: '(dry run)', lines, kind };

    const ledgers = await tx.ledger.findMany({ where: { id: { in: lines.map((l) => l.ledgerId) }, projectId: po.projectId } });
    const ledgerMap = new Map(
      ledgers.map((l) => [l.id, { id: l.id, name: l.name, group: l.group, linkedEntityType: l.linkedEntityType, linkedEntityId: l.linkedEntityId }]),
    );
    if (ledgerMap.size !== lines.length) throw new Error(`PO ${po.poNumber}: a ledger needed for the vendor payable was not found`);

    const vendorName = po.vendor.name.trim();
    const description =
      kind === 'booked'
        ? `PO ${po.poNumber} approved - payable to ${vendorName}`
        : kind === 'revised'
          ? `PO ${po.poNumber} revised - payable to ${vendorName} adjusted`
          : `PO ${po.poNumber} no longer approved - payable to ${vendorName} reversed`;

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const jvNumber = await generateVoucherNumber(VoucherType.PURCHASE, po.projectId);
    await postVoucher({
      projectId: po.projectId,
      jvNumber,
      voucherType: VoucherType.PURCHASE,
      voucherDate: new Date(),
      description,
      totalDebit,
      totalCredit: totalDebit,
      // No budgetHeadId anywhere: the PO's budget commitment is tracked on the
      // budget head separately, and tagging here would double-count spend.
      entries: lines.map((l) => ({ ...l, description })),
      ledgerMap,
      budgetHeadMap: new Map(),
      sourceInvoiceId: null,
      sourcePoId: po.id,
      billSettlements: [],
      userId,
      tx,
    });
    return { action: 'posted', jvNumber, lines, kind };
  };

  if (opts.tx) return run(opts.tx);
  return prisma.$transaction(run);
}

/**
 * Approval hook: never lets a bookkeeping failure undo an approval that has
 * already been recorded — logs it instead. `reconcilePoAccrual` is idempotent,
 * so the next approval/edit (or the backfill script) repairs a missed posting.
 */
export async function reconcilePoAccrualSafe(poId: string, userId: string): Promise<AccrualResult | null> {
  try {
    return await reconcilePoAccrual(poId, userId);
  } catch (err) {
    console.error(`[PO accrual] failed to reconcile vendor payable for PO ${poId}:`, err);
    return null;
  }
}
