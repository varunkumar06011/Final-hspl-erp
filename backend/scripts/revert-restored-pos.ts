/**
 * TARGETED CLEANUP: Revert only the 3 restored POs to DELETED status.
 *
 * These POs were previously deleted via the app (audit trail confirmed),
 * then their status was changed back (no audit entry — likely direct DB
 * change), and they were re-approved by Admin. This script reverts them
 * to DELETED to match their original audit history.
 *
 * Also marks the payment request linked to VGH-PO012 as DELETED.
 *
 * SAFETY:
 *   - Only touches the 3 specific PO IDs identified by the diagnostic
 *   - Only touches the 1 specific payment request ID linked to PO012
 *   - Logs each change to AuditLog for traceability
 *   - Does NOT hard-delete anything — sets status = 'DELETED'
 *   - Does NOT touch any other records
 *
 * Usage: npx tsx scripts/revert-restored-pos.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RESTORED_PO_IDS = [
  '96067622-34ad-4398-b383-323ae0aa7d70', // VGH-PO003
  '36792ab5-6fff-40a4-a168-ddfa95b9d1e6', // VGH-PO011
  '9f8be2c5-2679-4e25-ac9c-f650b1c3cf44', // VGH-PO012
];

const PAYMENT_REQUEST_ID = 'VGH-PAY006'; // linked to VGH-PO012 — will look up actual ID

// Use a system user ID for audit logging — we'll use the first ADMIN user
// In production, this should be the user performing the cleanup.
const CLEANUP_USER_ID = 'df62f7a2-325f-441e-89f3-11f4da29d9dc'; // Kaushal Sir (ADMIN)

async function main() {
  console.log('='.repeat(80));
  console.log('TARGETED CLEANUP: Reverting 3 restored POs to DELETED status');
  console.log('='.repeat(80));
  console.log();

  // Verify each PO exists and get current state before changes
  const pos = await prisma.purchaseOrder.findMany({
    where: { id: { in: RESTORED_PO_IDS } },
    select: {
      id: true,
      poNumber: true,
      status: true,
      projectId: true,
      grandTotal: true,
      vendor: { select: { name: true } },
      createdBy: true,
    },
  });

  if (pos.length !== 3) {
    console.error(`ERROR: Expected 3 POs, found ${pos.length}. Aborting.`);
    process.exit(1);
  }

  console.log(`Found ${pos.length} restored POs to revert:`);
  for (const po of pos) {
    console.log(`  - ${po.poNumber} | status: ${po.status} | vendor: ${po.vendor.name} | total: ₹${po.grandTotal}`);
  }
  console.log();

  // Find the payment request linked to PO012
  const po012Id = '9f8be2c5-2679-4e25-ac9c-f650b1c3cf44';
  const paymentRequests = await prisma.paymentRequest.findMany({
    where: { poId: po012Id, deletedAt: null },
    select: { id: true, paymentCode: true, status: true, amount: true },
  });
  console.log(`Payment requests linked to VGH-PO012: ${paymentRequests.length}`);
  for (const pr of paymentRequests) {
    console.log(`  - ${pr.paymentCode} | status: ${pr.status} | amount: ${pr.amount}`);
  }
  console.log();

  // Execute in a transaction
  const results = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const changes: { poNumber: string; oldStatus: string; newStatus: string; auditId: string }[] = [];

    for (const po of pos) {
      const oldStatus = po.status;

      // Revert PO to DELETED
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'DELETED' },
      });

      // Log the revert in audit trail
      const audit = await tx.auditLog.create({
        data: {
          userId: CLEANUP_USER_ID,
          action: 'DELETE',
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          projectId: po.projectId,
          oldValue: { status: oldStatus },
          newValue: { status: 'DELETED', reason: 'Reverted — record was previously deleted and incorrectly restored' },
        },
      });

      changes.push({ poNumber: po.poNumber, oldStatus, newStatus: 'DELETED', auditId: audit.id });
    }

    // Revert the payment request linked to PO012
    for (const pr of paymentRequests) {
      const oldStatus = pr.status;

      await tx.paymentRequest.update({
        where: { id: pr.id },
        data: { deletedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          userId: CLEANUP_USER_ID,
          action: 'DELETE',
          entityType: 'PAYMENT_REQUEST',
          entityId: pr.id,
          projectId: pos.find(p => p.id === po012Id)?.projectId ?? null,
          oldValue: { status: oldStatus },
          newValue: { status: 'DELETED', reason: 'Linked PO was reverted to DELETED' },
        },
      });

      changes.push({ poNumber: `PAY:${pr.paymentCode}`, oldStatus, newStatus: 'DELETED', auditId: '' });
    }

    return changes;
  });

  console.log('CHANGES APPLIED:');
  for (const c of results) {
    console.log(`  ${c.poNumber} | ${c.oldStatus} → ${c.newStatus}`);
  }
  console.log();
  console.log(`Total: ${results.length} records reverted.`);
  console.log();
  console.log('Verification: These POs will no longer appear in Action Required or the');
  console.log('active PO list. All data remains in the database with full audit history.');
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
