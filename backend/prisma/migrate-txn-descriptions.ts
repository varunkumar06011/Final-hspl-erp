/**
 * One-time migration: rewrite existing transaction descriptions to the
 * standard "Payee · Item · Ref" format.
 *
 * Run with:  npx tsx prisma/migrate-txn-descriptions.ts
 *
 * Targets three tables that feed the Recent Transactions list:
 *   - payment_requests  (description column — daily expenses)
 *   - bank_transactions (description column)
 *   - cash_transactions (description column)
 *
 * The rewriter uses heuristic parsing to extract a Payee, Item, and Ref from
 * the old free-text. Rows that already conform are skipped. Rows that cannot
 * be parsed into at least 2 segments are left untouched (flagged in the log)
 * so a human can review them manually.
 *
 * DRY RUN by default — pass --apply to actually write to the database.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MIDDLE_DOT = '\u00B7';
const FORBIDDEN_RE = /\b(paid to|purchase of|vide|as on|purpose)\b|rs\.|₹|\d\s*[x×]\s*\d/i;

/** True if a description already follows the Payee · Item · Ref standard. */
function alreadyConforms(desc: string): boolean {
  const segments = desc.split(MIDDLE_DOT).map((s) => s.trim());
  if (segments.length < 2 || segments.length > 3) return false;
  if (!segments.every((s) => s.length >= 1 && s.length <= 40)) return false;
  return !FORBIDDEN_RE.test(desc);
}

/**
 * Heuristic rewriter. Extracts Payee, Item, and Ref from old free-text.
 * Returns null if it cannot produce at least a Payee + Item.
 */
function rewriteDescription(oldDesc: string, category?: string | null): string | null {
  let text = oldDesc.trim();
  if (!text) return null;

  // 1. Strip forbidden filler words
  text = text.replace(/\b(paid to|purchase of)\b/gi, '');
  // "vide Bill No. 39 dt 05.09.26" → keep "Bill No. 39" as ref candidate
  // "as on 04.09.26" / "dt 31.08.26" → remove date references
  text = text.replace(/\b(as on|dt)\b\s*\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/gi, '');
  text = text.replace(/\bdt\b\s*\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/gi, '');
  text = text.replace(/\bvide\b/gi, '');
  // "for ... purpose" / "purpose" filler
  text = text.replace(/\bfor\b\s+(.+?)\s+purpose\b/gi, '$1');
  text = text.replace(/\bpurpose\b/gi, '');
  // Remove amounts / arithmetic: "3 x 1400 = Rs. 4,200/-"
  text = text.replace(/\d+\s*[x×]\s*\d+\s*=\s*rs\.?\s*[\d,./-]+/gi, '');
  text = text.replace(/rs\.?\s*[\d,./-]+/gi, '');
  // Remove standalone dates
  text = text.replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, '');
  // Remove phone numbers in prose
  text = text.replace(/\b\d{10}\b/g, '');
  text = text.replace(/\b\d{5}\s*\d{5}\b/g, '');
  // Clean up leftover punctuation/whitespace
  text = text.replace(/[,\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip leading/trailing separators and parens
  text = text.replace(/^[-,:(\s]+|[-,):\s]+$/g, '').trim();

  if (!text) return null;

  // 2. Extract a reference code (Bill No, Voucher No, Quotation dated, etc.)
  let ref = '';
  const refPatterns = [
    /bill\s*no\.?\s*(\d+)/i,
    /voucher\s*no\.?\s*(\d+)/i,
    /quotation\s*(?:dated\s*\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})?/i,
    /inv(?:oice)?\s*(?:no\.?)?\s*([A-Z0-9-]+)/i,
  ];
  for (const pat of refPatterns) {
    const m = text.match(pat);
    if (m) {
      if (m[1]) {
        const prefix = text.match(/bill/i) ? 'BILL-' : text.match(/voucher/i) ? 'VOU-' : 'INV-';
        ref = `${prefix}${m[1]}`;
      } else {
        ref = 'QT';
      }
      text = text.replace(pat, '').trim();
      break;
    }
  }

  // 3. Extract vendor from parentheses: "Green Mats (Sri Ambica Plastic)"
  let payee = '';
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (parenMatch) {
    payee = parenMatch[1].trim();
    text = text.replace(/\([^)]+\)/, '').trim();
  }

  // 4. Split remaining text into words to find payee + item
  text = text.replace(/^[-,:\s]+|[-,:\s]+$/g, '').trim();
  if (!text) {
    if (payee) {
      // Only have a payee from parens — use category as item
      return ref ? `${payee} · ${category ?? 'Expense'}${ref ? ` · ${ref}` : ''}` : `${payee} · ${category ?? 'Expense'}`;
    }
    return null;
  }

  // If we didn't find a payee in parens, try to identify it.
  // Heuristic: "PhonePe to Tirupathirao - 93904 20823 for sand lift"
  // After cleanup: "Tirupathirao sand lift"
  // First word(s) that look like a name = payee, rest = item.
  if (!payee) {
    const words = text.split(' ').filter(Boolean);
    // If text starts with a known pattern like "PhonePe to X" or "to X"
    const toMatch = text.match(/^to\s+(.+?)(?:\s+for\b|\s*$)/i);
    if (toMatch) {
      const afterTo = toMatch[1].trim();
      const w = afterTo.split(' ');
      payee = w.slice(0, Math.min(2, w.length)).join(' ');
      text = w.slice(Math.min(2, w.length)).join(' ') || category ?? 'Expense';
    } else if (words.length >= 2) {
      // First 1-2 words = payee, rest = item
      const payeeWordCount = words.length <= 3 ? 1 : 2;
      payee = words.slice(0, payeeWordCount).join(' ');
      text = words.slice(payeeWordCount).join(' ');
    } else {
      // Single word — use it as payee, category as item
      payee = words[0];
      text = category ?? 'Expense';
    }
  }

  // 5. Clean up and assemble
  payee = payee.replace(/^[-,:\s]+|[-,:\s]+$/g, '').trim();
  let item = text.replace(/^[-,:\s]+|[-,:\s]+$/g, '').trim();
  if (!item) item = category ?? 'Expense';
  if (!payee) payee = category ?? 'Cash';

  // Truncate segments to max 40 chars
  payee = payee.length > 40 ? payee.slice(0, 37) + '…' : payee;
  item = item.length > 40 ? item.slice(0, 37) + '…' : item;
  ref = ref.length > 20 ? ref.slice(0, 20) : ref;

  // Title-case payee and item for consistency
  payee = titleCase(payee);
  item = titleCase(item);

  const parts = [payee, item];
  if (ref) parts.push(ref);
  return parts.join(` ${MIDDLE_DOT} `);
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function migrateTable(
  label: string,
  fetchRows: () => Promise<{ id: string; description: string | null; category?: string | null }[]>,
  updateRow: (id: string, newDesc: string) => Promise<unknown>,
  apply: boolean,
) {
  const rows = await fetchRows();
  const candidates = rows.filter((r) => r.description && !alreadyConforms(r.description));
  console.log(`\n[${label}] ${rows.length} total rows, ${candidates.length} need rewriting`);

  let rewritten = 0;
  let skipped = 0;
  const failed: { id: string; old: string }[] = [];

  for (const row of candidates) {
    const oldDesc = row.description!;
    const newDesc = rewriteDescription(oldDesc, row.category);
    if (!newDesc) {
      failed.push({ id: row.id, old: oldDesc });
      skipped++;
      continue;
    }
    if (apply) {
      await updateRow(row.id, newDesc);
    }
    if (rewritten < 5 || apply) {
      console.log(`  ${apply ? '✓' : '•'} ${oldDesc.slice(0, 60)}  →  ${newDesc}`);
    }
    rewritten++;
  }

  console.log(`  ${rewritten} rewritten, ${skipped} unparseable (left as-is)`);
  if (failed.length > 0) {
    console.log(`  ⚠ Unparseable rows (review manually):`);
    for (const f of failed.slice(0, 10)) {
      console.log(`    ${f.id}: "${f.old}"`);
    }
    if (failed.length > 10) console.log(`    ... and ${failed.length - 10} more`);
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Transaction Description Migration`);
  console.log(`  Mode: ${apply ? 'APPLY (writing to DB)' : 'DRY RUN (no changes)'}`);
  console.log(`${'═'.repeat(60)}`);

  // 1. PaymentRequest (daily expenses)
  await migrateTable(
    'PaymentRequest',
    () => prisma.paymentRequest.findMany({
      where: { description: { not: null }, deletedAt: null, type: 'EXPENSE' },
      select: { id: true, description: true, category: true },
    }),
    (id, desc) => prisma.paymentRequest.update({ where: { id }, data: { description: desc } }),
    apply,
  );

  // 2. BankTransaction
  await migrateTable(
    'BankTransaction',
    () => prisma.bankTransaction.findMany({
      where: { description: { not: null } },
      select: { id: true, description: true },
    }),
    (id, desc) => prisma.bankTransaction.update({ where: { id }, data: { description: desc } }),
    apply,
  );

  // 3. CashTransaction
  await migrateTable(
    'CashTransaction',
    () => prisma.cashTransaction.findMany({
      where: { description: { not: null } },
      select: { id: true, description: true },
    }),
    (id, desc) => prisma.cashTransaction.update({ where: { id }, data: { description: desc } }),
    apply,
  );

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Done. ${apply ? 'Changes were written to the database.' : 'Dry run complete — pass --apply to write.'}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
