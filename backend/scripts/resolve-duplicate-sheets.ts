import { prisma } from '../src/config/prisma';
import { logAudit } from '../src/services/audit.service';

(async () => {
  // The two superseded PENDING placeholders from 15/09 — the real payments
  // were recorded as new PAID entries on 16/09 (same POs, same amounts)
  const targets = await prisma.paymentSheet.findMany({
    where: {
      status: 'PENDING', deletedAt: null,
      date: { gte: new Date('2026-09-15T00:00:00+05:30'), lt: new Date('2026-09-16T00:00:00+05:30') },
      purchaseOrder: { poNumber: { in: ['VGH-PO004', 'VGH-PO005'] } },
    },
    include: { purchaseOrder: { select: { poNumber: true } } },
  });
  if (targets.length !== 2) { console.log('Expected 2, found', targets.length); process.exit(1); }
  for (const t of targets) {
    console.log(`Deleting ${t.date.toISOString().slice(0,10)} ${t.purchaseOrder.poNumber} ₹${t.amount} status=${t.status} id=${t.id.slice(0,8)}`);
  }
  for (const t of targets) {
    await prisma.paymentSheet.update({ where: { id: t.id }, data: { deletedAt: new Date() } });
    await logAudit({
      userId: t.createdBy,
      action: 'DELETE' as never,
      entityType: 'PAYMENT_SHEET',
      entityId: t.id,
      projectId: t.projectId,
      oldValue: { amount: String(t.amount), status: t.status, date: t.date },
      newValue: { deletedAt: new Date().toISOString(), reason: 'Superseded — actual payment recorded as PAID entry on 16/09' },
    });
    console.log('  → soft-deleted + audited', t.id.slice(0, 8));
  }
  await prisma.$disconnect();
})();
