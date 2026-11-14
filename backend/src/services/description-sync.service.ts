import { prisma } from '../config/prisma';

/**
 * One description per purchase. The Material/Service Request's `description`
 * is the master copy; its quotations (`notes`), purchase orders (`notes`) and
 * the payment requests of those POs (`description`) all carry the same text.
 * Editing it on any of them updates the whole chain, so nobody sees two
 * different descriptions for the same purchase.
 */

type Db = Pick<typeof prisma, 'materialPurchaseRequest' | 'quotation' | 'purchaseOrder' | 'paymentRequest' | 'vendorInvoice'>;

const clean = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
};

/** The request a quotation / PO belongs to (PO: directly, else through its quotation). */
export async function resolveMprId(
  ref: { mprId?: string | null; quotationId?: string | null; poId?: string | null },
  db: Db = prisma,
): Promise<string | null> {
  if (ref.mprId) return ref.mprId;
  if (ref.quotationId) {
    const q = await db.quotation.findUnique({ where: { id: ref.quotationId }, select: { mprId: true } });
    if (q?.mprId) return q.mprId;
  }
  if (ref.poId) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: ref.poId },
      select: { mprId: true, quotation: { select: { mprId: true } } },
    });
    return po?.mprId ?? po?.quotation?.mprId ?? null;
  }
  return null;
}

/** The description to show for a request, quotation or PO chain (request wins). */
export async function chainDescription(
  ref: { mprId?: string | null; quotationId?: string | null; poId?: string | null },
  db: Db = prisma,
): Promise<string | null> {
  const mprId = await resolveMprId(ref, db);
  if (!mprId) return null;
  const mpr = await db.materialPurchaseRequest.findUnique({ where: { id: mprId }, select: { description: true } });
  return clean(mpr?.description);
}

/** Write `text` as the description of the request and every record raised from it. */
export async function syncChainDescription(
  ref: { mprId?: string | null; quotationId?: string | null; poId?: string | null },
  text: string | null | undefined,
  db: Db = prisma,
): Promise<void> {
  const mprId = await resolveMprId(ref, db);
  if (!mprId) return;
  const value = clean(text);

  await db.materialPurchaseRequest.update({ where: { id: mprId }, data: { description: value } });
  await db.quotation.updateMany({ where: { mprId }, data: { notes: value } });

  const quotations = await db.quotation.findMany({ where: { mprId }, select: { id: true } });
  const quotationIds = quotations.map((q) => q.id);
  const pos = await db.purchaseOrder.findMany({
    where: { OR: [{ mprId }, ...(quotationIds.length ? [{ quotationId: { in: quotationIds } }] : [])] },
    select: { id: true },
  });
  const poIds = pos.map((p) => p.id);
  if (poIds.length === 0) return;
  await db.purchaseOrder.updateMany({ where: { id: { in: poIds } }, data: { notes: value } });

  const invoices = await db.vendorInvoice.findMany({ where: { poId: { in: poIds } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);
  await db.paymentRequest.updateMany({
    where: {
      type: { in: ['INVOICE', 'ADVANCE'] },
      OR: [{ poId: { in: poIds } }, ...(invoiceIds.length ? [{ invoiceId: { in: invoiceIds } }] : [])],
    },
    data: { description: value },
  });
}
