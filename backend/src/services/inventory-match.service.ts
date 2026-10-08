import { Prisma } from '@prisma/client';
import { fuzzyScore } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export const normalizeMaterialName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The project's material code for a material name, taken from the material requests
 * (one material, one code). null when no request ever gave it a code.
 */
export async function materialCodeForName(db: Db, projectId: string, name: string): Promise<string | null> {
  const rows = await db.materialPurchaseRequestItem.findMany({
    where: { materialCode: { not: null }, materialName: { equals: name.trim(), mode: 'insensitive' }, mpr: { projectId, deletedAt: null } },
    select: { materialCode: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
  });
  return rows[0]?.materialCode?.trim() || null;
}

/**
 * The inventory item a received/entered material belongs to, matched by material code first,
 * then by the name or code of a merged duplicate, then by plain name. A match that lacked a
 * code gets it, so later receipts match by code. Returns null when the material is new.
 */
export async function findInventoryItemForMaterial(db: Db, projectId: string, materialName: string) {
  const code = await materialCodeForName(db, projectId, materialName);
  const key = normalizeMaterialName(materialName);
  const live = { projectId, deletedAt: null };

  let item =
    (code ? await db.inventoryItem.findFirst({ where: { ...live, materialCode: { equals: code, mode: 'insensitive' } } }) : null) ??
    (await db.inventoryItem.findFirst({ where: { ...live, aliases: { has: key } } })) ??
    (code ? await db.inventoryItem.findFirst({ where: { ...live, aliases: { has: code.toLowerCase() } } }) : null) ??
    (await db.inventoryItem.findFirst({ where: { ...live, name: { equals: materialName.trim(), mode: 'insensitive' } } }));

  if (item && code && !item.materialCode) {
    item = await db.inventoryItem.update({ where: { id: item.id }, data: { materialCode: code } });
  }
  return item;
}

const numberTokens = (name: string): string => (name.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');

export interface DuplicateCandidate {
  id: string;
  name: string;
  sku: string | null;
  materialCode: string | null;
  unit: string;
  itemType: string;
  category: string | null;
  currentStock: number;
  totalValue: number;
  transactions: number;
}

/**
 * Groups of live inventory items that look like the same material: the same material code,
 * or names that match once spelling mistakes are ignored. Items of different types
 * (consumable / asset) are never grouped.
 */
export async function findDuplicateGroups(projectId: string): Promise<DuplicateCandidate[][]> {
  const items = await prisma.inventoryItem.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true, name: true, sku: true, materialCode: true, unit: true, itemType: true, category: true,
      currentStock: true, totalValue: true, _count: { select: { transactions: true } },
    },
    orderBy: { name: 'asc' },
    take: 3000,
  });

  // Items without a code are looked at through the code their name carries in material requests.
  const codeRows = await prisma.materialPurchaseRequestItem.findMany({
    where: { materialCode: { not: null }, mpr: { projectId, deletedAt: null } },
    select: { materialName: true, materialCode: true },
    orderBy: { createdAt: 'asc' },
  });
  const codeByName = new Map<string, string>();
  for (const r of codeRows) {
    const k = normalizeMaterialName(r.materialName);
    if (r.materialCode && !codeByName.has(k)) codeByName.set(k, r.materialCode.toLowerCase());
  }
  const codeOf = (i: { name: string; materialCode: string | null }) =>
    (i.materialCode ?? codeByName.get(normalizeMaterialName(i.name)) ?? '').toLowerCase();

  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };

  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].itemType !== items[b].itemType) continue;
      const ca = codeOf(items[a]);
      const cb = codeOf(items[b]);
      if (ca && ca === cb) { join(a, b); continue; }
      if (ca && cb && ca !== cb) continue; // two different codes: deliberately different materials
      // Sizes and grades tell materials apart (12mm vs 16mm, grade 43 vs 53): never group those.
      if (numberTokens(items[a].name) !== numberTokens(items[b].name)) continue;
      const score = fuzzyScore(items[a].name, items[b].name);
      const reverse = fuzzyScore(items[b].name, items[a].name);
      if (score !== null && reverse !== null && Math.max(score, reverse) <= 2.4) join(a, b);
    }
  }

  const groups = new Map<number, DuplicateCandidate[]>();
  items.forEach((i, idx) => {
    const g = groups.get(find(idx)) ?? [];
    g.push({
      id: i.id, name: i.name, sku: i.sku, materialCode: i.materialCode ?? (codeByName.get(normalizeMaterialName(i.name))?.toUpperCase() ?? null),
      unit: i.unit, itemType: i.itemType, category: i.category,
      currentStock: Number(i.currentStock), totalValue: Number(i.totalValue), transactions: i._count.transactions,
    });
    groups.set(find(idx), g);
  });
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

/**
 * Folds `source` into `target`: stock history, assets and value move across, the source is
 * retired, and its name/code are remembered as aliases so future receipts land on the target.
 */
export async function mergeInventoryItems(projectId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new Error('Pick two different items to merge');
  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.inventoryItem.findFirst({ where: { id: sourceId, projectId, deletedAt: null } }),
      tx.inventoryItem.findFirst({ where: { id: targetId, projectId, deletedAt: null } }),
    ]);
    if (!source || !target) throw new Error('Inventory item not found');
    if (source.itemType !== target.itemType) {
      throw new Error(`Cannot merge a ${source.itemType.toLowerCase()} into a ${target.itemType.toLowerCase()}`);
    }

    const moved = await tx.inventoryTransaction.updateMany({ where: { itemId: source.id }, data: { itemId: target.id } });
    const assets = await tx.asset.updateMany({ where: { inventoryItemId: source.id }, data: { inventoryItemId: target.id } });

    const stock = Number(target.currentStock) + Number(source.currentStock);
    const value = Number(target.totalValue) + Number(source.totalValue);
    const aliases = new Set([...target.aliases, ...source.aliases, normalizeMaterialName(source.name)]);
    if (source.materialCode) aliases.add(source.materialCode.toLowerCase());
    aliases.delete(normalizeMaterialName(target.name));
    if (target.materialCode) aliases.delete(target.materialCode.toLowerCase());

    const merged = await tx.inventoryItem.update({
      where: { id: target.id },
      data: {
        currentStock: stock,
        totalValue: Math.round(value * 100) / 100,
        weightedAvgCost: stock > 0 ? Math.round((value / stock) * 100) / 100 : target.weightedAvgCost,
        minStockLevel: Prisma.Decimal.max(target.minStockLevel, source.minStockLevel),
        materialCode: target.materialCode ?? source.materialCode,
        sku: target.sku ?? source.sku,
        category: target.category ?? source.category,
        location: target.location ?? source.location,
        aliases: Array.from(aliases),
      },
    });
    await tx.inventoryItem.update({
      where: { id: source.id },
      data: { currentStock: 0, totalValue: 0, deletedAt: new Date() },
    });

    return {
      merged,
      summary: {
        sourceName: source.name, sourceSku: source.sku, targetName: target.name,
        movedTransactions: moved.count, movedAssets: assets.count, stockAdded: Number(source.currentStock),
      },
    };
  });
}
