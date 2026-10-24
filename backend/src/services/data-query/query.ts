/**
 * Structured, read-only questions over any readable table ("how much did we
 * spend on steel this month", "POs per vendor", "invoices above ₹1 lakh not yet
 * verified"). The model never writes SQL: it sends a small spec (table, filters,
 * columns, totals, grouping) that is checked against the catalog and turned into
 * a Prisma query here, with the project always pinned by the server.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { REGISTRY } from '../search/registry';
import { canRead, getCatalog, type CatalogField, type CatalogModel, type Reader } from './catalog';
import { guardedColumns, readerRoleAvailable, runGuarded, type GuardedClient } from './dbGuard';
import type { ModuleAccessSubject } from '@hospital-erp/shared';

export class QueryError extends Error {}

export const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;
const MAX_CHILD_ROWS = 20;
const MAX_GROUPS = 50;
const MAX_FIELDS = 30;
const MAX_TEXT = 300;
const NUMERIC = new Set(['Int', 'BigInt', 'Float', 'Decimal']);

const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'in', 'notIn', 'isNull', 'notNull'] as const;
const PERIODS = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'this_quarter', 'this_year', 'last_year'] as const;

const name = z.string().trim().min(1).max(80);
export const querySpecSchema = z.object({
  model: name,
  filters: z
    .array(
      z.object({
        field: name,
        op: z.enum(OPS),
        value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
        values: z.array(z.union([z.string().max(200), z.number()])).max(50).optional(),
      }),
    )
    .max(15)
    .optional(),
  fields: z.array(name).max(MAX_FIELDS).optional(),
  include: z.array(name).max(3).optional(),
  orderBy: z.object({ field: name, dir: z.enum(['asc', 'desc']).optional() }).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
  period: z.object({ field: name, range: z.enum(PERIODS) }).optional(),
  aggregate: z
    .object({
      count: z.boolean().optional(),
      sum: z.array(name).max(5).optional(),
      avg: z.array(name).max(5).optional(),
      min: z.array(name).max(5).optional(),
      max: z.array(name).max(5).optional(),
    })
    .optional(),
  groupBy: z.array(name).min(1).max(2).optional(),
  includeDeleted: z.boolean().optional(),
});
export type QuerySpec = z.infer<typeof querySpecSchema>;

export interface QueryCaller extends Reader {
  projectId: string;
  /** For module switches: the user's own permissions and overrides. */
  subject: ModuleAccessSubject;
}

export interface QueryResult {
  model: string;
  /** List queries. */
  rows?: Record<string, unknown>[];
  total?: number;
  /** Totals over every matching row. */
  aggregate?: Record<string, unknown>;
  /** groupBy queries. */
  groups?: Record<string, unknown>[];
  /** The database enforced the reader role too (not only the query builder). */
  dbRole: boolean;
  ms: number;
}

// ─── catalog lookups with the caller's rights ───────────────────────────────

function readable(caller: QueryCaller, model: string, role: boolean): CatalogModel {
  const entry = getCatalog().get(model);
  if (!entry || !canRead(entry, caller, caller.subject) || (role && !guardedColumns(model))) {
    throw new QueryError(`Unknown table or no access: ${model}. Call describe_data to see the tables you may read.`);
  }
  return entry;
}

function columnsOf(entry: CatalogModel, role: boolean): Map<string, CatalogField> {
  if (!role) return entry.fields;
  const granted = new Set(guardedColumns(entry.model) ?? []);
  return new Map([...entry.fields].filter(([k]) => granted.has(k)));
}

interface ResolvedField {
  /** Relation hop (to-one) or null for a column of the table itself. */
  relation: string | null;
  target: CatalogModel;
  field: CatalogField;
}

/** "status" or "vendor.name" (one to-one hop). */
function resolveField(caller: QueryCaller, entry: CatalogModel, path: string, role: boolean): ResolvedField {
  const parts = path.split('.');
  if (parts.length > 2) throw new QueryError(`Only one relation hop is allowed: ${path}`);
  if (parts.length === 2) {
    const rel = entry.relations.get(parts[0]);
    if (!rel || rel.toMany) throw new QueryError(`${entry.model} has no single related record "${parts[0]}".`);
    const target = readable(caller, rel.target, role);
    const field = columnsOf(target, role).get(parts[1]);
    if (!field) throw new QueryError(`${rel.target} has no readable column "${parts[1]}".`);
    return { relation: parts[0], target, field };
  }
  const field = columnsOf(entry, role).get(path);
  if (!field) throw new QueryError(`${entry.model} has no readable column "${path}". Call describe_data for its columns.`);
  return { relation: null, target: entry, field };
}

// ─── values ─────────────────────────────────────────────────────────────────

function coerce(type: string, isEnum: boolean, raw: unknown, label: string): unknown {
  if (raw === undefined || raw === null) throw new QueryError(`A value is needed for ${label}.`);
  if (NUMERIC.has(type)) {
    const n = Number(String(raw).replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(n)) throw new QueryError(`${label} needs a number.`);
    return type === 'Int' || type === 'BigInt' ? Math.trunc(n) : n;
  }
  if (type === 'DateTime') {
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) throw new QueryError(`${label} needs a date (YYYY-MM-DD).`);
    return d;
  }
  if (type === 'Boolean') return raw === true || raw === 'true' || raw === 'yes';
  if (isEnum || type === 'String') return String(raw);
  throw new QueryError(`${label} (${type}) cannot be filtered.`);
}

const IST_OFFSET_MS = 330 * 60 * 1000;
/** [from, to) in UTC for a named period, by the Indian calendar. */
export function periodRange(range: (typeof PERIODS)[number], now = new Date()): { gte: Date; lt: Date } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - IST_OFFSET_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const q = Math.floor(m / 3) * 3;
  switch (range) {
    case 'today':
      return { gte: at(y, m, d), lt: at(y, m, d + 1) };
    case 'yesterday':
      return { gte: at(y, m, d - 1), lt: at(y, m, d) };
    case 'this_week':
      return { gte: at(y, m, d - dow), lt: at(y, m, d + 1) };
    case 'last_7_days':
      return { gte: at(y, m, d - 6), lt: at(y, m, d + 1) };
    case 'this_month':
      return { gte: at(y, m, 1), lt: at(y, m + 1, 1) };
    case 'last_month':
      return { gte: at(y, m - 1, 1), lt: at(y, m, 1) };
    case 'last_30_days':
      return { gte: at(y, m, d - 29), lt: at(y, m, d + 1) };
    case 'this_quarter':
      return { gte: at(y, q, 1), lt: at(y, q + 3, 1) };
    case 'this_year':
      return { gte: at(y, 0, 1), lt: at(y + 1, 0, 1) };
    case 'last_year':
      return { gte: at(y - 1, 0, 1), lt: at(y, 0, 1) };
  }
}

function condition(f: NonNullable<QuerySpec['filters']>[number], field: ResolvedField['field'], label: string): unknown {
  const c = (v: unknown) => coerce(field.type, field.isEnum, v, label);
  const text = field.type === 'String' && !field.isEnum;
  switch (f.op) {
    case 'eq':
      return text ? { equals: c(f.value), mode: 'insensitive' } : { equals: c(f.value) };
    case 'ne':
      return { not: c(f.value) };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [f.op]: c(f.value) };
    case 'contains':
    case 'startsWith':
      if (!text) throw new QueryError(`${f.op} only works on text columns (${label}).`);
      return { [f.op]: String(f.value ?? ''), mode: 'insensitive' };
    case 'in':
    case 'notIn': {
      const values = f.values ?? (f.value !== undefined ? [f.value] : []);
      if (!values.length) throw new QueryError(`${f.op} needs values (${label}).`);
      return { [f.op]: values.map(c) };
    }
    case 'isNull':
      return { equals: null };
    case 'notNull':
      return { not: null };
  }
}

// ─── where / select ─────────────────────────────────────────────────────────

/** The server's own conditions: the caller's project (through the parent chain for child tables) and not deleted. */
function scopeWhere(entry: CatalogModel, projectId: string): Record<string, unknown> {
  if (entry.scope === 'project') return { projectId };
  if (entry.scope !== 'child') return {};
  let where: Record<string, unknown> = { projectId };
  for (const step of [...entry.path].reverse()) where = { [step.relation]: { is: where } };
  return where;
}

function buildWhere(caller: QueryCaller, entry: CatalogModel, spec: QuerySpec, role: boolean): Record<string, unknown> {
  const and: Record<string, unknown>[] = [scopeWhere(entry, caller.projectId)];
  let touchesDeleted = false;
  for (const f of spec.filters ?? []) {
    const r = resolveField(caller, entry, f.field, role);
    if (r.field.name === 'deletedAt' && !r.relation) touchesDeleted = true;
    if (r.field.list || r.field.type === 'Json') throw new QueryError(`${f.field} cannot be filtered.`);
    const cond = { [r.field.name]: condition(f, r.field, f.field) };
    and.push(r.relation ? { [r.relation]: { is: cond } } : cond);
  }
  if (spec.period) {
    const r = resolveField(caller, entry, spec.period.field, role);
    if (r.field.type !== 'DateTime') throw new QueryError(`period needs a date column, not ${spec.period.field}.`);
    const cond = { [r.field.name]: periodRange(spec.period.range) };
    and.push(r.relation ? { [r.relation]: { is: cond } } : cond);
  }
  if (entry.hasDeletedAt && !spec.includeDeleted && !touchesDeleted) and.push({ deletedAt: null });
  return { AND: and };
}

const DEFAULT_SKIP = /^(createdBy|updatedBy|deletedAt|updatedAt)$/;
function defaultColumns(entry: CatalogModel, role: boolean): string[] {
  return [...columnsOf(entry, role).values()]
    .filter((f) => f.type !== 'Json' && !DEFAULT_SKIP.test(f.name))
    .map((f) => f.name)
    .slice(0, 20);
}

function buildSelect(caller: QueryCaller, entry: CatalogModel, spec: QuerySpec, role: boolean): Record<string, unknown> {
  const select: Record<string, unknown> = { id: true };
  const wanted = spec.fields?.length ? spec.fields : defaultColumns(entry, role);
  for (const path of wanted) {
    const r = resolveField(caller, entry, path, role);
    if (!r.relation) {
      select[r.field.name] = true;
      continue;
    }
    const cur = (select[r.relation] as { select: Record<string, boolean> } | undefined) ?? { select: { id: true } };
    cur.select[r.field.name] = true;
    select[r.relation] = cur;
  }
  for (const relName of spec.include ?? []) {
    const rel = entry.relations.get(relName);
    if (!rel || !rel.toMany) throw new QueryError(`${entry.model} has no list of lines called "${relName}".`);
    const child = readable(caller, rel.target, role);
    const childSelect = Object.fromEntries(defaultColumns(child, role).map((c) => [c, true]));
    select[relName] = { select: { id: true, ...childSelect }, take: MAX_CHILD_ROWS };
  }
  return select;
}

// ─── output ─────────────────────────────────────────────────────────────────

function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    if (Prisma.Decimal.isDecimal(value)) return Number(String(value));
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

function numericColumns(caller: QueryCaller, entry: CatalogModel, names: string[] | undefined, role: boolean, what: string): string[] {
  return (names ?? []).map((n) => {
    const r = resolveField(caller, entry, n, role);
    if (r.relation) throw new QueryError(`${what} works on this table's own columns only (${n}).`);
    if (!NUMERIC.has(r.field.type) && !(what !== 'sum' && what !== 'avg' && r.field.type === 'DateTime')) {
      throw new QueryError(`${what} needs a number column, not ${n}.`);
    }
    return r.field.name;
  });
}

/** _sum / _avg / _min / _max for the columns asked; kinds with no column are left out (Prisma refuses empty or undefined ones). */
function totals(cols: { sum: string[]; avg: string[]; min: string[]; max: string[] }): Record<string, Record<string, true>> {
  const out: Record<string, Record<string, true>> = {};
  for (const [kind, names] of Object.entries(cols)) {
    if (names.length) out[`_${kind}`] = Object.fromEntries(names.map((c) => [c, true as const]));
  }
  return out;
}

/** Title of a record for group labels ("ABC Traders", "VGH-PO012"). */
function titleColumn(entry: CatalogModel, role: boolean): string | null {
  const cols = columnsOf(entry, role);
  const preferred = REGISTRY[entry.model]?.title ?? [];
  return (
    preferred.find((c) => cols.has(c)) ??
    [...cols.keys()].find((c) => /^(name|title)$/i.test(c)) ??
    [...cols.keys()].find((c) => /(Number|Code|particulars|Name)$/.test(c)) ??
    null
  );
}

type Delegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  count(args: unknown): Promise<number>;
  aggregate(args: unknown): Promise<Record<string, unknown>>;
  groupBy(args: unknown): Promise<Record<string, unknown>[]>;
};
const delegateOf = (tx: GuardedClient, entry: CatalogModel) => (tx as unknown as Record<string, Delegate>)[entry.delegate];

/** Runs one structured question. Throws QueryError for anything the caller may not ask. */
export async function runDataQuery(caller: QueryCaller, rawSpec: unknown): Promise<QueryResult> {
  const parsed = querySpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new QueryError(`Invalid query: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const spec = parsed.data;
  const started = Date.now();
  const { result, role } = await runGuarded(caller.projectId, async (tx, guard) => {
    const entry = readable(caller, spec.model, guard.role);
    if (entry.scope === 'user') throw new QueryError('People are not a table you can query; ask about the records they created or approved.');
    const where = buildWhere(caller, entry, spec, guard.role);
    const delegate = delegateOf(tx, entry);
    const out: Omit<QueryResult, 'dbRole' | 'ms'> = { model: entry.model };

    const agg = spec.aggregate;
    const sum = numericColumns(caller, entry, agg?.sum, guard.role, 'sum');
    const avg = numericColumns(caller, entry, agg?.avg, guard.role, 'avg');
    const min = numericColumns(caller, entry, agg?.min, guard.role, 'min');
    const max = numericColumns(caller, entry, agg?.max, guard.role, 'max');

    if (spec.groupBy) {
      const by = spec.groupBy.map((g) => {
        const r = resolveField(caller, entry, g, guard.role);
        if (r.relation) throw new QueryError(`Group by this table's own columns (e.g. vendorId, status), not ${g}.`);
        if (r.field.type === 'Json' || r.field.list) throw new QueryError(`${g} cannot be grouped.`);
        return r.field.name;
      });
      const orderBy = sum.length ? { _sum: { [sum[0]]: 'desc' } } : { _count: { [by[0]]: 'desc' } };
      const groups = await delegate.groupBy({
        by,
        where,
        _count: { _all: true },
        ...totals({ sum, avg, min, max }),
        orderBy,
        take: Math.min(spec.limit ?? MAX_GROUPS, MAX_GROUPS),
      });
      // Name the groups when they are keyed by a related record (vendorId -> vendor name).
      const labels: Record<string, Record<string, string>> = {};
      for (const col of by) {
        const rel = [...entry.relations.values()].find((r) => !r.toMany && fkOfRelation(entry, r.name) === col);
        if (!rel) continue;
        const target = getCatalog().get(rel.target);
        if (!target || !canRead(target, caller, caller.subject)) continue;
        const title = titleColumn(target, guard.role);
        if (!title) continue;
        const ids = [...new Set(groups.map((g) => g[col]).filter((v): v is string => typeof v === 'string'))];
        if (!ids.length) continue;
        const rows = await delegateOf(tx, target).findMany({ where: { id: { in: ids } }, select: { id: true, [title]: true } });
        labels[col] = Object.fromEntries(rows.map((r) => [String(r.id), String(r[title] ?? '')]));
      }
      out.groups = groups.map((g) => {
        const row = plain(g) as Record<string, unknown>;
        for (const col of Object.keys(labels)) row[`${col}Label`] = labels[col][String(g[col])] ?? null;
        return row;
      });
      return out;
    }

    if (agg) {
      const a = await delegate.aggregate({
        where,
        ...(agg.count === false ? {} : { _count: true }),
        ...totals({ sum, avg, min, max }),
      });
      out.aggregate = plain(a) as Record<string, unknown>;
      // A totals question that also asked for columns gets the rows too.
      if (!spec.fields?.length && !spec.include?.length) return out;
    }

    const select = buildSelect(caller, entry, spec, guard.role);
    let orderBy: Record<string, unknown> | undefined;
    if (spec.orderBy) {
      const r = resolveField(caller, entry, spec.orderBy.field, guard.role);
      const dir = spec.orderBy.dir ?? 'desc';
      orderBy = r.relation ? { [r.relation]: { [r.field.name]: dir } } : { [r.field.name]: dir };
    } else if (columnsOf(entry, guard.role).has('createdAt')) {
      orderBy = { createdAt: 'desc' };
    }
    const take = spec.limit ?? DEFAULT_ROWS;
    const [rows, total] = await Promise.all([delegate.findMany({ where, select, orderBy, take }), delegate.count({ where })]);
    out.rows = rows.map((r) => plain(r) as Record<string, unknown>);
    out.total = total;
    return out;
  });
  return { ...result, dbRole: role, ms: Date.now() - started };
}

function fkOfRelation(entry: CatalogModel, relation: string): string | null {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === entry.model);
  const f = model?.fields.find((x) => x.name === relation);
  return f?.relationFromFields?.[0] ?? null;
}

// ─── schema description for the model ───────────────────────────────────────

export interface TableInfo {
  model: string;
  label: string;
  columns?: { name: string; type: string }[];
  relations?: { name: string; target: string; many: boolean }[];
}

/** The tables this caller may read; with `model`, that table's columns and relations. */
export async function describeData(caller: QueryCaller, model?: string): Promise<TableInfo[]> {
  const role = await readerRoleAvailable();
  const visible = [...getCatalog().values()].filter(
    (e) => e.scope !== 'user' && canRead(e, caller, caller.subject) && (!role || guardedColumns(e.model)),
  );
  const label = (e: CatalogModel) => REGISTRY[e.model]?.label ?? e.model.replace(/([a-z])([A-Z])/g, '$1 $2');
  if (!model) return visible.map((e) => ({ model: e.model, label: label(e) }));
  const entry = visible.find((e) => e.model.toLowerCase() === model.toLowerCase());
  if (!entry) throw new QueryError(`Unknown table or no access: ${model}.`);
  return [
    {
      model: entry.model,
      label: label(entry),
      columns: [...columnsOf(entry, role).values()].map((f) => ({ name: f.name, type: f.list ? `${f.type}[]` : f.type })),
      relations: [...entry.relations.values()]
        .filter((r) => {
          const t = getCatalog().get(r.target);
          return t && canRead(t, caller, caller.subject);
        })
        .map((r) => ({ name: r.name, target: r.target, many: r.toMany })),
    },
  ];
}
