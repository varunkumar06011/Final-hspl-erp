import { prisma } from '../src/config/prisma';

async function main() {
  // project-wide duplicate check
  const all = await prisma.purchaseOrder.findMany({ select: { projectId: true, poNumber: true } });
  const seen = new Map<string, number>();
  for (const p of all) seen.set(`${p.projectId}|${p.poNumber}`, (seen.get(`${p.projectId}|${p.poNumber}`) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1);
  console.log(`total POs: ${all.length} | duplicate (project,poNumber): ${dupes.length === 0 ? 'NONE' : JSON.stringify(dupes)}`);

  // renumbered POs with full relations — same shape the list endpoint returns
  const pos = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: ['VGH-PO019', 'VGH-PO020', 'VGH-PO021'] } },
    include: {
      vendor: { select: { name: true } },
      items: true,
      approvalWorkflow: { select: { status: true, steps: { select: { stepNumber: true, status: true } } } },
    },
    orderBy: { poNumber: 'asc' },
  });
  for (const p of pos) {
    console.log(`\n${p.poNumber}: status=${p.status} vendor=${p.vendor.name} total=${p.totalAmount} gst=${p.gstAmount} grand=${p.grandTotal} net=${p.netPayable}`);
    console.log(`  items: ${p.items.map((i) => `${i.materialName}(${i.quantity}x${i.unitPrice})`).join(' | ')}`);
    console.log(`  workflow: ${p.approvalWorkflow?.status} steps=[${p.approvalWorkflow?.steps.map((s) => `${s.stepNumber}:${s.status}`).join(',')}]`);
  }

  // orphans: any FK pointing to the three deleted ids?
  const deletedIds = [
    'd3d69264-1350-46c2-9056-67104dfc7ae1',
    '08aaff72-86c1-46a3-8869-7e8e2c34359a',
    '465a014e-cbfd-498c-9e28-1f4d80466749',
  ];
  const [inv, pr, gp, gr, wt, ps, as_, wf] = await Promise.all([
    prisma.vendorInvoice.count({ where: { poId: { in: deletedIds } } }),
    prisma.paymentRequest.count({ where: { poId: { in: deletedIds } } }),
    prisma.gatePass.count({ where: { poId: { in: deletedIds } } }),
    prisma.goodsReceipt.count({ where: { poId: { in: deletedIds } } }),
    prisma.workTask.count({ where: { linkedPoId: { in: deletedIds } } }),
    prisma.paymentSheet.count({ where: { poId: { in: deletedIds } } }),
    prisma.asset.count({ where: { poId: { in: deletedIds } } }),
    prisma.approvalWorkflow.count({ where: { entityType: 'PURCHASE_ORDER', entityId: { in: deletedIds } } }),
  ]);
  console.log(`\norphan refs to deleted PO ids: invoices=${inv} payReq=${pr} gatePass=${gp} goodsRcpt=${gr} tasks=${wt} sheets=${ps} assets=${as_} workflows=${wf}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
