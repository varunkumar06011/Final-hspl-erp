import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 1. Quotations that would appear in Action Required but are "deleted"
  const deletedQ = await prisma.quotation.findMany({
    where: {
      OR: [{ status: 'DELETED' }, { quotationNumber: { contains: 'DEL' } }],
    },
    select: { quotationNumber: true, status: true, deletedAt: true },
  });
  console.log('Deleted-ish quotations:', JSON.stringify(deletedQ, null, 2));

  // 2. POs deleted
  const deletedPO = await prisma.purchaseOrder.findMany({
    where: { OR: [{ status: 'DELETED' }, { deletedAt: { not: null } }] },
    select: { poNumber: true, status: true, deletedAt: true },
  });
  console.log('Deleted-ish POs:', JSON.stringify(deletedPO, null, 2));

  // 3. Payment requests deleted
  const deletedPR = await prisma.paymentRequest.findMany({
    where: { OR: [{ status: 'DELETED' }, { deletedAt: { not: null } }] },
    select: { paymentCode: true, status: true, deletedAt: true },
  });
  console.log('Deleted-ish payment requests:', JSON.stringify(deletedPR, null, 2));

  // 4. Invoices deleted
  const deletedInv = await prisma.vendorInvoice.findMany({
    where: { deletedAt: { not: null } },
    select: { invoiceNumber: true, verificationStatus: true, deletedAt: true },
  });
  console.log('Deleted invoices:', JSON.stringify(deletedInv, null, 2));

  // 5. Would any of these actually leak into Action Required?
  const project = await prisma.project.findFirst({ where: { name: { contains: 'Grand' } } });
  const actionQ = await prisma.quotation.findMany({
    where: {
      projectId: project!.id,
      deletedAt: null,
      status: { notIn: ['APPROVED', 'REJECTED', 'CONVERTED_TO_PO', 'DELETED'] },
      approvalWorkflow: { steps: { none: { status: 'REJECTED' } } },
    },
    select: { quotationNumber: true, status: true },
  });
  console.log(`\nAction-required quotations (${actionQ.length}):`, JSON.stringify(actionQ));

  const actionPO = await prisma.purchaseOrder.findMany({
    where: {
      projectId: project!.id,
      deletedAt: null,
      status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELETED'] },
    },
    select: { poNumber: true, status: true },
  });
  console.log(`Action-required POs (${actionPO.length}):`, JSON.stringify(actionPO));

  const actionPR = await prisma.paymentRequest.findMany({
    where: { projectId: project!.id, deletedAt: null, status: { notIn: ['APPROVED', 'REJECTED', 'PAID'] } },
    select: { paymentCode: true, status: true },
  });
  console.log(`Action-required payment requests (${actionPR.length}):`, JSON.stringify(actionPR));

  await prisma.$disconnect();
})().catch((e) => { console.error(e); prisma.$disconnect(); });
