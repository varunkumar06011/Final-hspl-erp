/**
 * Read-only loader: pulls rows for one project through Prisma `select`s that
 * the schema plan generates, and assembles search documents. Never writes.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { DocInput, Section } from './engine';
import { LIMITS, REGISTRY } from './registry';
import { getPlans, humanize, type ModelPlan } from './schemaGraph';

// Rows come back from dynamically-chosen Prisma delegates, so their shape is only known at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Delegate = {
  findMany: (args: Record<string, unknown>) => Promise<Row[]>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_INDEXED_CHARS = 4000;
export const BATCH = 250;

export interface RowRef {
  model: string;
  /** Key of the root document this row belongs to. */
  root: string;
}

export interface GroupResult {
  docs: DocInput[];
  /** Every row (root, child, poly) that fed a document, by id. */
  rows: Map<string, RowRef>;
}

/**
 * A table whose query is structurally wrong or missing in this database (schema drift,
 * a migration not applied yet) is skipped instead of breaking search for everything
 * else. Transient problems (connection drops, timeouts) are NOT skippable: they bubble
 * up so the caller retries.
 */
export function skippable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientValidationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022');
}

const warnedModels = new Set<string>();
export async function tolerant<T>(model: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!skippable(err)) throw err;
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      const lastLine = (err as Error).message.trim().split(/\r?\n/).pop();
      console.warn(`[Search] ${model} left out of the index: ${lastLine}`);
    }
    return fallback;
  }
}

const delegateOf = (plan: ModelPlan): Delegate => (prisma as unknown as Record<string, Delegate>)[plan.delegate];
const plansByRole = (role: ModelPlan['role']) => getPlans().filter((p) => p.role === role);
export const rootPlans = (): ModelPlan[] => plansByRole('root');
export const planFor = (model: string): ModelPlan | undefined => getPlans().find((p) => p.model === model);
export const docKey = (model: string, id: string): string => `${model}:${id}`;

// ── query builders ──────────────────────────────────────────────────────────

/** Nested relation filter that ends at the root model: { purchaseOrder: <leaf> }. */
function throughPath(plan: ModelPlan, leaf: Record<string, unknown>): Record<string, unknown> {
  let where = leaf;
  for (let i = plan.path.length - 1; i >= 0; i--) where = { [plan.path[i].relation]: where };
  return where;
}

/** Rows of this model that belong to the project. */
export function scopeWhere(plan: ModelPlan, projectId: string): Record<string, unknown> {
  if (plan.role === 'child') return throughPath(plan, { projectId });
  return { projectId };
}

/** Rows of a child model hanging off the given root ids. */
function childrenOfRoots(plan: ModelPlan, rootIds: string[]): Record<string, unknown> {
  const last = plan.path[plan.path.length - 1];
  let where: Record<string, unknown> = { [last.fk]: { in: rootIds } };
  for (let i = plan.path.length - 2; i >= 0; i--) where = { [plan.path[i].relation]: where };
  return where;
}

/** Select that reaches the root id for multi-hop children. */
function rootIdSelect(plan: ModelPlan): Record<string, unknown> {
  if (plan.path.length < 2) return {};
  let sel: Record<string, unknown> = { [plan.path[plan.path.length - 1].fk]: true };
  for (let i = plan.path.length - 2; i >= 0; i--) sel = { [plan.path[i].relation]: { select: sel } };
  return sel;
}

export function rootIdOf(plan: ModelPlan, row: Row): string | null {
  if (plan.path.length === 0) return null;
  let obj: Row | null | undefined = row;
  for (let i = 0; i < plan.path.length - 1; i++) obj = obj?.[plan.path[i].relation];
  const id = obj?.[plan.path[plan.path.length - 1].fk];
  return typeof id === 'string' ? id : null;
}

function fullSelect(plan: ModelPlan): Record<string, unknown> {
  const sel: Record<string, unknown> = { id: true };
  for (const f of plan.text) sel[f.name] = true;
  for (const n of [...plan.numbers, ...plan.dates, ...plan.json, ...plan.fks]) sel[n] = true;
  if (plan.hasDeletedAt) sel.deletedAt = true;
  if (plan.stamp) sel[plan.stamp] = true;
  if (plan.role === 'poly') sel.entityId = true;
  if (plan.role === 'child') Object.assign(sel, rootIdSelect(plan));
  return sel;
}

function lightSelect(plan: ModelPlan): Record<string, unknown> {
  const sel: Record<string, unknown> = { id: true };
  if (plan.hasDeletedAt) sel.deletedAt = true;
  if (plan.role === 'poly') sel.entityId = true;
  if (plan.role === 'child') {
    sel[plan.path[0].fk] = true;
    Object.assign(sel, rootIdSelect(plan));
  }
  return sel;
}

// ── light reads used by incremental sync ────────────────────────────────────

export interface LightRow {
  id: string;
  deleted: boolean;
  /** For children: the root id; for poly: the record it points at. */
  parentId: string | null;
}

function toLight(plan: ModelPlan, row: Row): LightRow {
  return {
    id: row.id,
    deleted: plan.hasDeletedAt && row.deletedAt != null,
    parentId: plan.role === 'child' ? rootIdOf(plan, row) : plan.role === 'poly' ? row.entityId ?? null : null,
  };
}

/** Rows changed since `since` (soft-deleted ones included so removals are seen). */
export async function changedRows(plan: ModelPlan, projectId: string, since: Date): Promise<LightRow[]> {
  if (!plan.stamp) return [];
  const rows = await delegateOf(plan).findMany({
    where: { ...scopeWhere(plan, projectId), [plan.stamp]: { gte: since } },
    select: lightSelect(plan),
    take: 5000,
  });
  return rows.map((r) => toLight(plan, r));
}

/** Look up specific rows (not project-scoped) to find which document they belong to. */
export async function lightRowsById(plan: ModelPlan, ids: string[]): Promise<LightRow[]> {
  if (ids.length === 0) return [];
  const rows = await delegateOf(plan).findMany({ where: { id: { in: ids } }, select: lightSelect(plan) });
  return rows.map((r) => toLight(plan, r));
}

/** Ids of every live row of this model in the project. */
export async function liveRows(plan: ModelPlan, projectId: string): Promise<LightRow[]> {
  const rows = await delegateOf(plan).findMany({
    where: { ...scopeWhere(plan, projectId), ...(plan.hasDeletedAt ? { deletedAt: null } : {}) },
    select: lightSelect(plan),
  });
  return rows.map((r) => toLight(plan, r));
}

/** One page of live root ids, for the initial build. */
export async function pageRootIds(plan: ModelPlan, projectId: string, after?: string): Promise<string[]> {
  const rows = await delegateOf(plan).findMany({
    where: { projectId, ...(plan.hasDeletedAt ? { deletedAt: null } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: BATCH,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  return rows.map((r) => r.id as string);
}

// ── value formatting ────────────────────────────────────────────────────────

function textOf(row: Row, name: string): string {
  const v = row[name];
  if (v == null) return '';
  const raw = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && !UUID.test(x)).join(', ') : String(v);
  if (!raw || UUID.test(raw.trim())) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function numberOf(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function dateParts(v: unknown): { iso: string; display: string; index: string } | null {
  const d = v instanceof Date ? v : v ? new Date(String(v)) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dd = String(day).padStart(2, '0');
  const mm = String(m + 1).padStart(2, '0');
  return {
    iso: `${y}-${mm}-${dd}`,
    display: `${day} ${MONTHS_SHORT[m]} ${y}`,
    index: `${y}-${mm}-${dd} ${dd}-${mm}-${y} ${dd}/${mm}/${y} ${day} ${MONTHS_SHORT[m]} ${MONTHS_LONG[m]} ${y}`,
  };
}

function jsonStrings(value: unknown, out: string[], depth = 0): void {
  if (out.length >= LIMITS.jsonStringsPerField || depth > 4 || value == null) return;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.length >= 2 && !UUID.test(s)) out.push(s);
  } else if (Array.isArray(value)) {
    for (const v of value) jsonStrings(v, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Row)) {
      if (!/hash|token|secret|password/i.test(k)) jsonStrings(v, out, depth + 1);
    }
  }
}

// ── document assembly ───────────────────────────────────────────────────────

function ownSections(plan: ModelPlan, row: Row): Section[] {
  const out: Section[] = [];
  for (const f of plan.text) {
    const full = textOf(row, f.name);
    if (!full) continue;
    const section: Section = { label: humanize(f.name), labelKey: f.name, text: clip(full, LIMITS.charsPerSection), weight: f.weight, kind: 'self' };
    if (full.length > LIMITS.charsPerSection) section.index = full.slice(0, MAX_INDEXED_CHARS);
    out.push(section);
  }
  for (const n of plan.numbers) {
    const v = numberOf(row[n]);
    if (v === null || Math.abs(v) < 100) continue;
    out.push({ label: humanize(n), labelKey: n, text: money(v), index: String(Math.trunc(Math.abs(v))), weight: 0.6, kind: 'self' });
  }
  for (const n of plan.dates) {
    const d = dateParts(row[n]);
    if (d) out.push({ label: humanize(n), labelKey: n, text: d.display, index: d.index, weight: 0.4, kind: 'self' });
  }
  for (const n of plan.json) {
    const strings: string[] = [];
    jsonStrings(row[n], strings);
    if (strings.length) out.push({ label: humanize(n), labelKey: n, text: clip(strings.join(' · '), LIMITS.charsPerSection), index: strings.join(' ').slice(0, MAX_INDEXED_CHARS), weight: 0.5, kind: 'self' });
  }
  return out;
}

/** One line for a folded child record: "Cement 53 Grade · bags", extras "Quantity 100". */
function childSection(plan: ModelPlan, row: Row): Section | null {
  const parts = plan.text
    .map((f) => ({ f, v: textOf(row, f.name) }))
    .filter((p) => p.v)
    .sort((a, b) => b.f.weight - a.f.weight);
  if (parts.length === 0) return null;

  const extras: string[] = [];
  const bigNumbers: string[] = [];
  for (const n of plan.numbers) {
    const v = numberOf(row[n]);
    if (v === null) continue;
    if (extras.length < 4) extras.push(`${humanize(n)} ${money(v)}`);
    if (Math.abs(v) >= 100) bigNumbers.push(String(Math.trunc(Math.abs(v))));
  }
  const text = parts.map((p) => p.v).join(' · ');
  return {
    label: humanize(plan.model),
    labelKey: plan.model,
    text: clip(text, LIMITS.charsPerSection),
    // Plain-space separators keep indexing on the fast ASCII path.
    index: [parts.map((p) => p.v).join(' ').slice(0, MAX_INDEXED_CHARS), ...bigNumbers].join(' '),
    weight: Math.max(...parts.map((p) => p.f.weight)),
    kind: 'child',
    extra: extras.length ? extras.join(' · ') : undefined,
  };
}

function buildDoc(plan: ModelPlan, row: Row, children: Section[]): DocInput {
  const registered = REGISTRY[plan.model];
  const key = docKey(plan.model, row.id);

  const own = ownSections(plan, row);
  const title =
    plan.titleFields.map((f) => textOf(row, f)).find(Boolean) ||
    `${registered?.label ?? humanize(plan.model)} ${String(row.id).slice(0, 8)}`;

  const subtitle = (registered?.subtitle ?? [])
    .map((f) => textOf(row, f))
    .filter((v) => v && v !== title)
    .join(' · ');

  const refs: string[] = [];
  for (const e of plan.edges) {
    const target = row[e.fk];
    if (typeof target === 'string') refs.push(docKey(e.target, target));
  }

  const amount = plan.amountField ? numberOf(row[plan.amountField]) : null;
  const stamp = plan.stamp && row[plan.stamp] ? new Date(row[plan.stamp]).getTime() : 0;
  const path = registered?.path ? registered.path(row.id, row) : null;

  return {
    key,
    model: plan.model,
    id: row.id,
    title,
    subtitle,
    path,
    status: plan.statusField && typeof row[plan.statusField] === 'string' ? row[plan.statusField] : undefined,
    amount: amount ?? undefined,
    date: plan.dateField ? dateParts(row[plan.dateField])?.iso : undefined,
    sections: [...own, ...children].slice(0, LIMITS.sectionsPerDoc),
    refs,
    stamp,
  };
}

/**
 * Loads the given roots and everything folded into them (children, comments,
 * attachments) and returns ready-to-index documents. Roots that no longer
 * exist, or are soft-deleted, are simply absent from the result.
 */
export async function loadGroup(rootPlan: ModelPlan, projectId: string, ids: string[]): Promise<GroupResult> {
  const plans = getPlans();
  const rootRows = await delegateOf(rootPlan).findMany({
    where: { id: { in: ids }, projectId, ...(rootPlan.hasDeletedAt ? { deletedAt: null } : {}) },
    select: fullSelect(rootPlan),
  });
  const rows = new Map<string, RowRef>();
  const sectionsByRoot = new Map<string, Section[]>();
  const owners = new Map<string, string>(); // any row id → root id, for polymorphic lookups
  for (const r of rootRows) {
    rows.set(r.id, { model: rootPlan.model, root: docKey(rootPlan.model, r.id) });
    owners.set(r.id, r.id);
  }
  if (rootRows.length === 0) return { docs: [], rows };
  const rootIds = rootRows.map((r) => r.id as string);

  const add = (rootId: string, section: Section | null) => {
    if (!section) return;
    const list = sectionsByRoot.get(rootId);
    if (list) list.push(section);
    else sectionsByRoot.set(rootId, [section]);
  };

  const childPlans = plans.filter((p) => p.role === 'child' && p.root === rootPlan.model);
  const loaded = await Promise.all(
    childPlans.map(async (plan) => ({
      plan,
      rows: await tolerant<Row[]>(plan.model, [], () =>
        delegateOf(plan).findMany({
          where: { ...childrenOfRoots(plan, rootIds), ...(plan.hasDeletedAt ? { deletedAt: null } : {}) },
          select: fullSelect(plan),
          ...(plan.stamp === 'createdAt' || plan.stamp === 'updatedAt' ? { orderBy: { [plan.stamp]: 'desc' } } : {}),
        }),
      ),
    })),
  );

  const rootIdSet = new Set(rootIds);
  const perParent = new Map<string, number>();
  for (const { plan, rows: childRows } of loaded) {
    for (const row of childRows) {
      const rootId = rootIdOf(plan, row);
      if (!rootId || !rootIdSet.has(rootId)) continue;
      const n = (perParent.get(`${plan.model}:${rootId}`) ?? 0) + 1;
      perParent.set(`${plan.model}:${rootId}`, n);
      if (n > LIMITS.childrenPerParent) continue;
      rows.set(row.id, { model: plan.model, root: docKey(rootPlan.model, rootId) });
      owners.set(row.id, rootId);
      add(rootId, childSection(plan, row));
    }
  }

  const ownerIds = [...owners.keys()];
  for (const plan of plansByRole('poly')) {
    const polyRows = await tolerant<Row[]>(plan.model, [], () =>
      delegateOf(plan).findMany({
        where: { projectId, entityId: { in: ownerIds }, ...(plan.hasDeletedAt ? { deletedAt: null } : {}) },
        select: fullSelect(plan),
        ...(plan.stamp ? { orderBy: { [plan.stamp]: 'desc' } } : {}),
      }),
    );
    for (const row of polyRows) {
      const rootId = owners.get(row.entityId);
      if (!rootId) continue;
      rows.set(row.id, { model: plan.model, root: docKey(rootPlan.model, rootId) });
      add(rootId, childSection(plan, row));
    }
  }

  const docs = rootRows.map((row) => buildDoc(rootPlan, row, sectionsByRoot.get(row.id) ?? []));
  return { docs, rows };
}
