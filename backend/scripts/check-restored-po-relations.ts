/**
 * READ-ONLY: Check related records for the 3 restored POs before cleanup.
 * Verifies no invoices, payment requests, goods receipts, or other records
 * would be orphaned by reverting these POs to DELETED status.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RESTORED_PO_IDS = [
  '96067622-34ad-4398-b383-323ae0aa7d70', // VGH-PO003
  '36792ab5-6fff-40a4-a168-ddfa95b9d1e6', // VGH-PO011
  '9f8be2c5-2679-4e25-ac9c-f650b1c3cf44', // VGH-PO012
];

async function main() {
  for (const poId of RESTORED_PO_IDS) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { poNumber: true, status: true, projectId: true },
    });
    console.log(`\n${'='.repeat(70)}`);
    console.log(`PO: ${po?.poNumber} (status: ${po?.status})`);
    console.log('='.repeat(70));

    // Check PO items
    const items = await prisma.pOItem.count({ where: { poId } });
    console.log(`  PO Items: ${items}`);

    // Check vendor invoices linked to this PO
    const invoices = await prisma.vendorInvoice.findMany({
      where: { poId },
      select: { id: true, invoiceNumber: true, paymentStatus: true, verificationStatus: true },
    });
    console.log(`  Vendor Invoices: ${invoices.length}`);
    for (const inv of invoices) {
      console.log(`    - ${inv.invoiceNumber} | payment: ${inv.paymentStatus} | verification: ${inv.verificationStatus}`);
    }

    // Check payment requests linked to this PO
    const payments = await prisma.paymentRequest.findMany({
      where: { poId },
      select: { id: true, paymentCode: true, status: true, amount: true },
    });
    console.log(`  Payment Requests: ${payments.length}`);
    for (const p of payments) {
      console.log(`    - ${p.paymentCode} | status: ${p.status} | amount: ${p.amount}`);
    }

    // Check goods receipts
    const receipts = await prisma.goodsReceipt.findMany({
      where: { poId },
      select: { id: true, receiptNumber: true, status: true },
    });
    console.log(`  Goods Receipts: ${receipts.length}`);
    for (const gr of receipts) {
      console.log(`    - ${gr.receiptNumber} | status: ${gr.status}`);
    }

    // Check gate passes
    const gatePasses = await prisma.gatePass.findMany({
      where: { poId },
      select: { id: true, passNumber: true, status: true },
    });
    console.log(`  Gate Passes: ${gatePasses.length}`);
    for (const gp of gatePasses) {
      console.log(`    - ${gp.passNumber} | status: ${gp.status}`);
    }

    // Check work tasks
    const tasks = await prisma.workTask.count({ where: { linkedPoId: poId } });
    console.log(`  Work Tasks: ${tasks}`);

    // Check assets
    const assets = await prisma.asset.count({ where: { poId } });
    console.log(`  Assets: ${assets}`);

    // Check payment sheets
    const sheets = await prisma.paymentSheet.count({ where: { poId } });
    console.log(`  Payment Sheets: ${sheets}`);

    // Check child POs (regenerated)
    const childPos = await prisma.purchaseOrder.count({ where: { parentPoId: poId } });
    console.log(`  Child POs (regenerated): ${childPos}`);

    // Check attachments
    const attachments = await prisma.attachment.count({ where: { entityType: 'PURCHASE_ORDER', entityId: poId } });
    console.log(`  Attachments: ${attachments}`);
  }

  // Also check if there are any other POs with same poNumbers (duplicates)
  console.log(`\n${'='.repeat(70)}`);
  console.log('DUPLICATE PO NUMBER CHECK');
  console.log('='.repeat(70));
  for (const poNum of ['VGH-PO003', 'VGH-PO011', 'VGH-PO012']) {
    const matches = await prisma.purchaseOrder.findMany({
      where: { poNumber: poNum },
      select: { id: true, poNumber: true, status: true, createdAt: true, deletedAt: true },
    });
    console.log(`\n${poNum}: ${matches.length} record(s)`);
    for (const m of matches) {
      console.log(`  - ID: ${m.id} | status: ${m.status} | created: ${m.createdAt.toISOString()} | deletedAt: ${m.deletedAt?.toISOString() ?? 'null'}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
