import { prisma } from '../src/config/prisma';

async function main() {
  const vendor = await prisma.vendor.findFirst({ where: { deletedAt: null }, select: { id: true, name: true, projectId: true } });
  if (!vendor) { console.log('no vendor in DB'); return; }
  const projectId = vendor.projectId;
  console.log('Vendor:', vendor.name);

  const [quotations, purchaseOrders, invoices, paymentRequests, paymentSheets, goodsReceipts, assets, billSettlements, vendorLedger] = await Promise.all([
    prisma.quotation.findMany({ where: { vendorId: vendor.id, projectId, deletedAt: null }, select: { id: true, items: { select: { materialName: true } } } }),
    prisma.purchaseOrder.findMany({ where: { vendorId: vendor.id, projectId, deletedAt: null }, select: { id: true, poNumber: true, items: { select: { materialName: true } } } }),
    prisma.vendorInvoice.findMany({ where: { vendorId: vendor.id, projectId, deletedAt: null }, select: { id: true, totalAmount: true } }),
    prisma.paymentRequest.findMany({ where: { vendorId: vendor.id, projectId, deletedAt: null }, select: { id: true, status: true, type: true, amount: true, invoice: { select: { id: true } }, payments: { select: { amount: true } } } }),
    prisma.paymentSheet.findMany({ where: { projectId, deletedAt: null, purchaseOrder: { vendorId: vendor.id } }, select: { id: true, status: true, amount: true } }),
    prisma.goodsReceipt.findMany({ where: { projectId, deletedAt: null, purchaseOrder: { vendorId: vendor.id } }, select: { id: true, receiptNumber: true } }),
    prisma.asset.findMany({ where: { vendorId: vendor.id, projectId }, select: { id: true, assetId: true } }),
    prisma.billSettlement.findMany({ where: { vendorId: vendor.id, projectId }, select: { id: true } }),
    prisma.ledger.findFirst({ where: { linkedEntityType: 'VENDOR', linkedEntityId: vendor.id, projectId, deletedAt: null }, select: { currentBalance: true } }),
  ]);

  const paidInv = paymentRequests.filter((p) => p.invoice && p.status === 'PAID');
  const paidAdv = paymentRequests.filter((p) => p.type === 'ADVANCE' && p.status === 'PAID');
  console.log('counts:', {
    quotations: quotations.length, pos: purchaseOrders.length, invoices: invoices.length,
    payReqs: paymentRequests.length, sheets: paymentSheets.length, grs: goodsReceipts.length,
    assets: assets.length, settlements: billSettlements.length,
  });
  console.log('billed:', invoices.reduce((s, i) => s + Number(i.totalAmount), 0));
  console.log('paid:', paidInv.reduce((s, p) => s + Number(p.amount), 0) + paidAdv.reduce((s, p) => s + Number(p.amount), 0));
  console.log('sheetPaid:', paymentSheets.filter((p) => p.status !== 'PENDING').reduce((s, p) => s + Number(p.amount), 0));
  console.log('ledgerBalance:', vendorLedger?.currentBalance?.toString() ?? 'none');
  console.log('OK');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
