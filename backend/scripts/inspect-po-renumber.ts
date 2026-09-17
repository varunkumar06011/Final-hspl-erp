import { prisma } from '../src/config/prisma';

const NUMBERS = ['VGH-PO019', 'VGH-PO020', 'VGH-PO021', 'VGH-PO022', 'VGH-PO023', 'VGH-PO024'];

async function main() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: NUMBERS } },
    include: {
      items: { select: { id: true } },
      invoices: { select: { id: true } },
      gatePasses: { select: { id: true } },
      goodsReceipts: { select: { id: true } },
      workTasks: { select: { id: true } },
      assets: { select: { id: true } },
      paymentSheets: { select: { id: true, status: true, deletedAt: true } },
      advancePaymentRequests: { select: { id: true, status: true, deletedAt: true } },
      childPos: { select: { id: true, poNumber: true } },
      approvalWorkflow: { select: { id: true, status: true } },
    },
  });

  for (const po of pos.sort((a, b) => a.poNumber.localeCompare(b.poNumber))) {
    console.log(`\n=== ${po.poNumber} ===`);
    console.log(`  id=${po.id} status=${po.status} deletedAt=${po.deletedAt ?? 'null'} regen#=${po.regenerationNumber} parentPoId=${po.parentPoId ?? 'null'}`);
    console.log(`  grandTotal=${po.grandTotal} vendor=${po.vendorId} created=${po.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  items=${po.items.length} invoices=${po.invoices.length} gatePasses=${po.gatePasses.length} GRs=${po.goodsReceipts.length} tasks=${po.workTasks.length} assets=${po.assets.length}`);
    console.log(`  sheets=${po.paymentSheets.length} advRequests=${po.advancePaymentRequests.length} childPOs=${po.childPos.map(c => c.poNumber).join(',') || 'none'} workflow=${po.approvalWorkflow ? po.approvalWorkflow.id + ':' + po.approvalWorkflow.status : 'none'}`);
    // payment requests linked via invoice or directly
    const prs = await prisma.paymentRequest.count({ where: { poId: po.id, deletedAt: null } });
    console.log(`  paymentRequests(poId)=${prs}`);
  }

  // check for gaps: which numbers exist 019..024?
  console.log('\nExisting PO numbers PO019..PO024 range:');
  const all = await prisma.purchaseOrder.findMany({
    where: { poNumber: { startsWith: 'VGH-PO02' }, deletedAt: null },
    select: { poNumber: true, status: true },
    orderBy: { poNumber: 'asc' },
  });
  console.log(all.map((p) => `${p.poNumber}(${p.status})`).join(' '));

  // any textual references to the numbers (notes/descriptions/audit/voucher text)?
  for (const n of NUMBERS) {
    const audits = await prisma.auditLog.count({ where: { OR: [{ oldValue: { string_contains: n } }, { newValue: { string_contains: n } }] } });
    const vouch = await prisma.journalVoucher.count({ where: { description: { contains: n } } });
    const reqs = await prisma.paymentRequest.count({ where: { description: { contains: n } } });
    const sheets = await prisma.paymentSheet.count({ where: { OR: [{ notes: { contains: n } }, { reference: { contains: n } }] } });
    console.log(`refs to ${n}: audit=${audits} voucherDesc=${vouch} payReqDesc=${reqs} sheetText=${sheets}`);
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
