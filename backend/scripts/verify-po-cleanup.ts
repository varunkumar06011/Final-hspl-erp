/**
 * READ-ONLY: Verify the 3 restored POs are now DELETED and no longer
 * appear in Action Required or the active PO list.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PO_IDS = [
  '96067622-34ad-4398-b383-323ae0aa7d70', // VGH-PO003
  '36792ab5-6fff-40a4-a168-ddfa95b9d1e6', // VGH-PO011
  '9f8be2c5-2679-4e25-ac9c-f650b1c3cf44', // VGH-PO012
];

async function main() {
  console.log('VERIFICATION: Post-cleanup state\n');

  // 1. Check the 3 POs are now DELETED
  const pos = await prisma.purchaseOrder.findMany({
    where: { id: { in: PO_IDS } },
    select: { id: true, poNumber: true, status: true, updatedAt: true },
  });
  console.log('Restored POs — current status:');
  for (const po of pos) {
    console.log(`  ${po.poNumber} | status: ${po.status} | updated: ${po.updatedAt.toISOString()}`);
  }

  // 2. Check Action Required (POs not in excluded statuses)
  const actionPOs = await prisma.purchaseOrder.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELETED'] },
    },
    select: { id: true, poNumber: true, status: true, createdAt: true },
  });
  console.log(`\nPOs currently in Action Required (non-terminal statuses): ${actionPOs.length}`);
  for (const po of actionPOs) {
    console.log(`  ${po.poNumber} | ${po.status} | created: ${po.createdAt.toISOString()}`);
  }

  // 3. Check all POs in the project (summary)
  const allPOs = await prisma.purchaseOrder.findMany({
    select: { poNumber: true, status: true },
    orderBy: { poNumber: 'asc' },
  });
  console.log(`\nAll POs in project (${allPOs.length} total):`);
  for (const po of allPOs) {
    console.log(`  ${po.poNumber.padEnd(12)} | ${po.status}`);
  }

  // 4. Check the payment request that was linked to PO012
  const paymentReq = await prisma.paymentRequest.findMany({
    where: { poId: '9f8be2c5-2679-4e25-ac9c-f650b1c3cf44' },
    select: { id: true, paymentCode: true, status: true, deletedAt: true },
  });
  console.log(`\nPayment requests linked to VGH-PO012: ${paymentReq.length}`);
  for (const pr of paymentReq) {
    console.log(`  ${pr.paymentCode} | status: ${pr.status} | deletedAt: ${pr.deletedAt?.toISOString() ?? 'null'}`);
  }

  // 5. Verify audit trail
  const newAudits = await prisma.auditLog.findMany({
    where: {
      entityType: 'PURCHASE_ORDER',
      entityId: { in: PO_IDS },
      action: 'DELETE',
      timestamp: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // last 5 minutes
    },
    select: { entityId: true, action: true, timestamp: true, newValue: true },
  });
  console.log(`\nNew DELETE audit entries created by cleanup: ${newAudits.length}`);
  for (const a of newAudits) {
    const poNum = pos.find(p => p.id === a.entityId)?.poNumber ?? 'unknown';
    console.log(`  ${poNum} | ${a.timestamp.toISOString()} | ${JSON.stringify(a.newValue)}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
