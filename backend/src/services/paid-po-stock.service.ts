/**
 * Paid PO → stock. When a payment against an approved PO is recorded as PAID
 * (payment page, voucher entry, link-voucher), whatever the PO still has to
 * receive goes into inventory at once: an automatic goods receipt is raised
 * already POSTED for the outstanding quantity of every PO line and posted
 * through the same code as a manual receipt (IN transactions, assets, PO
 * delivery status, accounting). Quantities already received, or sitting in an
 * open receipt, are not counted twice, and a later manual receipt has nothing
 * left to receive. Stock used at site is then issued out of inventory (OUT).
 *
 * Runs after the payment is saved and never fails it: errors are logged only.
 */
import { GoodsReceiptStatus, InventoryItemType, AuditAction, GatePassStatus, isUmbrellaContract } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { logAudit } from './audit.service';
import { notifyAllHeads } from './push.service';
import { findInventoryItemForMaterial } from './inventory-match.service';
import {
  generateReceiptNumber,
  postReceiptLinesToStock,
  receiptPostInclude,
  receivedByPo,
  serviceItemIdsFor,
} from '../routes/goods-receipt.routes';

const RECEIVABLE_PO = ['APPROVED', 'PARTIALLY_DELIVERED'];

/** POs behind these paid requests (directly, or through the paid invoice). */
async function posForPayments(projectId: string, paymentRequestIds: string[]): Promise<string[]> {
  const requests = await prisma.paymentRequest.findMany({
    where: { id: { in: paymentRequestIds }, projectId, status: 'PAID' },
    select: { poId: true, invoice: { select: { poId: true } } },
  });
  return [...new Set(requests.map((r) => r.poId ?? r.invoice?.poId).filter((id): id is string => !!id))];
}

/**
 * Receives what is still outstanding on one PO into inventory. Returns the new
 * receipt number, or null when there was nothing to receive.
 */
export async function receivePoIntoStock(projectId: string, poId: string, actor: { id: string; name: string }): Promise<string | null> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, projectId, deletedAt: null },
    select: { id: true, poNumber: true, status: true, isContract: true, grandTotal: true },
  });
  if (!po || !RECEIVABLE_PO.includes(po.status) || isUmbrellaContract(po)) return null;

  const receiptNumber = await generateReceiptNumber(projectId);

  const receiptId = await prisma.$transaction(
    async (tx) => {
      // One receiver per PO at a time: two payments marked paid together must not both receive it.
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${po.id}::uuid FOR UPDATE`;
      const fresh = await tx.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true, items: true } });
      if (!fresh || !RECEIVABLE_PO.includes(fresh.status)) return null;

      const { accepted, pending } = await receivedByPo(po.id, tx);
      const lines: Array<{ poItemId: string; materialName: string; itemId: string | null; specification: string | null; unit: string | null; qty: number; itemType: string }> = [];
      for (const item of fresh.items) {
        const name = item.materialName.toLowerCase();
        const already = (accepted.get(item.id) ?? accepted.get(name) ?? 0) + (pending.get(item.id) ?? pending.get(name) ?? 0);
        const qty = Math.round((Number(item.quantity) - already) * 100) / 100;
        if (qty <= 0) continue;
        // Keep the type the material already has in stock (an asset stays an asset).
        const existing = await findInventoryItemForMaterial(tx, projectId, item.materialName, { itemId: item.itemId, specification: item.specification });
        lines.push({
          poItemId: item.id,
          materialName: item.materialName,
          itemId: item.itemId,
          specification: item.specification,
          unit: item.unit,
          qty,
          itemType: existing?.itemType ?? InventoryItemType.CONSUMABLE,
        });
      }
      if (lines.length === 0) return null;

      const now = new Date();
      const created = await tx.goodsReceipt.create({
        data: {
          projectId,
          poId: po.id,
          receiptNumber,
          status: GoodsReceiptStatus.POSTED,
          createdBy: actor.id,
          postedBy: actor.id,
          postedAt: now,
          items: {
            create: lines.map((l) => ({
              poItemId: l.poItemId,
              materialName: l.materialName,
              itemId: l.itemId,
              specification: l.specification,
              unit: l.unit,
              deliveredQty: l.qty,
              acceptedQty: l.qty,
              itemType: l.itemType,
            })),
          },
        },
        select: { id: true },
      });
      const receipt = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: created.id }, include: receiptPostInclude });
      await postReceiptLinesToStock(tx, receipt, projectId, actor, await serviceItemIdsFor(receipt, tx));

      // Fully received: open gate passes of this PO with no receipt are no longer in transit.
      const after = await tx.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
      if (after?.status === 'DELIVERED') {
        await tx.gatePass.updateMany({
          where: { poId: po.id, projectId, deletedAt: null, status: GatePassStatus.APPROVED, goodsReceipts: { none: {} } },
          data: { status: GatePassStatus.DELIVERED },
        });
      }
      return created.id;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  if (!receiptId) return null;

  await logAudit({
    userId: actor.id,
    action: AuditAction.CREATE,
    entityType: 'GOODS_RECEIPT',
    entityId: receiptId,
    projectId,
    newValue: { receiptNumber, poId: po.id, status: GoodsReceiptStatus.POSTED, auto: 'PO_PAID' },
  });
  notifyAllHeads(projectId, {
    entityType: 'GOODS_RECEIPT',
    entityId: receiptId,
    title: 'Stock received',
    body: `${po.poNumber} is paid: its materials were added to inventory (${receiptNumber})`,
    url: '/inventory',
  }).catch((err) => console.error('[Push] Paid PO stock notification error:', err));
  return receiptNumber;
}

/** For every PO behind these paid requests, receive what is outstanding. Never throws. */
export async function receivePaidPoStock(projectId: string, paymentRequestIds: string[], actorId: string): Promise<void> {
  try {
    const poIds = await posForPayments(projectId, paymentRequestIds);
    if (poIds.length === 0) return;
    const user = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, name: true } });
    const actor = { id: actorId, name: user?.name ?? 'System' };
    for (const poId of poIds) {
      try {
        await receivePoIntoStock(projectId, poId, actor);
      } catch (err) {
        console.error(`[Stock] Could not add paid PO ${poId} to inventory:`, err);
      }
    }
  } catch (err) {
    console.error('[Stock] Paid PO stock update failed:', err);
  }
}
