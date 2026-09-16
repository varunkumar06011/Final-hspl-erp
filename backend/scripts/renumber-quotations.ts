import { prisma } from '../src/config/prisma';
import { logAudit } from '../src/services/audit.service';
import { AuditAction } from '@hospital-erp/shared';

// Mirror of the PO renumber: freed slots are held by DELETED quotations,
// so suffix them -DEL, then move the live quotations into place.
const RENUMBER: Array<{ from: string; to: string }> = [
  { from: 'VGH-Q021', to: 'VGH-Q018' },
  { from: 'VGH-Q022', to: 'VGH-Q019' },
  { from: 'VGH-Q023', to: 'VGH-Q020' },
];
const FREED = ['VGH-Q018', 'VGH-Q019', 'VGH-Q020']; // currently DELETED rows

async function main() {
  const qs = await prisma.quotation.findMany({
    where: { quotationNumber: { in: [...FREED, ...RENUMBER.map((r) => r.from)] } },
    include: { purchaseOrders: { select: { id: true, poNumber: true } } },
  });
  const byNum = new Map(qs.map((q) => [q.quotationNumber, q]));

  for (const n of FREED) {
    const q = byNum.get(n);
    if (!q || q.status !== 'DELETED') {
      console.error(`ABORT: ${n} expected DELETED, got ${q?.status}`);
      process.exit(1);
    }
  }
  for (const { from } of RENUMBER) {
    const q = byNum.get(from);
    if (!q || q.status === 'DELETED' || q.deletedAt) {
      console.error(`ABORT: ${from} expected live, got status=${q?.status}`);
      process.exit(1);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const n of FREED) {
      await tx.quotation.update({ where: { id: byNum.get(n)!.id }, data: { quotationNumber: `${n}-DEL` } });
      console.log(`freed ${n} -> ${n}-DEL`);
    }
    for (const { from, to } of RENUMBER) {
      await tx.quotation.update({ where: { id: byNum.get(from)!.id }, data: { quotationNumber: to } });
      console.log(`renumbered ${from} -> ${to}`);
    }
  });

  for (const { from, to } of RENUMBER) {
    const q = byNum.get(from)!;
    await logAudit({
      userId: q.createdBy, action: AuditAction.UPDATE, entityType: 'QUOTATION', entityId: q.id,
      projectId: q.projectId,
      oldValue: { quotationNumber: from },
      newValue: { quotationNumber: to, reason: 'Renumbered to match reassigned PO number' },
    });
  }

  console.log('\n── VERIFY ──');
  const after = await prisma.quotation.findMany({
    where: { quotationNumber: { in: ['VGH-Q018', 'VGH-Q019', 'VGH-Q020', 'VGH-Q018-DEL', 'VGH-Q019-DEL', 'VGH-Q020-DEL'] } },
    include: { purchaseOrders: { select: { poNumber: true } } },
    orderBy: { quotationNumber: 'asc' },
  });
  for (const q of after) {
    console.log(`${q.quotationNumber}: status=${q.status} total=${q.grandTotal} POs=[${q.purchaseOrders.map((p) => p.poNumber).join(',') || 'none'}]`);
  }
  const all = await prisma.quotation.findMany({ select: { projectId: true, quotationNumber: true } });
  const seen = new Map<string, number>();
  for (const q of all) seen.set(`${q.projectId}|${q.quotationNumber}`, (seen.get(`${q.projectId}|${q.quotationNumber}`) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1);
  console.log(`duplicates: ${dupes.length === 0 ? 'NONE' : JSON.stringify(dupes)}`);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
