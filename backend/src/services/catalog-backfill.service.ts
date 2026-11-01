import { CatalogItemKind, catalogNameKey } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { findCatalogItemByName, resolveCatalogLines } from './catalog.service';

/**
 * Fills the item catalog from what was entered before it existed, and links every old
 * line to it. Runs at start-up; idempotent (only lines with no item link are touched),
 * so it also catches lines written by anything that bypassed the resolver.
 *
 * Request lines define the items (their request type decides material vs service, their
 * old per-project code is kept as the catalog code when free: VGH-MAT-0021 -> MAT-0021,
 * their spec text becomes the item's spec). Quotation, PO, gate pass and receipt lines
 * then take the item + spec of the line they were copied from, matched by name in order
 * (the 2nd "Steel" of a quotation is the 2nd "Steel" of its request), so a request with
 * five steel sizes keeps five distinct lines down the chain.
 */

interface SourceLine {
  materialName: string;
  itemId: string | null;
  specification: string | null;
}

interface Linked {
  itemId: string;
  materialName: string;
  specification: string | null;
}

const itemIdByName = new Map<string, string | null>();
async function catalogIdFor(name: string): Promise<string | null> {
  const key = catalogNameKey(name);
  if (!itemIdByName.has(key)) itemIdByName.set(key, (await findCatalogItemByName(prisma, name))?.id ?? null);
  return itemIdByName.get(key) ?? null;
}

/**
 * Per name (or, when the source was renamed to its catalog name, per item), the source lines
 * in order; each target line takes the next one.
 */
function queueByName(sources: SourceLine[]) {
  const byKey = new Map<string, SourceLine[]>();
  const push = (key: string, s: SourceLine) => byKey.set(key, [...(byKey.get(key) ?? []), s]);
  for (const s of sources) {
    if (!s.itemId) continue;
    push(`n:${catalogNameKey(s.materialName)}`, s);
    push(`i:${s.itemId}`, s);
  }
  const used = new Set<SourceLine>();
  const next = (key: string): SourceLine | null => {
    const q = byKey.get(key);
    if (!q || q.length === 0) return null;
    // the last one repeats (extra target lines of the same name)
    return q.find((s) => !used.has(s)) ?? q[q.length - 1];
  };
  return async (name: string): Promise<Linked | null> => {
    let s = next(`n:${catalogNameKey(name)}`);
    if (!s) {
      const id = await catalogIdFor(name);
      if (id) s = next(`i:${id}`);
    }
    if (!s) return null;
    used.add(s);
    return { itemId: s.itemId!, materialName: s.materialName, specification: s.specification };
  };
}

async function byName(name: string, unit?: string | null): Promise<Linked> {
  const existing = await findCatalogItemByName(prisma, name);
  const [line] = await resolveCatalogLines([{ materialName: name, unit, itemId: existing?.id }]);
  return { itemId: line.itemId, materialName: line.materialName, specification: null };
}

export async function backfillCatalog(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  // 1. Request lines: they define the items and their specs.
  const mprLines = await prisma.materialPurchaseRequestItem.findMany({
    where: { itemId: null },
    include: { mpr: { select: { requestType: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const l of mprLines) {
    const kind = l.mpr.requestType === 'SERVICE' ? CatalogItemKind.SERVICE : CatalogItemKind.MATERIAL;
    const [r] = await resolveCatalogLines([{ materialName: l.materialName, materialCode: l.materialCode, unit: l.unit, specification: l.specification }], { kind });
    await prisma.materialPurchaseRequestItem.update({
      where: { id: l.id },
      data: { itemId: r.itemId, materialName: r.materialName, materialCode: r.materialCode, specification: r.specification },
    });
    bump('mprItems');
  }

  // 2. Quotation lines: from their request.
  const quotations = await prisma.quotation.findMany({
    where: { items: { some: { itemId: null } } },
    select: { id: true, mpr: { select: { items: { orderBy: { createdAt: 'asc' } } } }, items: { orderBy: { createdAt: 'asc' } } },
  });
  for (const q of quotations) {
    const take = queueByName(q.mpr?.items ?? []);
    for (const l of q.items) {
      if (l.itemId) continue;
      const link = (await take(l.materialName)) ?? (await byName(l.materialName, l.unit));
      await prisma.quotationItem.update({ where: { id: l.id }, data: link });
      bump('quotationItems');
    }
  }

  // 3. PO lines: from the quotation, else the request (non-vendor), else the site bills.
  const pos = await prisma.purchaseOrder.findMany({
    where: { items: { some: { itemId: null } } },
    select: {
      id: true,
      items: { orderBy: { createdAt: 'asc' } },
      quotation: { select: { items: { orderBy: { createdAt: 'asc' } } } },
      mpr: { select: { items: { orderBy: { createdAt: 'asc' } } } },
    },
  });
  for (const po of pos) {
    const bills = await prisma.materialPurchaseRequestItem.findMany({ where: { mpr: { sitePoId: po.id } }, orderBy: { createdAt: 'asc' } });
    const take = queueByName([...(po.quotation?.items ?? []), ...(po.mpr?.items ?? []), ...bills]);
    for (const l of po.items) {
      if (l.itemId) continue;
      const link = (await take(l.materialName)) ?? (await byName(l.materialName, l.unit));
      await prisma.pOItem.update({ where: { id: l.id }, data: link });
      bump('poItems');
    }
  }

  // 4. Gate pass lines: from their PO.
  const passes = await prisma.gatePass.findMany({
    where: { items: { some: { itemId: null } } },
    select: { id: true, items: { orderBy: { createdAt: 'asc' } }, purchaseOrder: { select: { items: { orderBy: { createdAt: 'asc' } } } } },
  });
  for (const gp of passes) {
    const take = queueByName(gp.purchaseOrder?.items ?? []);
    for (const l of gp.items) {
      if (l.itemId) continue;
      const link = (await take(l.materialName)) ?? (await byName(l.materialName, l.unit));
      await prisma.gatePassItem.update({ where: { id: l.id }, data: link });
      bump('gatePassItems');
    }
  }

  // 5. Receipt lines: from the PO line they point at.
  const receiptLines = await prisma.goodsReceiptItem.findMany({ where: { itemId: null }, include: { poItem: true } });
  for (const l of receiptLines) {
    const link = l.poItem?.itemId
      ? { itemId: l.poItem.itemId, materialName: l.poItem.materialName, specification: l.poItem.specification }
      : await byName(l.materialName, l.unit);
    await prisma.goodsReceiptItem.update({ where: { id: l.id }, data: link });
    bump('receiptItems');
  }

  // 6. Direct stock entries.
  const stockLines = await prisma.stockEntryItem.findMany({ where: { itemId: null } });
  for (const l of stockLines) {
    await prisma.stockEntryItem.update({ where: { id: l.id }, data: await byName(l.materialName, l.unit) });
    bump('stockItems');
  }

  // 7. Stock items: linked by name; they keep their own name (it may be "Steel - 12mm").
  const stock = await prisma.inventoryItem.findMany({ where: { catalogItemId: null, deletedAt: null } });
  for (const s of stock) {
    const link = await byName(s.name, s.unit);
    const item = await prisma.catalogItem.findUnique({ where: { id: link.itemId }, select: { code: true } });
    await prisma.inventoryItem.update({ where: { id: s.id }, data: { catalogItemId: link.itemId, materialCode: s.materialCode ? item?.code ?? s.materialCode : item?.code ?? null } });
    bump('inventoryItems');
  }

  return counts;
}

/** Start-up hook: never blocks or crashes the server. CATALOG_BACKFILL=false skips it. */
export function startCatalogBackfill(): void {
  if (process.env.CATALOG_BACKFILL === 'false') return;
  backfillCatalog()
    .then((counts) => {
      if (Object.keys(counts).length) console.log('[Catalog] linked old lines to the item catalog:', counts);
    })
    .catch((error) => console.error('[Catalog] backfill failed:', error));
}
