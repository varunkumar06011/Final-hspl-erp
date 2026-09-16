import { prisma } from '../src/config/prisma';
import { logAudit } from '../src/services/audit.service';
import { AuditAction } from '@hospital-erp/shared';

// Quotations that fed the three hard-deleted POs
const TARGETS = [
  { qid: 'e014aeb2-3a71-4c63-bfd5-d270024235e5', forPo: 'VGH-PO019' },
  { qid: 'dd393139-3cd9-4323-bd2d-50a5b5b52f3c', forPo: 'VGH-PO020' },
  { qid: 'dcbb0e75-851a-4f89-a5a7-df24fb3470e2', forPo: 'VGH-PO021' },
];

async function main() {
  for (const { qid, forPo } of TARGETS) {
    const q = await prisma.quotation.findUnique({
      where: { id: qid },
      include: {
        purchaseOrders: { select: { id: true, poNumber: true, deletedAt: true } },
        approvalWorkflow: { select: { id: true, status: true } },
        items: { select: { id: true } },
      },
    });
    if (!q) { console.log(`${qid}: NOT FOUND`); continue; }
    console.log(`\n${q.quotationNumber} (for deleted ${forPo}): status=${q.status} items=${q.items.length} POs=[${q.purchaseOrders.map((p) => `${p.poNumber}${p.deletedAt ? '(del)' : ''}`).join(',') || 'none'}] workflow=${q.approvalWorkflow?.status ?? 'none'}`);

    // safety: refuse if another live PO references it
    const livePos = q.purchaseOrders.filter((p) => !p.deletedAt);
    if (livePos.length > 0) {
      console.error(`  ABORT: still referenced by live PO(s)`);
      continue;
    }
    if (q.status === 'DELETED') { console.log('  already DELETED — skip'); continue; }

    await prisma.quotation.update({ where: { id: qid }, data: { status: 'DELETED' } });
    await logAudit({
      userId: q.createdBy,
      action: AuditAction.DELETE,
      entityType: 'QUOTATION',
      entityId: q.id,
      projectId: q.projectId,
      oldValue: { quotationNumber: q.quotationNumber, status: q.status },
      newValue: { status: 'DELETED', reason: `Soft-removed — its PO ${forPo} was deleted` },
    });
    console.log(`  -> status set to DELETED`);
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
