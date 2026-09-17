import { prisma } from '../src/config/prisma';

const DELETED_PO_NUMBERS = ['VGH-PO019', 'VGH-PO020', 'VGH-PO021'];
const DELETED_PO_IDS = [
  'd3d69264-1350-46c2-9056-67104dfc7ae1',
  '08aaff72-86c1-46a3-8869-7e8e2c34359a',
  '465a014e-cbfd-498c-9e28-1f4d80466749',
];

async function main() {
  // PO creation audit logs carry quotationId in newValue
  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: 'PURCHASE_ORDER',
      entityId: { in: DELETED_PO_IDS },
    },
    select: { action: true, entityId: true, newValue: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  });
  const quotationIds = new Set<string>();
  for (const l of logs) {
    const nv = l.newValue as Record<string, unknown> | null;
    const qid = nv?.quotationId as string | undefined;
    console.log(`${l.action} po=${l.entityId.slice(0, 8)} poNumber=${nv?.poNumber} quotationId=${qid ?? 'none'}`);
    if (qid) quotationIds.add(qid);
  }

  // also: any quotation still pointing at a deleted PO id via purchaseOrders backlink? (quotationId lives on PO, so check quotation status fields)
  for (const qid of quotationIds) {
    const q = await prisma.quotation.findUnique({
      where: { id: qid },
      select: { id: true, quotationNumber: true, status: true, deletedAt: true, vendorId: true, grandTotal: true },
    });
    console.log(`\nquotation ${qid}: ${q?.quotationNumber} status=${q?.status} deletedAt=${q?.deletedAt ?? 'null'} total=${q?.grandTotal}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
