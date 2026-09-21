import { prisma } from '../src/config/prisma';
import { logAudit } from '../src/services/audit.service';
import { AuditAction, isAdminRole } from '@hospital-erp/shared';

// Restore the three POs hard-deleted by renumber-pos.ts and revert the
// renumbering so the sequence returns to what it would have been:
//   restored originals -> VGH-PO019 / VGH-PO020 / VGH-PO021
//   current 019/020/021 (orig 022/023/024) -> back to VGH-PO022/023/024
//   current 022 (Balaji, created after renumber) -> VGH-PO025
const RENUMBER_BACK: Array<{ from: string; to: string }> = [
  { from: 'VGH-PO022', to: 'VGH-PO025' }, // Balaji Steels (823b13e1) — must move first to free 022
  { from: 'VGH-PO021', to: 'VGH-PO024' }, // Nikhil chowdary (4666a7c8)
  { from: 'VGH-PO020', to: 'VGH-PO023' }, // Steel on Call (a0d73d4c)
  { from: 'VGH-PO019', to: 'VGH-PO022' }, // Lakshmi Anjana Tube well (47022b70)
];
const RESTORE_NUMBERS = ['VGH-PO019', 'VGH-PO020', 'VGH-PO021'];

async function getActiveAdminRoles(projectId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { projectId, isActive: true },
    select: { role: true },
  });
  const adminRoles = users.map((u) => u.role).filter((r) => isAdminRole(r));
  return Array.from(new Set(adminRoles)).sort((a, b) => {
    const na = a === 'ADMIN' ? 1 : parseInt(a.split('_')[1] ?? '0', 10);
    const nb = b === 'ADMIN' ? 1 : parseInt(b.split('_')[1] ?? '0', 10);
    return na - nb;
  });
}

async function main() {
  // ── 1. Recover the deleted PO payloads from the audit trail ──
  const deleteLogs = await prisma.auditLog.findMany({
    where: {
      entityType: 'PURCHASE_ORDER',
      action: 'DELETE',
      newValue: { path: ['reason'], equals: 'Deleted per PO renumbering request' },
    },
    orderBy: { timestamp: 'asc' },
  });
  if (deleteLogs.length !== 3) {
    console.error(`Expected 3 renumber-script DELETE audit rows, found ${deleteLogs.length}`);
    process.exit(1);
  }
  const deletedIds = deleteLogs.map((l) => l.entityId);

  const createLogs = await prisma.auditLog.findMany({
    where: { entityType: 'PURCHASE_ORDER', action: 'CREATE', entityId: { in: deletedIds } },
    orderBy: { timestamp: 'asc' },
  });
  if (createLogs.length !== 3) {
    console.error(`Expected 3 CREATE audit rows for deleted POs, found ${createLogs.length}`);
    process.exit(1);
  }

  // ── 2. Verify current state: 019/020/021/022 held by renumbered POs ──
  const current = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: [...RENUMBER_BACK.map((r) => r.from), 'VGH-PO023', 'VGH-PO024', 'VGH-PO025'] } },
    include: { vendor: { select: { name: true } }, items: true },
  });
  const byNumber = new Map(current.map((po) => [po.poNumber, po]));
  for (const { from } of RENUMBER_BACK) {
    if (!byNumber.has(from)) {
      console.error(`ABORT: expected a PO at ${from} — current state differs`);
      process.exit(1);
    }
  }
  for (const n of ['VGH-PO023', 'VGH-PO024', 'VGH-PO025']) {
    if (byNumber.has(n)) {
      console.error(`ABORT: ${n} already exists — cannot renumber into it`);
      process.exit(1);
    }
  }
  const projectId = byNumber.get(RENUMBER_BACK[0].from)!.projectId;

  // ── 3. Build restore payloads: audit fields + items from source quotations ──
  const restores: Array<{
    id: string; poNumber: string; vendorId: string; quotationId: string;
    totalAmount: number; grandTotal: number; paymentType: string;
    advanceAmount: number | null; createdBy: string; createdAt: Date;
    items: { materialName: string; quantity: number; unit: string | null; unitPrice: number; amount: number; gstRate: number }[];
  }> = [];
  for (const cl of createLogs) {
    const nv = cl.newValue as Record<string, unknown>;
    const quotation = await prisma.quotation.findUnique({
      where: { id: nv.quotationId as string },
      include: { items: true },
    });
    if (!quotation) {
      console.error(`ABORT: quotation ${nv.quotationId} for ${nv.poNumber} not found`);
      process.exit(1);
    }
    restores.push({
      id: cl.entityId,
      poNumber: nv.poNumber as string,
      vendorId: nv.vendorId as string,
      quotationId: nv.quotationId as string,
      totalAmount: Number(nv.totalAmount),
      grandTotal: Number(nv.grandTotal),
      paymentType: nv.paymentType as string,
      advanceAmount: nv.advanceAmount === null || nv.advanceAmount === undefined ? null : Number(nv.advanceAmount),
      createdBy: cl.userId,
      createdAt: cl.timestamp,
      items: quotation.items.map((i) => ({
        materialName: i.materialName,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitPrice: Number(i.unitPrice),
        amount: Number(i.amount),
        gstRate: Number(i.gstRate),
      })),
    });
  }
  restores.sort((a, b) => a.poNumber.localeCompare(b.poNumber));
  for (const r of restores) {
    const exists = await prisma.purchaseOrder.findUnique({ where: { id: r.id } });
    if (exists) {
      console.error(`ABORT: id ${r.id} already exists (${exists.poNumber})`);
      process.exit(1);
    }
  }

  const adminRoles = await getActiveAdminRoles(projectId);

  // ── 4. Transaction: renumber back (safe order), then recreate deleted POs ──
  await prisma.$transaction(async (tx) => {
    for (const { from, to } of RENUMBER_BACK) {
      const po = byNumber.get(from)!;
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { poNumber: to } });
      console.log(`renumbered back ${from} -> ${to} (id=${po.id})`);
    }

    for (const r of restores) {
      const gst = r.items.reduce((s, i) => s + (i.amount * i.gstRate) / 100, 0);
      const po = await tx.purchaseOrder.create({
        data: {
          id: r.id,
          projectId,
          vendorId: r.vendorId,
          quotationId: r.quotationId,
          poNumber: r.poNumber,
          status: 'PENDING_APPROVAL',
          paymentType: r.paymentType,
          advanceAmount: r.advanceAmount,
          totalAmount: r.totalAmount,
          gstAmount: gst,
          grandTotal: r.grandTotal,
          totalDeductions: 0,
          netPayable: r.grandTotal,
          createdBy: r.createdBy,
          date: r.createdAt,
          createdAt: r.createdAt,
          items: { create: r.items },
        },
      });
      const workflow = await tx.approvalWorkflow.create({
        data: {
          entityType: 'PURCHASE_ORDER',
          entityId: po.id,
          projectId,
          status: 'VERIFICATION',
          currentStep: 0,
          minApprovers: 1,
          approvalPolicy: 'PO_SINGLE_APPROVER',
          steps: {
            create: adminRoles.map((role, idx) => ({
              stepNumber: idx + 1,
              approverRole: role,
              status: 'PENDING',
            })),
          },
        },
      });
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { approvalWorkflowId: workflow.id },
      });
      console.log(`restored ${r.poNumber} (id=${po.id}, total=${r.grandTotal}, items=${r.items.length})`);
    }
  });

  // ── 5. Audit trail ──
  for (const { from, to } of RENUMBER_BACK) {
    const po = byNumber.get(from)!;
    await logAudit({
      userId: po.createdBy,
      action: AuditAction.UPDATE,
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      projectId,
      oldValue: { poNumber: from },
      newValue: { poNumber: to, reason: 'PO number revert — restoring original numbering after deleted-PO restore' },
    });
  }
  for (const r of restores) {
    await logAudit({
      userId: r.createdBy,
      action: AuditAction.CREATE,
      entityType: 'PURCHASE_ORDER',
      entityId: r.id,
      projectId,
      newValue: { poNumber: r.poNumber, vendorId: r.vendorId, quotationId: r.quotationId, totalAmount: r.totalAmount, grandTotal: r.grandTotal, paymentType: r.paymentType, restored: true, reason: 'Restored hard-deleted PO from audit trail' },
    });
  }

  // ── 6. Verification ──
  console.log('\n── VERIFY ──');
  const all = await prisma.purchaseOrder.findMany({
    where: { projectId },
    include: { vendor: { select: { name: true } }, items: true, approvalWorkflow: { select: { status: true } } },
    orderBy: { poNumber: 'asc' },
  });
  const numbers = all.map((po) => po.poNumber);
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  console.log(`duplicates: ${dupes.length === 0 ? 'none' : dupes.join(',')}`);
  if (dupes.length) process.exit(1);

  const seq = all.filter((po) => /^VGH-PO\d+$/.test(po.poNumber)).map((po) => parseInt(po.poNumber.slice(6), 10));
  const missing = [];
  for (let i = 1; i <= Math.max(...seq); i++) if (!seq.includes(i)) missing.push(i);
  console.log(`sequence: 001-${String(Math.max(...seq)).padStart(3, '0')} missing=[${missing.join(',') || 'none'}]`);
  if (missing.length) process.exit(1);

  const tail = all.filter((po) => ['VGH-PO019', 'VGH-PO020', 'VGH-PO021', 'VGH-PO022', 'VGH-PO023', 'VGH-PO024', 'VGH-PO025'].includes(po.poNumber));
  for (const po of tail) {
    console.log(`${po.poNumber}: vendor=${po.vendor.name} total=${po.grandTotal} status=${po.status} items=${po.items.length} workflow=${po.approvalWorkflow?.status}`);
  }
  console.log('\nDONE — all checks passed');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
