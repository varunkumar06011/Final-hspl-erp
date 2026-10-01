/**
 * Backfill the vendor payable (Dr Purchase / Cr Vendor) for POs that were
 * approved BEFORE auto-booking existed.
 *
 * Only the POs you name are touched (every other existing PO stays exempt), so
 * POs the accountant already journalled are never double-booked. The credit is
 * the PO's grand total less its deductions (net payable). Input GST is not booked.
 *
 * THREE MODES (this script never deletes anything):
 *
 *   1. DRY RUN (default) — reads only, prints the voucher lines it would post.
 *        npx tsx prisma/backfill-po-accrual.ts --po VGH-PO002,VGH-PO004 --user SHAFI
 *
 *   2. --simulate — really runs the posting against the database inside a
 *      transaction, prints the resulting ledger balances, then ROLLS BACK.
 *      Nothing is saved. Use it to prove the real posting path works.
 *        npx tsx prisma/backfill-po-accrual.ts --po VGH-PO042 --user SHAFI --simulate
 *
 *   3. --apply — posts and commits, one transaction per PO.
 *        npx tsx prisma/backfill-po-accrual.ts --po VGH-PO042 --user SHAFI --apply
 *
 * --credit-ledger "PO=Ledger name" (repeatable) credits that ledger instead of
 * the vendor's own, and pins it on the PO so later edits keep using it:
 *        --credit-ledger "VGH-PO033=USL - S. Ashok Kumar"
 *
 * --user is the name of the user recorded as the voucher creator.
 * To undo a posted voucher, cancel it on the Vouchers page (writes reversing entries).
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma';
import { reconcilePoAccrual } from '../src/services/po-accrual.service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function argAll(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

class Rollback extends Error {
  constructor(public readonly payload: string[]) {
    super('rollback');
  }
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const poNumbers = (arg('po') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const userName = arg('user');
  const apply = process.argv.includes('--apply');
  const simulate = process.argv.includes('--simulate');
  if (apply && simulate) throw new Error('Use either --apply or --simulate, not both');
  if (poNumbers.length === 0 || !userName) {
    console.error('Usage: tsx prisma/backfill-po-accrual.ts --po VGH-PO002,VGH-PO004 --user "<user name>" [--simulate | --apply] [--credit-ledger "PO=Ledger"]');
    process.exit(1);
  }

  const dbHost = (process.env.DATABASE_URL ?? '').replace(/^[a-z]+:\/\/[^@]*@/i, '').split('/')[0];
  console.log(`Database: ${dbHost}`);
  console.log(apply ? '*** APPLY MODE — vouchers WILL be posted and committed ***' : simulate ? '(simulate — posts inside a transaction, then rolls back; nothing is saved)' : '(dry run — reads only; nothing is changed)');

  const user = await prisma.user.findFirst({ where: { name: { equals: userName, mode: 'insensitive' } }, select: { id: true, name: true } });
  if (!user) throw new Error(`User "${userName}" not found`);

  const pos = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: poNumbers }, deletedAt: null },
    select: { id: true, projectId: true, poNumber: true, status: true, grandTotal: true, totalDeductions: true, vendor: { select: { name: true } } },
    orderBy: { poNumber: 'asc' },
  });
  const missing = poNumbers.filter((n) => !pos.some((p) => p.poNumber === n));
  if (missing.length) throw new Error(`Not found: ${missing.join(', ')} — nothing was done`);

  // Resolve --credit-ledger overrides up front so a typo aborts before anything runs
  const overrides = new Map<string, { id: string; name: string }>();
  for (const spec of argAll('credit-ledger')) {
    const [poNo, ...rest] = spec.split('=');
    const ledgerName = rest.join('=').trim();
    const po = pos.find((p) => p.poNumber === poNo.trim());
    if (!po) throw new Error(`--credit-ledger names ${poNo} which is not in --po`);
    const matches = await prisma.ledger.findMany({
      where: { projectId: po.projectId, deletedAt: null, isActive: true, name: { equals: ledgerName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (matches.length !== 1) throw new Error(`Ledger "${ledgerName}" matched ${matches.length} ledgers for ${poNo} — be exact`);
    overrides.set(po.id, matches[0]);
  }

  const ledgerName = async (id: string) => (await prisma.ledger.findUnique({ where: { id }, select: { name: true } }))?.name.trim() ?? id;

  let posted = 0;
  for (const po of pos) {
    const payable = Number(po.grandTotal) - Number(po.totalDeductions ?? 0);
    const override = overrides.get(po.id);
    console.log(`\n${po.poNumber}  ${po.vendor.name.trim()}  net payable ${fmt(payable)}  [${po.status}]${override ? `  -> credit "${override.name.trim()}"` : ''}`);

    if (!apply && !simulate) {
      const r = await reconcilePoAccrual(po.id, user.id, { force: true, dryRun: true, creditLedgerId: override?.id });
      if (r.action !== 'posted') console.log(`   nothing to post (${r.action})`);
      else for (const l of r.lines) console.log(`   ${l.debit ? 'Dr' : 'Cr'}  ${(await ledgerName(l.ledgerId)).padEnd(40)} ${fmt(l.debit || l.credit)}`);
      continue;
    }

    const work = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { accrualExempt: false, accrualLedgerId: override?.id ?? null } });
      const r = await reconcilePoAccrual(po.id, user.id, { tx });
      const summary: string[] = [];
      if (r.action === 'posted') {
        for (const l of r.lines) {
          const agg = await tx.ledgerEntry.aggregate({ where: { ledgerId: l.ledgerId }, _sum: { debit: true, credit: true } });
          const led = await tx.ledger.findUnique({ where: { id: l.ledgerId }, select: { name: true, openingBalance: true } });
          const closing = Number(led?.openingBalance ?? 0) + Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
          summary.push(`   ${l.debit ? 'Dr' : 'Cr'}  ${(led?.name.trim() ?? l.ledgerId).padEnd(40)} ${fmt(l.debit || l.credit)}   -> ledger closing ${closing >= 0 ? 'Dr' : 'Cr'} ${fmt(Math.abs(closing))}`);
        }
        summary.unshift(`   voucher ${r.jvNumber} (${r.kind})`);
      } else {
        summary.push(`   nothing to post (${r.action})`);
      }
      return { r, summary };
    };

    if (simulate) {
      try {
        await prisma.$transaction(async (tx) => {
          const { summary } = await work(tx);
          throw new Rollback(summary);
        }, { timeout: 60000 });
      } catch (e) {
        if (e instanceof Rollback) e.payload.forEach((line) => console.log(line));
        else throw e;
      }
      console.log('   (rolled back — nothing saved)');
    } else {
      const { r, summary } = await prisma.$transaction(work, { timeout: 60000 });
      summary.forEach((line) => console.log(line));
      if (r.action === 'posted') posted++;
    }
  }

  console.log(apply ? `\nDone: ${posted} voucher(s) posted and committed.` : simulate ? '\nSimulation complete — everything was rolled back.' : '\nDry run complete — nothing changed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
