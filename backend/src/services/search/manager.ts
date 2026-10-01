/**
 * Owns one in-memory index per project: builds it lazily (read-only queries),
 * keeps it fresh, evicts idle ones, and answers searches with permissions
 * applied. The database is only ever read.
 *
 * Freshness, cheapest first:
 *   1. Write hook      — a write through this server marks its table dirty and the
 *                        next search (or a 0.7 s timer) re-reads just the changed rows.
 *   2. Delta poll      — every minute while the project is in use, rows with a newer
 *                        updatedAt/createdAt are re-read (covers other servers/scripts).
 *   3. Id reconcile    — every 10 min compares live ids with the index so hard
 *                        deletes and missed rows self-heal.
 *   4. Rebuild         — an index older than 3 h is rebuilt in the background.
 */
import { hasPermission, isAdminRole } from '@hospital-erp/shared';
import { prisma } from '../../config/prisma';
import { SearchIndex, type SearchHit, type SearchOutput } from './engine';
import {
  changedRows,
  docKey,
  lightRowsById,
  liveRows,
  loadGroup,
  pageRootIds,
  skippable,
  tolerant,
  planFor,
  rootPlans,
  type LightRow,
  type RowRef,
} from './indexer';
import { LIMITS, REGISTRY } from './registry';
import { getPlans, humanize, type ModelPlan } from './schemaGraph';

const DELTA_EVERY_MS = 60_000;
const ID_CHECK_EVERY_MS = 10 * 60_000;
const REBUILD_AFTER_MS = 3 * 60 * 60_000;
const ACTIVE_WINDOW_MS = 10 * 60_000;
const EVICT_AFTER_MS = 30 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const WRITE_DEBOUNCE_MS = 700;
const FRESHEN_WAIT_MS = 2_000;
const CONCURRENCY = 4;

interface Bucket {
  projectId: string;
  index: SearchIndex;
  /** id → which document the row feeds. */
  rows: Map<string, RowRef>;
  /** root key → ids of the rows folded into it. */
  members: Map<string, Set<string>>;
  since: Date;
  builtAt: number;
  lastUsed: number;
  lastIdCheck: number;
  /** Tables written to without a known row id (updateMany, …). */
  pendingModels: Set<string>;
  /** A transaction finished: any table may have changed, scan them all by timestamp. */
  pendingAll: boolean;
  /** Specific rows written to: model → ids. */
  pendingRows: Map<string, Set<string>>;
  pendingIdCheck: Set<string>;
  ready: Promise<void>;
  chain: Promise<void>;
}

const buckets = new Map<string, Bucket>();
let timer: NodeJS.Timeout | null = null;
let flushTimer: NodeJS.Timeout | null = null;

const log = (msg: string, extra?: unknown) => console.log(`[Search] ${msg}`, extra ?? '');
const warn = (msg: string, err: unknown) => console.warn(`[Search] ${msg}`, err instanceof Error ? err.message : err);

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

// ── building & applying ─────────────────────────────────────────────────────

function applyGroup(bucket: Bucket, rootModel: string, requested: string[], group: Awaited<ReturnType<typeof loadGroup>>): void {
  const returned = new Map(group.docs.map((d) => [d.id, d]));
  for (const id of requested) {
    const key = docKey(rootModel, id);
    for (const rowId of bucket.members.get(key) ?? []) bucket.rows.delete(rowId);
    bucket.members.delete(key);
    bucket.rows.delete(id);

    const doc = returned.get(id);
    if (!doc) {
      bucket.index.remove(key);
      continue;
    }
    bucket.index.upsert(doc);
  }
  for (const [rowId, ref] of group.rows) {
    bucket.rows.set(rowId, ref);
    if (rowId === ref.root.slice(ref.root.indexOf(':') + 1)) continue; // the root itself
    let set = bucket.members.get(ref.root);
    if (!set) bucket.members.set(ref.root, (set = new Set()));
    set.add(rowId);
  }
}

async function reload(bucket: Bucket, rootPlan: ModelPlan, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    applyGroup(bucket, rootPlan.model, slice, await loadGroup(rootPlan, bucket.projectId, slice));
  }
}

async function build(bucket: Bucket): Promise<void> {
  const started = Date.now();
  const since = new Date(started - CLOCK_SKEW_MS);
  const fresh: Bucket = { ...bucket, index: new SearchIndex(), rows: new Map(), members: new Map() };

  for (const plan of rootPlans()) {
    let after: string | undefined;
    try {
      for (;;) {
        const ids = await pageRootIds(plan, bucket.projectId, after);
        if (ids.length === 0) break;
        applyGroup(fresh, plan.model, ids, await loadGroup(plan, bucket.projectId, ids));
        after = ids[ids.length - 1];
        if (ids.length < 250) break;
      }
    } catch (err) {
      // One table the database can't serve must not take search down for the rest.
      if (!skippable(err)) throw err;
      warn(`${plan.model} left out of the index`, err);
    }
  }

  bucket.index = fresh.index;
  bucket.rows = fresh.rows;
  bucket.members = fresh.members;
  bucket.since = since;
  bucket.builtAt = Date.now();
  bucket.lastIdCheck = Date.now();
  log(`indexed project ${bucket.projectId.slice(0, 8)}: ${bucket.index.size} records in ${Date.now() - started} ms`);
}

// ── incremental sync ────────────────────────────────────────────────────────

interface SyncOptions {
  /** Only look at these tables (write-hook path). Default: all. */
  models?: Set<string>;
  /** Rows a write touched, so edits to tables without an updatedAt column are seen too. */
  rows?: Map<string, Set<string>>;
  /** Tables to compare id-by-id against the database. 'all' for every table. */
  idCheck?: Set<string> | 'all';
}

async function runSync(bucket: Bucket, opts: SyncOptions): Promise<void> {
  const started = Date.now();
  const dirty = new Map<string, Set<string>>(); // root model → ids to reload
  const mark = (rootKey: string) => {
    const at = rootKey.indexOf(':');
    const model = rootKey.slice(0, at);
    let set = dirty.get(model);
    if (!set) dirty.set(model, (set = new Set()));
    set.add(rootKey.slice(at + 1));
  };
  const markRow = (plan: ModelPlan, row: LightRow) => {
    if (plan.role === 'root') mark(docKey(plan.model, row.id));
    else if (plan.role === 'child' && plan.root && row.parentId) mark(docKey(plan.root, row.parentId));
    else if (plan.role === 'poly' && row.parentId) {
      const owner = bucket.rows.get(row.parentId);
      if (owner) mark(owner.root);
    }
  };

  const rowsByModel = new Map<string, Map<string, RowRef>>();
  if (opts.idCheck === 'all' || (opts.idCheck && opts.idCheck.size > 0)) {
    for (const [id, ref] of bucket.rows) {
      let m = rowsByModel.get(ref.model);
      if (!m) rowsByModel.set(ref.model, (m = new Map()));
      m.set(id, ref);
    }
  }

  for (const [model, ids] of opts.rows ?? []) {
    const plan = planFor(model);
    if (!plan) continue;
    const unknown: string[] = [];
    for (const id of ids) {
      const known = bucket.rows.get(id);
      if (known) mark(known.root);
      else if (plan.role === 'root') mark(docKey(model, id));
      else unknown.push(id);
    }
    for (const row of await lightRowsById(plan, unknown)) markRow(plan, row);
  }

  const plans = getPlans().filter((p) => !opts.models || opts.models.has(p.model));
  await mapLimit(plans, CONCURRENCY, async (plan) => {
    for (const row of await tolerant(plan.model, [], () => changedRows(plan, bucket.projectId, bucket.since))) markRow(plan, row);

    if (opts.idCheck === 'all' || opts.idCheck?.has(plan.model)) {
      const live = await tolerant(plan.model, null, () => liveRows(plan, bucket.projectId));
      if (!live) return;
      const liveIds = new Set(live.map((r) => r.id));
      const known = rowsByModel.get(plan.model) ?? new Map<string, RowRef>();
      for (const [id, ref] of known) if (!liveIds.has(id)) mark(ref.root);
      for (const row of live) if (!known.has(row.id)) markRow(plan, row);
    }
  });

  let reloaded = 0;
  for (const [model, ids] of dirty) {
    const plan = planFor(model);
    if (!plan || plan.role !== 'root') continue;
    await reload(bucket, plan, [...ids]);
    reloaded += ids.size;
  }
  bucket.since = new Date(started - CLOCK_SKEW_MS);
  if (opts.idCheck === 'all') bucket.lastIdCheck = Date.now();
  if (reloaded) log(`project ${bucket.projectId.slice(0, 8)}: refreshed ${reloaded} record(s)`);
}

/** Serialise all work on a bucket so builds and syncs never interleave. */
function enqueue(bucket: Bucket, task: () => Promise<void>): Promise<void> {
  const run = bucket.chain.then(task, task);
  bucket.chain = run.catch(() => undefined);
  return run;
}

function syncNow(bucket: Bucket, opts: SyncOptions = {}): Promise<void> {
  return enqueue(bucket, () => runSync(bucket, opts));
}

const hasPending = (b: Bucket) => b.pendingAll || b.pendingModels.size > 0 || b.pendingRows.size > 0;

function flushPending(bucket: Bucket): Promise<void> {
  if (!hasPending(bucket)) return Promise.resolve();
  const all = bucket.pendingAll;
  const models = bucket.pendingModels;
  const rows = bucket.pendingRows;
  const idCheck = bucket.pendingIdCheck;
  bucket.pendingAll = false;
  bucket.pendingModels = new Set();
  bucket.pendingRows = new Map();
  bucket.pendingIdCheck = new Set();
  // Row-level writes only need their own rows; table-level ones need a delta scan too.
  return syncNow(bucket, { models: all ? undefined : models, rows, idCheck }).catch((err) => {
    // Put the work back so the next tick retries it.
    if (all) bucket.pendingAll = true;
    models.forEach((m) => bucket.pendingModels.add(m));
    for (const [m, ids] of rows) {
      const set = bucket.pendingRows.get(m) ?? new Set<string>();
      ids.forEach((id) => set.add(id));
      bucket.pendingRows.set(m, set);
    }
    idCheck.forEach((m) => bucket.pendingIdCheck.add(m));
    warn('refresh failed', err);
  });
}

// ── buckets ─────────────────────────────────────────────────────────────────

function bucketFor(projectId: string): Bucket {
  let bucket = buckets.get(projectId);
  if (bucket) return bucket;

  bucket = {
    projectId,
    index: new SearchIndex(),
    rows: new Map(),
    members: new Map(),
    since: new Date(),
    builtAt: 0,
    lastUsed: Date.now(),
    lastIdCheck: Date.now(),
    pendingModels: new Set(),
    pendingAll: false,
    pendingRows: new Map(),
    pendingIdCheck: new Set(),
    ready: Promise.resolve(),
    chain: Promise.resolve(),
  };
  const created = bucket;
  created.ready = enqueue(created, () => build(created)).catch((err) => {
    buckets.delete(projectId);
    throw err;
  });
  buckets.set(projectId, created);

  // Keep memory bounded: drop the least recently used project.
  if (buckets.size > LIMITS.residentProjects) {
    const oldest = [...buckets.values()].filter((b) => b !== created).sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest) buckets.delete(oldest.projectId);
  }
  return created;
}

/** Build (or refresh) a project's index ahead of the first search. */
export async function warmProject(projectId: string): Promise<void> {
  const bucket = bucketFor(projectId);
  await bucket.ready;
}

export async function warmAllProjects(): Promise<void> {
  try {
    const projects = await prisma.project.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const p of projects.slice(0, LIMITS.residentProjects)) {
      try {
        await warmProject(p.id);
      } catch (err) {
        warn(`warm-up failed for project ${p.id.slice(0, 8)}`, err);
      }
    }
  } catch (err) {
    warn('warm-up skipped', err);
  }
}

// ── lifecycle ───────────────────────────────────────────────────────────────

function tick(): void {
  const now = Date.now();
  for (const bucket of buckets.values()) {
    if (now - bucket.lastUsed > EVICT_AFTER_MS) {
      buckets.delete(bucket.projectId);
      continue;
    }
    if (now - bucket.lastUsed > ACTIVE_WINDOW_MS || bucket.builtAt === 0) continue;

    if (now - bucket.builtAt > REBUILD_AFTER_MS) {
      enqueue(bucket, () => build(bucket)).catch((err) => warn('rebuild failed', err));
      continue;
    }
    const idCheck = now - bucket.lastIdCheck > ID_CHECK_EVERY_MS;
    syncNow(bucket, idCheck ? { idCheck: 'all' } : {}).catch((err) => warn('sync failed', err));
  }
}

const WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const REMOVING_ACTIONS = new Set(['delete', 'deleteMany']);

/** Called after any write made through this server's Prisma client. */
export function noteWrite(model: string, action: string, id?: string): void {
  if (buckets.size === 0 || !getPlans().some((p) => p.model === model)) return;
  for (const bucket of buckets.values()) {
    if (id) {
      const set = bucket.pendingRows.get(model) ?? new Set<string>();
      set.add(id);
      bucket.pendingRows.set(model, set);
    } else {
      bucket.pendingModels.add(model);
      if (REMOVING_ACTIONS.has(action)) bucket.pendingIdCheck.add(model);
    }
  }
  scheduleFlush();
}

/**
 * Called when a transaction commits. Writes inside interactive transactions do not pass
 * through the per-query hook, so any table may have changed: scan them all by timestamp.
 */
export function noteTransaction(): void {
  if (buckets.size === 0) return;
  for (const bucket of buckets.values()) bucket.pendingAll = true;
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const bucket of buckets.values()) void flushPending(bucket);
  }, WRITE_DEBOUNCE_MS);
  flushTimer.unref?.();
}

interface WriteParams {
  model?: string;
  action: string;
  args?: { where?: { id?: unknown } };
}
type WriteMiddleware = (params: WriteParams, next: (p: WriteParams) => Promise<unknown>) => Promise<unknown>;

let hooked = false;

export function startSearchIndex(): void {
  if (!timer) {
    timer = setInterval(tick, DELTA_EVERY_MS);
    timer.unref?.();
  }
  const client = prisma as unknown as {
    $use?: (fn: WriteMiddleware) => void;
    $transaction?: (...args: unknown[]) => Promise<unknown>;
  };
  if (!hooked && typeof client.$use === 'function') {
    hooked = true;
    const transaction = client.$transaction;
    if (typeof transaction === 'function') {
      client.$transaction = async (...args: unknown[]) => {
        const result = await transaction.apply(client, args);
        noteTransaction();
        return result;
      };
    }
    client.$use(async (params, next) => {
      const result = await next(params);
      if (params.model && WRITE_ACTIONS.has(params.action)) {
        const id = (result as { id?: unknown } | null)?.id ?? params.args?.where?.id;
        noteWrite(params.model, params.action, typeof id === 'string' ? id : undefined);
      }
      return result;
    });
  }
}

export function stopSearchIndex(): void {
  if (timer) clearInterval(timer);
  if (flushTimer) clearTimeout(flushTimer);
  timer = null;
  flushTimer = null;
}

/** Test helper. */
export function resetSearchIndexForTests(): void {
  buckets.clear();
}

// ── querying ────────────────────────────────────────────────────────────────

export interface SearchRequest {
  projectId: string;
  role: string;
  query: string;
  limit?: number;
  perTypeLimit?: number;
  /** Restrict to these models. */
  models?: string[];
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  total: number;
  counts: Record<string, number>;
  results: (SearchHit & { typeLabel: string })[];
}

function canSee(role: string, model: string): boolean {
  const reg = REGISTRY[model];
  if (!reg) return isAdminRole(role);
  return !reg.permission || hasPermission(role, reg.permission);
}

export async function searchProject(req: SearchRequest): Promise<SearchResponse> {
  const started = Date.now();
  const bucket = bucketFor(req.projectId);
  bucket.lastUsed = Date.now();
  await bucket.ready;

  // Read-your-writes: pick up anything this server just changed.
  if (hasPending(bucket)) {
    await Promise.race([flushPending(bucket), new Promise((r) => setTimeout(r, FRESHEN_WAIT_MS))]);
  }

  const only = req.models?.length ? new Set(req.models) : null;
  const out: SearchOutput = bucket.index.search(req.query, {
    limit: Math.min(req.limit ?? 40, LIMITS.maxResults),
    perTypeLimit: req.perTypeLimit ?? 8,
    allow: (doc) => (!only || only.has(doc.model)) && canSee(req.role, doc.model),
  });

  return {
    query: req.query,
    tookMs: Date.now() - started,
    total: out.total,
    counts: out.counts,
    results: out.hits.map((hit) => ({ ...hit, typeLabel: REGISTRY[hit.model]?.label ?? humanize(hit.model) })),
  };
}
