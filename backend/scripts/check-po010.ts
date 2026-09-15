import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const po = await prisma.purchaseOrder.findFirst({
    where: { poNumber: 'VGH-PO010' },
    include: {
      vendor: { select: { name: true } },
      project: { select: { name: true } },
      createdByUser: { select: { name: true } },
      approvalWorkflow: { include: { steps: true } },
      items: true,
      invoices: { select: { id: true, invoiceNumber: true, paymentStatus: true } },
      advancePaymentRequests: { select: { id: true, paymentCode: true, status: true } },
      goodsReceipts: { select: { id: true, receiptNumber: true, status: true } },
      gatePasses: { select: { id: true, passNumber: true, status: true } },
    },
  });

  if (!po) {
    console.log('VGH-PO010 not found');
    return;
  }

  console.log('VGH-PO010:');
  console.log(`  ID: ${po.id}`);
  console.log(`  Status: ${po.status}`);
  console.log(`  Vendor: ${po.vendor.name}`);
  console.log(`  Project: ${po.project.name}`);
  console.log(`  Created By: ${po.createdByUser.name}`);
  console.log(`  Created: ${po.createdAt.toISOString()}`);
  console.log(`  Grand Total: ₹${po.grandTotal}`);
  console.log(`  Items: ${po.items.length}`);
  console.log(`  Invoices: ${po.invoices.length}`);
  console.log(`  Payment Requests: ${po.advancePaymentRequests.length}`);
  console.log(`  Goods Receipts: ${po.goodsReceipts.length}`);
  console.log(`  Gate Passes: ${po.gatePasses.length}`);
  console.log(`  Workflow Status: ${po.approvalWorkflow?.status ?? 'none'}`);

  // Audit history
  const audits = await prisma.auditLog.findMany({
    where: { entityType: 'PURCHASE_ORDER', entityId: po.id },
    include: { user: { select: { name: true } } },
    orderBy: { timestamp: 'asc' },
  });
  console.log(`\n  Audit History (${audits.length}):`);
  for (const a of audits) {
    console.log(`    ${a.timestamp.toISOString()} | ${a.action.padEnd(10)} | by ${a.user?.name ?? 'Unknown'} | ${JSON.stringify(a.newValue)}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
