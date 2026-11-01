import { Prisma } from '@prisma/client';
import {
  CATALOG_CODE_PREFIX,
  CatalogItemKind,
  catalogNameKey,
  catalogSpecKey,
  comparePrice,
  findPredefinedItem,
  tidySpec,
  type PriceComparison,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';

/**
 * The item catalog: one list of materials and services shared by every project.
 *
 * Every write that carries material lines (request, quotation, PO, gate pass, goods
 * receipt, stock entry, site bill) passes them through `resolveCatalogLines`, which
 * links each line to its catalog item (found by id, name or alias, else created) and
 * its specification (found in that item's own list, else added to it). So the same
 * material can never be entered twice under different names or codes, whatever screen
 * (or Miko) it was typed on.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface CatalogLineInput {
  materialName: string;
  itemId?: string | null;
  specification?: string | null;
  unit?: string | null;
  materialCode?: string | null;
}

export interface ResolvedCatalogFields {
  itemId: string;
  materialName: string;
  materialCode: string;
  specification: string | null;
}

type CatalogItemRow = Prisma.CatalogItemGetPayload<{ include: { specs: true } }>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Next free code for a kind (MAT-0001, SRV-0001). `preferred` is used when it is free. */
export async function nextCode(db: Db, kind: CatalogItemKind, preferred?: string | null): Promise<string> {
  const prefix = CATALOG_CODE_PREFIX[kind];
  if (preferred && preferred.startsWith(prefix)) {
    const taken = await db.catalogItem.findUnique({ where: { code: preferred }, select: { id: true } });
    if (!taken) return preferred;
  }
  const rows = await db.catalogItem.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
  const max = rows.reduce((m, r) => {
    const n = Number(r.code.slice(prefix.length));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Follows merges to the item that is still in use. */
export async function liveItem(db: Db, id: string): Promise<CatalogItemRow | null> {
  let item = await db.catalogItem.findUnique({ where: { id }, include: { specs: true } });
  for (let hops = 0; item && !item.isActive && item.mergedIntoId && hops < 5; hops++) {
    item = await db.catalogItem.findUnique({ where: { id: item.mergedIntoId }, include: { specs: true } });
  }
  return item;
}

/** The live item a typed name belongs to (name or alias), preferring the given kind. */
export async function findCatalogItemByName(db: Db, name: string, kind?: CatalogItemKind): Promise<CatalogItemRow | null> {
  const key = catalogNameKey(name);
  if (!key) return null;
  const matches = await db.catalogItem.findMany({
    where: { isActive: true, OR: [{ nameKey: key }, { aliases: { has: key } }] },
    include: { specs: true },
    orderBy: { createdAt: 'asc' },
  });
  return (
    matches.find((m) => m.nameKey === key && (!kind || m.kind === kind)) ??
    matches.find((m) => !kind || m.kind === kind) ??
    matches.find((m) => m.nameKey === key) ??
    matches[0] ??
    null
  );
}

/**
 * Creates the item for a new name. A name that matches a predefined item (TMT bars ->
 * Steel) becomes that item, with its starting spec list, and the typed name is kept as
 * an alias. Safe under concurrency: a parallel create of the same name returns that row.
 */
async function createCatalogItem(
  db: Db,
  input: { name: string; kind: CatalogItemKind; unit?: string | null; userId?: string | null; preferredCode?: string | null },
): Promise<CatalogItemRow> {
  const predefined = findPredefinedItem(input.name, input.kind) ?? findPredefinedItem(input.name);
  const kind = predefined?.kind ?? input.kind;
  const name = predefined?.name ?? input.name.trim().replace(/\s+/g, ' ');
  const nameKey = catalogNameKey(name);
  const typedKey = catalogNameKey(input.name);

  const existing = await db.catalogItem.findUnique({ where: { kind_nameKey: { kind, nameKey } }, include: { specs: true } });
  if (existing) {
    if (typedKey !== nameKey && !existing.aliases.includes(typedKey)) {
      return db.catalogItem.update({ where: { id: existing.id }, data: { aliases: { push: typedKey } }, include: { specs: true } });
    }
    return existing;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.catalogItem.create({
        data: {
          code: await nextCode(db, kind, attempt === 0 ? input.preferredCode : null),
          kind,
          name,
          nameKey,
          unit: input.unit?.trim() || predefined?.unit || null,
          category: predefined?.category ?? null,
          aliases: typedKey !== nameKey ? [typedKey] : [],
          createdBy: input.userId ?? null,
          specs: predefined
            ? { create: predefined.specs.map((value) => ({ value, valueKey: catalogSpecKey(value), isPredefined: true })) }
            : undefined,
        },
        include: { specs: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.catalogItem.findUnique({ where: { kind_nameKey: { kind, nameKey } }, include: { specs: true } });
      if (raced) return raced;
      // otherwise the code collided: try the next one
    }
  }
  throw new Error(`Could not create catalog item "${name}"`);
}

/** The item's spec for a typed value, added to the item's list when new. */
export async function ensureSpec(db: Db, item: CatalogItemRow, typed: string | null | undefined, userId?: string | null): Promise<string | null> {
  const value = tidySpec(typed);
  if (!value) return null;
  const valueKey = catalogSpecKey(value);
  if (!valueKey) return null;
  const known = item.specs.find((s) => s.valueKey === valueKey);
  if (known) return known.value;
  try {
    const created = await db.catalogItemSpec.create({ data: { itemId: item.id, value, valueKey, createdBy: userId ?? null } });
    item.specs.push(created);
    return created.value;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.catalogItemSpec.findUnique({ where: { itemId_valueKey: { itemId: item.id, valueKey } } });
    return raced?.value ?? value;
  }
}

/**
 * Links every line to its catalog item and spec. Returns the lines with the item's own
 * name, code and the canonical spec filled in (the unit falls back to the item's unit).
 */
export async function resolveCatalogLines<T extends CatalogLineInput>(
  lines: T[],
  opts: { kind?: CatalogItemKind; userId?: string | null; db?: Db } = {},
): Promise<Array<T & ResolvedCatalogFields>> {
  const db = opts.db ?? prisma;
  const byKey = new Map<string, CatalogItemRow>();
  const out: Array<T & ResolvedCatalogFields> = [];
  for (const line of lines) {
    let item: CatalogItemRow | null = null;
    if (line.itemId) item = await liveItem(db, line.itemId);
    const key = `${opts.kind ?? ''}|${catalogNameKey(line.materialName)}`;
    if (!item) item = byKey.get(key) ?? null;
    if (!item) item = await findCatalogItemByName(db, line.materialName, opts.kind);
    if (!item) {
      item = await createCatalogItem(db, {
        name: line.materialName,
        kind: opts.kind ?? CatalogItemKind.MATERIAL,
        unit: line.unit,
        userId: opts.userId,
        preferredCode: line.materialCode ? toCatalogCode(line.materialCode) : null,
      });
    }
    byKey.set(key, item);
    if (!item.unit && line.unit?.trim()) {
      await db.catalogItem.update({ where: { id: item.id }, data: { unit: line.unit.trim() } });
      item.unit = line.unit.trim();
    }
    const specification = await ensureSpec(db, item, line.specification, opts.userId);
    out.push({
      ...line,
      itemId: item.id,
      materialName: item.name,
      materialCode: item.code,
      specification,
      unit: line.unit?.trim() || item.unit || line.unit || null,
    });
  }
  return out;
}

/** VGH-MAT-0021 (old per-project code) -> MAT-0021, kept when the number is free. */
export function toCatalogCode(code: string): string | null {
  const m = /(MAT|SRV)-(\d+)$/i.exec(code.trim());
  return m ? `${m[1].toUpperCase()}-${m[2].padStart(4, '0')}` : null;
}

// ═══ Price history and the price check ═══

export type PriceSource = 'PO' | 'QUOTATION' | 'REQUEST';

export interface PriceEntry {
  source: PriceSource;
  rate: number;
  unit: string | null;
  date: string;
  vendorName: string | null;
  docId: string;
  docNumber: string;
  projectCode: string;
}

export interface VendorPrice {
  vendorName: string;
  latestRate: number;
  latestDate: string;
  lowestRate: number;
  count: number;
  projectCodes: string[];
}

export interface PriceCheckResult {
  itemId: string | null;
  specification: string | null;
  /** The last price paid (PO), else the last finalized quote, else the last estimate. */
  last: PriceEntry | null;
  comparison: PriceComparison | null;
  /** Last price per vendor (POs and quotes), cheapest latest price first. */
  vendors: VendorPrice[];
  bestVendor: string | null;
  history: PriceEntry[];
}

const DEAD_PO = ['DELETED', 'CANCELLED', 'REJECTED'];
const unitKey = (unit: string | null | undefined) => (unit ?? '').trim().toLowerCase().replace(/s$/, '');

export interface PriceExclusions {
  poId?: string | null;
  quotationId?: string | null;
  mprId?: string | null;
}

/**
 * Every recorded price of an item (+ spec), newest first, across all projects. `anySpec`
 * takes every specification of the item (the item's overview), not only the given one.
 */
export async function priceHistory(
  itemId: string,
  specification: string | null | undefined,
  exclude: PriceExclusions = {},
  anySpec = false,
): Promise<PriceEntry[]> {
  const specKey = catalogSpecKey(specification);
  const sameSpec = (s: string | null) => anySpec || catalogSpecKey(s) === specKey;
  const [poLines, quoteLines, mprLines] = await Promise.all([
    prisma.pOItem.findMany({
      where: {
        itemId,
        unitPrice: { gt: 0 },
        purchaseOrder: { deletedAt: null, status: { notIn: DEAD_PO }, isContract: false, ...(exclude.poId ? { id: { not: exclude.poId } } : {}) },
      },
      select: {
        unitPrice: true, unit: true, specification: true,
        purchaseOrder: { select: { id: true, poNumber: true, date: true, vendor: { select: { name: true } }, project: { select: { code: true } } } },
      },
      take: 500,
    }),
    prisma.quotationItem.findMany({
      where: {
        itemId,
        unitPrice: { gt: 0 },
        quotation: { deletedAt: null, status: { not: 'REJECTED' }, ...(exclude.quotationId ? { id: { not: exclude.quotationId } } : {}) },
      },
      select: {
        unitPrice: true, unit: true, specification: true,
        quotation: { select: { id: true, quotationNumber: true, date: true, status: true, vendor: { select: { name: true } }, project: { select: { code: true } } } },
      },
      take: 500,
    }),
    prisma.materialPurchaseRequestItem.findMany({
      where: {
        itemId,
        estimatedRate: { gt: 0 },
        mpr: { deletedAt: null, status: { notIn: ['CANCELLED', 'REJECTED'] }, ...(exclude.mprId ? { id: { not: exclude.mprId } } : {}) },
      },
      select: {
        estimatedRate: true, unit: true, specification: true,
        mpr: { select: { id: true, mprNumber: true, date: true, vendor: { select: { name: true } }, project: { select: { code: true } } } },
      },
      take: 500,
    }),
  ]);

  const entries: PriceEntry[] = [
    ...poLines.filter((l) => sameSpec(l.specification)).map((l) => ({
      source: 'PO' as const, rate: Number(l.unitPrice), unit: l.unit, date: l.purchaseOrder.date.toISOString(),
      vendorName: l.purchaseOrder.vendor?.name ?? null, docId: l.purchaseOrder.id, docNumber: l.purchaseOrder.poNumber,
      projectCode: l.purchaseOrder.project.code,
    })),
    ...quoteLines.filter((l) => sameSpec(l.specification)).map((l) => ({
      source: 'QUOTATION' as const, rate: Number(l.unitPrice), unit: l.unit, date: l.quotation.date.toISOString(),
      vendorName: l.quotation.vendor?.name ?? null, docId: l.quotation.id, docNumber: l.quotation.quotationNumber,
      projectCode: l.quotation.project.code,
    })),
    ...mprLines.filter((l) => sameSpec(l.specification)).map((l) => ({
      source: 'REQUEST' as const, rate: Number(l.estimatedRate), unit: l.unit, date: l.mpr.date.toISOString(),
      vendorName: l.mpr.vendor?.name ?? null, docId: l.mpr.id, docNumber: l.mpr.mprNumber,
      projectCode: l.mpr.project.code,
    })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** Last price + vendor comparison for one rate. Pure: works on an already loaded history. */
export function evaluatePrice(history: PriceEntry[], rate: number | null | undefined, unit?: string | null): Omit<PriceCheckResult, 'itemId' | 'specification'> {
  // Compare like with like: when the line has a unit and some history uses it, only those count.
  const wanted = unitKey(unit);
  const sameUnit = wanted ? history.filter((h) => unitKey(h.unit) === wanted) : [];
  const pool = sameUnit.length > 0 ? sameUnit : history;

  const last =
    pool.find((h) => h.source === 'PO') ??
    pool.find((h) => h.source === 'QUOTATION') ??
    pool.find((h) => h.source === 'REQUEST') ??
    null;

  const byVendor = new Map<string, VendorPrice>();
  for (const h of pool) {
    if (h.source === 'REQUEST' || !h.vendorName) continue;
    const v = byVendor.get(h.vendorName);
    if (!v) {
      byVendor.set(h.vendorName, { vendorName: h.vendorName, latestRate: h.rate, latestDate: h.date, lowestRate: h.rate, count: 1, projectCodes: [h.projectCode] });
    } else {
      v.count += 1;
      v.lowestRate = Math.min(v.lowestRate, h.rate);
      if (!v.projectCodes.includes(h.projectCode)) v.projectCodes.push(h.projectCode);
    }
  }
  const vendors = Array.from(byVendor.values()).sort((a, b) => a.latestRate - b.latestRate);
  return {
    last,
    comparison: last && rate != null && Number(rate) > 0 ? comparePrice(Number(rate), last.rate) : null,
    vendors,
    bestVendor: vendors.length > 1 ? vendors[0].vendorName : null,
    history: pool.slice(0, 20),
  };
}

export interface PriceCheckLine {
  itemId?: string | null;
  materialName?: string | null;
  specification?: string | null;
  rate?: number | null;
  unit?: string | null;
}

/** Price check for a set of lines (one result per line, same order). */
export async function priceCheck(lines: PriceCheckLine[], exclude: PriceExclusions = {}): Promise<PriceCheckResult[]> {
  const cache = new Map<string, PriceEntry[]>();
  const results: PriceCheckResult[] = [];
  for (const line of lines) {
    let itemId = line.itemId ?? null;
    if (itemId) itemId = (await liveItem(prisma, itemId))?.id ?? null;
    if (!itemId && line.materialName) itemId = (await findCatalogItemByName(prisma, line.materialName))?.id ?? null;
    if (!itemId) {
      results.push({ itemId: null, specification: line.specification ?? null, last: null, comparison: null, vendors: [], bestVendor: null, history: [] });
      continue;
    }
    const key = `${itemId}|${catalogSpecKey(line.specification)}`;
    let history = cache.get(key);
    if (!history) {
      history = await priceHistory(itemId, line.specification, exclude);
      cache.set(key, history);
    }
    results.push({ itemId, specification: line.specification ?? null, ...evaluatePrice(history, line.rate, line.unit) });
  }
  return results;
}
