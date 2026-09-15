/**
 * Revert VGH-PO010 to DELETED status.
 * Payment request VGH-PAY007 is already soft-deleted.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PO_ID = 'f4842cfe-415b-42f9-bb92-974aa2ac524d';
const CLEANUP_USER_ID = 'df62f7a2-325f-441e-89f3-11f4da29d9dc'; // Kaushal Sir (ADMIN)

async function main() {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: PO_ID },
    select: { id: true, poNumber: true, status: true, projectId: true },
  });

  if (!po) {
    console.log('VGH-PO010 not found');
    return;
  }

  console.log(`Reverting ${po.poNumber} (status: ${po.status} → DELETED)`);

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: PO_ID },
      data: { status: 'DELETED' },
    });

    await tx.auditLog.create({
      data: {
        userId: CLEANUP_USER_ID,
        action: 'DELETE',
        entityType: 'PURCHASE_ORDER',
        entityId: PO_ID,
        projectId: po.projectId,
        oldValue: { status: po.status },
        newValue: { status: 'DELETED', reason: 'Manually deactivated — record not needed' },
      },
    });
  });

  console.log('Done. VGH-PO010 is now DELETED.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
