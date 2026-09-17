import { prisma } from '../src/config/prisma';
import { logAudit } from '../src/services/audit.service';
import { AuditAction } from '@hospital-erp/shared';

// Renumber: source PO keeps its id/items/relations — only poNumber changes.
const RENUMBER: Array<{ from: string; to: string }> = [
  { from: 'VGH-PO024', to: 'VGH-PO021' },
  { from: 'VGH-PO023', to: 'VGH-PO020' },
  { from: 'VGH-PO022', to: 'VGH-PO019' },
];
const DELETE_NUMBERS = ['VGH-PO019', 'VGH-PO020', 'VGH-PO021'];

const PO_SNAPSHOT_INCLUDE = {
  items: true,
  invoices: { select: { id: true } },
  gatePasses: { select: { id: true } },
  goodsReceipts: { select: { id: true } },
  workTasks: { select: { id: true } },
  assets: { select: { id: true } },
  paymentSheets: { select: { id: true } },
  advancePaymentRequests: { select: { id: true } },
  childPos: { select: { id: true, poNumber: true } },
  approvalWorkflow: { select: { id: true, status: true, entityId: true } },
  vendor: { select: { id: true, name: true } },
} as const;

async function main() {
  const projectPos = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: [...DELETE_NUMBERS, ...RENUMBER.map((r) => r.from)] }, deletedAt: null },
    include: PO_SNAPSHOT_INCLUDE,
  });
  if (projectPos.length !== 6) {
    console.error(`Expected 6 POs, found ${projectPos.length}:`, projectPos.map((p) => p.poNumber));
    process.exit(1);
  }
  const byNumber = new Map(projectPos.map((p) => [p.poNumber, p]));
  const projectId = projectPos[0].projectId;

  // Safety: refuse to delete a target PO that has acquired financial links
  for (const n of DELETE_NUMBERS) {
    const po = byNumber.get(n)!;
    const links =
      po.invoices.length + po.gatePasses.length + po.goodsReceipts.length +
      po.workTasks.length + po.assets.length + po.paymentSheets.length +
      po.advancePaymentRequests.length + po.childPos.length;
    if (links > 0) {
      console.error(`ABORT: ${n} has ${links} dependent records — refusing to hard-delete`);
      process.exit(1);
    }
  }

  const before = new Map(RENUMBER.map((r) => [r.from, byNumber.get(r.from)!]));

  await prisma.$transaction(async (tx) => {
    // 1. Hard-delete the three target POs (frees the numbers).
    //    POItem cascades via onDelete: Cascade; approval workflow unlinked then deleted (steps cascade).
    for (const n of DELETE_NUMBERS) {
      const po = byNumber.get(n)!;
      if (po.approvalWorkflowId) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { approvalWorkflowId: null } });
        await tx.approvalWorkflow.delete({ where: { id: po.approvalWorkflowId } });
      }
      await tx.purchaseOrder.delete({ where: { id: po.id } });
      console.log(`deleted ${n} (id=${po.id})`);
    }

    // 2. Renumber the surviving POs into the freed slots.
    for (const { from, to } of RENUMBER) {
      const po = byNumber.get(from)!;
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { poNumber: to } });
      console.log(`renumbered ${from} -> ${to} (id=${po.id})`);
    }
  });

  // Audit trail — attributed to each PO's creator
  for (const { from, to } of RENUMBER) {
    const po = before.get(from)!;
    await logAudit({
      userId: po.createdBy,
      action: AuditAction.UPDATE,
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      projectId,
      oldValue: { poNumber: from },
      newValue: { poNumber: to, reason: 'PO number reassignment — replaces deleted ' + to },
    });
  }
  for (const n of DELETE_NUMBERS) {
    const po = byNumber.get(n)!;
    await logAudit({
      userId: po.createdBy,
      action: AuditAction.DELETE,
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      projectId,
      oldValue: { poNumber: n, status: po.status, grandTotal: String(po.grandTotal) },
      newValue: { deleted: true, reason: 'Deleted per PO renumbering request' },
    });
  }

  // ── Verification ──
  console.log('\n── VERIFY ──');
  const after = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: ['VGH-PO019', 'VGH-PO020', 'VGH-PO021', 'VGH-PO022', 'VGH-PO023', 'VGH-PO024'] } },
    include: PO_SNAPSHOT_INCLUDE,
  });
  const numbers = after.map((p) => p.poNumber);
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  console.log(`duplicates: ${dupes.length === 0 ? 'none' : dupes.join(',')}`);

  for (const { from, to } of RENUMBER) {
    const oldPo = before.get(from)!;
    const newPo = after.find((p) => p.id === oldPo.id)!;
    if (!newPo || newPo.poNumber !== to) {
      console.error(`FAIL: ${oldPo.id} expected ${to}, got ${newPo?.poNumber}`);
      process.exit(1);
    }
    const same =
      newPo.vendorId === oldPo.vendorId &&
      String(newPo.grandTotal) === String(oldPo.grandTotal) &&
      String(newPo.netPayable) === String(oldPo.netPayable) &&
      newPo.status === oldPo.status &&
      newPo.items.length === oldPo.items.length &&
      newPo.approvalWorkflow?.id === oldPo.approvalWorkflow?.id &&
      newPo.approvalWorkflow?.entityId === oldPo.id;
    console.log(`${to}: id=${newPo.id} vendor=${newPo.vendor.name} total=${newPo.grandTotal} items=${newPo.items.length} workflow=${newPo.approvalWorkflow?.status} preserved=${same}`);
    if (!same) process.exit(1);
  }

  // deleted numbers must not exist at all now
  const leftovers = await prisma.purchaseOrder.count({ where: { poNumber: { in: DELETE_NUMBERS }, id: { notIn: RENUMBER.map((r) => byNumber.get(r.from)!.id) } } });
  console.log(`leftover rows with deleted numbers: ${leftovers}`);
  if (leftovers !== 0) process.exit(1);
  console.log('\nDONE — all checks passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
