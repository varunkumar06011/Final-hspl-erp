import { Prisma } from '@prisma/client';
import { CatalogItemKind, catalogNameKey, catalogSpecKey, lineLabel, tidySpec } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { ensureSpec, liveItem, nextCode } from './catalog.service';
import { mergeInventoryItems } from './inventory-match.service';

/**
 * Cleaning up the item catalog: rename, merge, "this item is really a spec of that one".
 * Every line table is rewritten the same way, so documents keep matching each other
 * (request <-> quotation <-> PO <-> gate pass <-> receipt) after a cleanup, and stock
 * items follow their catalog item.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export class CatalogError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type LineTable = 'materialPurchaseRequestItem' | 'quotationItem' | 'pOItem' | 'gatePassItem' | 'goodsReceiptItem' | 'stockEntryItem';
const LINE_TABLES: LineTable[] = ['materialPurchaseRequestItem', 'quotationItem', 'pOItem', 'gatePassItem', 'goodsReceiptItem', 'stockEntryItem'];

interface LineDelegate {
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<Array<{ id: string; specification: string | null }>>;
}
const lines = (db: Db, name: LineTable) => (db as unknown as Record<LineTable, LineDelegate>)[name];

async function rewriteLines(
  db: Db,
  where: Record<string, unknown>,
  data: { itemId?: string; materialName?: string; specification?: string | null; materialCode?: string },
): Promise<number> {
  const { materialCode, ...rest } = data;
  let count = 0;
  for (const name of LINE_TABLES) {
    // Only request lines store the code.
    const row = name === 'materialPurchaseRequestItem' && materialCode ? { ...rest, materialCode } : rest;
    count += (await lines(db, name).updateMany({ where, data: row })).count;
  }
  return count;
}

/** Stock items of a catalog item, relinked and renamed after a cleanup; a name clash merges the two. */
async function relabelInventory(fromItemId: string, target: { id: string; name: string; code: string }, spec?: string | null) {
  const stock = await prisma.inventoryItem.findMany({ where: { catalogItemId: fromItemId, deletedAt: null } });
  for (const s of stock) {
    const specification = spec === undefined ? s.specification : spec;
    const name = lineLabel({ materialName: target.name, specification });
    const clash = await prisma.inventoryItem.findFirst({
      where: { projectId: s.projectId, deletedAt: null, id: { not: s.id }, name: { equals: name, mode: 'insensitive' } },
    });
    if (clash && clash.itemType === s.itemType) {
      await mergeInventoryItems(s.projectId, s.id, clash.id);
      await prisma.inventoryItem.update({ where: { id: clash.id }, data: { catalogItemId: target.id, specification, materialCode: target.code } });
    } else {
      await prisma.inventoryItem.update({
        where: { id: s.id },
        data: { catalogItemId: target.id, specification, materialCode: target.code, ...(clash ? {} : { name }) },
      });
    }
  }
}

export async function renameCatalogItem(
  id: string,
  input: { name?: string; unit?: string | null; category?: string | null; kind?: CatalogItemKind },
) {
  const item = await prisma.catalogItem.findUnique({ where: { id } });
  if (!item || !item.isActive) throw new CatalogError('Item not found', 404);
  const name = input.name?.trim().replace(/\s+/g, ' ') || item.name;
  const nameKey = catalogNameKey(name);
  const kind = input.kind ?? (item.kind as CatalogItemKind);
  if (!nameKey) throw new CatalogError('Enter a name');
  if (nameKey !== item.nameKey || kind !== item.kind) {
    const clash = await prisma.catalogItem.findFirst({
      where: { id: { not: id }, isActive: true, kind, OR: [{ nameKey }, { aliases: { has: nameKey } }] },
    });
    if (clash) throw new CatalogError(`"${clash.name}" (${clash.code}) already exists. Merge into it instead.`, 409);
  }
  const aliases = new Set(item.aliases);
  if (nameKey !== item.nameKey) aliases.add(item.nameKey);
  aliases.delete(nameKey);
  const code = kind !== item.kind ? await nextCode(prisma, kind) : item.code;
  const updated = await prisma.catalogItem.update({
    where: { id },
    data: {
      name,
      nameKey,
      kind,
      code,
      aliases: Array.from(aliases),
      ...(input.unit !== undefined ? { unit: input.unit?.trim() || null } : {}),
      ...(input.category !== undefined ? { category: input.category?.trim() || null } : {}),
    },
    include: { specs: { orderBy: { value: 'asc' } } },
  });
  if (name !== item.name || code !== item.code) {
    await rewriteLines(prisma, { itemId: id }, { materialName: name, materialCode: code });
    await relabelInventory(id, { id, name, code });
  }
  return updated;
}

/**
 * Folds `sourceId` into `targetId`. With `asSpec`, the source was really a specification
 * of the target ("160/6 ISI" -> PVC Pipe, spec "160mm 6kg ISI"): its lines take that spec.
 * Without it, the source's specs move to the target and lines keep theirs.
 */
export async function mergeCatalogItems(sourceId: string, targetId: string, opts: { asSpec?: string | null; userId?: string | null } = {}) {
  if (sourceId === targetId) throw new CatalogError('Pick two different items');
  const asSpec = tidySpec(opts.asSpec);
  const result = await prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.catalogItem.findUnique({ where: { id: sourceId }, include: { specs: true } }),
      tx.catalogItem.findUnique({ where: { id: targetId }, include: { specs: true } }),
    ]);
    if (!source?.isActive || !target?.isActive) throw new CatalogError('Item not found', 404);

    let spec: string | null = null;
    if (asSpec) spec = await ensureSpec(tx, target, asSpec, opts.userId);
    else for (const s of source.specs) await ensureSpec(tx, target, s.value, opts.userId);

    const aliases = new Set([...target.aliases, ...source.aliases, source.nameKey]);
    aliases.delete(target.nameKey);
    await tx.catalogItem.update({ where: { id: target.id }, data: { aliases: Array.from(aliases), unit: target.unit ?? source.unit } });
    // The retired row frees its name (unique per kind) but remembers where it went.
    await tx.catalogItem.update({
      where: { id: source.id },
      data: { isActive: false, mergedIntoId: target.id, nameKey: `${source.nameKey}#${source.id}`, aliases: [] },
    });
    const moved = await rewriteLines(
      tx,
      { itemId: source.id },
      { itemId: target.id, materialName: target.name, materialCode: target.code, ...(asSpec ? { specification: spec } : {}) },
    );
    return { source, target, spec, moved };
  });
  await relabelInventory(sourceId, result.target, asSpec ? result.spec : undefined);
  return {
    target: await prisma.catalogItem.findUnique({ where: { id: targetId }, include: { specs: { orderBy: { value: 'asc' } } } }),
    summary: {
      sourceName: result.source.name,
      sourceCode: result.source.code,
      targetName: result.target.name,
      targetCode: result.target.code,
      asSpec: result.spec,
      linesMoved: result.moved,
    },
  };
}

export async function addCatalogSpec(itemId: string, value: string, userId?: string | null) {
  const item = await liveItem(prisma, itemId);
  if (!item?.isActive) throw new CatalogError('Item not found', 404);
  const spec = await ensureSpec(prisma, item, value, userId);
  if (!spec) throw new CatalogError('Enter a specification');
  return prisma.catalogItemSpec.findUnique({ where: { itemId_valueKey: { itemId: item.id, valueKey: catalogSpecKey(spec) } } });
}

/** Renames a spec in the item's list and on every line (and stock item) that carries it. */
export async function renameCatalogSpec(specId: string, value: string) {
  const spec = await prisma.catalogItemSpec.findUnique({ where: { id: specId } });
  if (!spec) throw new CatalogError('Specification not found', 404);
  const tidy = tidySpec(value);
  const valueKey = catalogSpecKey(tidy);
  if (!tidy || !valueKey) throw new CatalogError('Enter a specification');
  if (valueKey !== spec.valueKey) {
    const clash = await prisma.catalogItemSpec.findUnique({ where: { itemId_valueKey: { itemId: spec.itemId, valueKey } } });
    if (clash) throw new CatalogError(`"${clash.value}" is already in the list`, 409);
  }
  const updated = await prisma.catalogItemSpec.update({ where: { id: specId }, data: { value: tidy, valueKey } });
  // Lines store the spec text; rewrite those that carried the old one (in any spelling).
  for (const name of LINE_TABLES) {
    const rows = await lines(prisma, name).findMany({
      where: { itemId: spec.itemId, specification: { not: null } },
      select: { id: true, specification: true },
    });
    const ids = rows.filter((r) => catalogSpecKey(r.specification) === spec.valueKey).map((r) => r.id);
    if (ids.length) await lines(prisma, name).updateMany({ where: { id: { in: ids } }, data: { specification: tidy } });
  }
  const item = await prisma.catalogItem.findUnique({ where: { id: spec.itemId } });
  const stock = await prisma.inventoryItem.findMany({ where: { catalogItemId: spec.itemId, specification: { not: null }, deletedAt: null } });
  for (const s of stock.filter((r) => catalogSpecKey(r.specification) === spec.valueKey)) {
    const name = lineLabel({ materialName: item?.name ?? s.name, specification: tidy });
    const clash = await prisma.inventoryItem.findFirst({ where: { projectId: s.projectId, deletedAt: null, id: { not: s.id }, name } });
    await prisma.inventoryItem.update({ where: { id: s.id }, data: { specification: tidy, ...(clash ? {} : { name }) } });
  }
  return updated;
}

/** Removes a spec from the item's list; lines that used it keep their text. */
export async function deleteCatalogSpec(specId: string) {
  const spec = await prisma.catalogItemSpec.findUnique({ where: { id: specId } });
  if (!spec) throw new CatalogError('Specification not found', 404);
  await prisma.catalogItemSpec.delete({ where: { id: specId } });
}
