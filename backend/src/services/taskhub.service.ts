import crypto from 'crypto';
import { canLinkTaskHub, getRoleLabel } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { toRequestUser } from '../middleware/auth';
import { logger } from '../utils/logger';
import { getMyWork, WorkItem } from './my-work.service';

// ═══════════════════════════════════════════════════════════
// Task Hub integration: the four approver roles see their ERP approvals in Task Hub.
//
// - Linking: an approver asks the ERP for a 6-digit code (10 min, one use, held in memory) and types it
//   into Task Hub; Task Hub's server redeems it here and keeps the ERP user id. The ERP
//   re-reads that user's role on every call, so whoever holds the title gets the list.
// - Reading: Task Hub's server asks for one user's approvals across every live project.
//   The list is My Work's "needs action" (approve / finalize) for that user, nothing more.
// - Nudging: any write to an approval-bearing table sends Task Hub a signed, debounced
//   "approvals changed" POST, so it can refresh and push without polling.
//
// Server to server only, guarded by TASKHUB_SYNC_SECRET. Nothing here writes business data.
// ═══════════════════════════════════════════════════════════

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const SECRET_HEADER = 'x-taskhub-secret';
export const SIGNATURE_HEADER = 'x-erp-signature';
export const TIMESTAMP_HEADER = 'x-erp-timestamp';
export const NUDGE_DEBOUNCE_MS = 3000;

/** Tables whose writes can open or settle an approval. */
const WATCHED_MODELS = new Set([
  'ApprovalWorkflow',
  'ApprovalStep',
  'MaterialPurchaseRequest',
  'Quotation',
  'PurchaseOrder',
  'VendorInvoice',
  'PaymentRequest',
]);
const WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
/** My Work actions that are a decision for an approver (the rest are site chores). */
const DECISIONS = new Set<WorkItem['action']>(['APPROVE', 'FINALIZE']);

const syncSecret = () => process.env.TASKHUB_SYNC_SECRET?.trim() || '';
const webhookUrl = () => process.env.TASKHUB_WEBHOOK_URL?.trim() || '';

export const isTaskHubConfigured = () => syncSecret().length > 0;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

/** Constant-time check of the shared secret Task Hub sends. */
export function isValidTaskHubSecret(given: unknown): boolean {
  const secret = syncSecret();
  if (!secret || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(sha256(given), sha256(secret));
}

const hashCode = (code: string) => sha256(`taskhub-link:${code}`).toString('hex');

// ── linking ────────────────────────────────────────────────

export class TaskHubLinkError extends Error {
  constructor(
    public readonly code: 'NOT_ALLOWED' | 'CODE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Live codes, kept in memory only (no table): code hash → owner and expiry. A code lives
 * 10 minutes, so a restart costs at most one "make a new code". Assumes one server instance.
 */
const linkCodes = new Map<string, { userId: string; expiresAt: number }>();

function dropExpiredCodes(now: number): void {
  for (const [hash, entry] of linkCodes) if (entry.expiresAt <= now) linkCodes.delete(hash);
}

/** Test helper. */
export function resetLinkCodesForTests(): void {
  linkCodes.clear();
}

/** A fresh 6-digit code for this user; any earlier unused code of theirs stops working. */
export function createLinkCode(user: {
  id: string;
  role: string;
  extraPermissions?: string[];
}): { code: string; expiresAt: Date } {
  if (!canLinkTaskHub(user.role, user.extraPermissions)) {
    throw new TaskHubLinkError('NOT_ALLOWED', 'Only Project Head, Head of Construction and admins can connect Task Hub.');
  }
  const now = Date.now();
  dropExpiredCodes(now);
  for (const [hash, entry] of linkCodes) if (entry.userId === user.id) linkCodes.delete(hash);

  // Six digits with a 10-minute life: retry the rare clash with another live code.
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = hashCode(code);
    if (linkCodes.has(codeHash)) continue;
    const expiresAt = now + LINK_CODE_TTL_MS;
    linkCodes.set(codeHash, { userId: user.id, expiresAt });
    return { code, expiresAt: new Date(expiresAt) };
  }
  throw new Error('Could not make a link code, please try again');
}

export interface TaskHubUser {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
}

/** Uses up a code and says whose it was. */
export async function redeemLinkCode(rawCode: string): Promise<TaskHubUser> {
  const code = rawCode.replace(/\D/g, '');
  const invalid = new TaskHubLinkError('CODE_INVALID', 'That code is wrong or has expired. Make a new one in the ERP.');
  if (code.length !== 6) throw invalid;

  const now = Date.now();
  dropExpiredCodes(now);
  const codeHash = hashCode(code);
  const entry = linkCodes.get(codeHash);
  if (!entry) throw invalid;
  // One use: removed before any await, so two redeems of the same code cannot both succeed.
  linkCodes.delete(codeHash);

  const user = await prisma.user.findUnique({ where: { id: entry.userId } });
  if (!user || !user.isActive) throw invalid;
  const viewer = toRequestUser(user, null);
  if (!canLinkTaskHub(viewer.role, viewer.extraPermissions)) {
    throw new TaskHubLinkError('NOT_ALLOWED', 'This ERP user is no longer an approver.');
  }
  return { id: user.id, name: user.name, role: user.role, roleLabel: getRoleLabel(user.role) };
}

// ── reading ────────────────────────────────────────────────

export interface TaskHubApproval extends WorkItem {
  project: { id: string; code: string; name: string };
  /** Opens the record in the ERP, switching to its project first. */
  url: string;
}

export interface TaskHubApprovals {
  /** null when the ERP user no longer exists or was deactivated: Task Hub should unlink. */
  user: TaskHubUser | null;
  /** False when the user exists but no longer holds an approver role (list is empty). */
  eligible: boolean;
  items: TaskHubApproval[];
  generatedAt: string;
}

/** The ERP web address used in links: the first FRONTEND_URL entry. */
export function erpBaseUrl(): string {
  const raw = process.env.ERP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5174';
  return raw.split(',')[0].trim().replace(/\/+$/, '');
}

export function recordUrl(path: string, projectId: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${erpBaseUrl()}${path}${sep}project=${encodeURIComponent(projectId)}`;
}

/** Everything waiting on this user's decision, in every live project, oldest first. */
export async function getTaskHubApprovals(erpUserId: string): Promise<TaskHubApprovals> {
  const generatedAt = new Date().toISOString();
  const user = await prisma.user.findUnique({ where: { id: erpUserId } });
  if (!user || !user.isActive) return { user: null, eligible: false, items: [], generatedAt };

  const viewer = toRequestUser(user, null);
  const who: TaskHubUser = { id: user.id, name: user.name, role: user.role, roleLabel: getRoleLabel(user.role) };
  if (!canLinkTaskHub(viewer.role, viewer.extraPermissions)) return { user: who, eligible: false, items: [], generatedAt };

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  const perProject = await Promise.all(
    projects.map(async (project) => {
      const work = await getMyWork(project.id, {
        id: viewer.id,
        role: viewer.role,
        extraPermissions: viewer.extraPermissions,
      });
      return work.needsAction
        .filter((item) => DECISIONS.has(item.action))
        .map((item): TaskHubApproval => ({ ...item, project, url: recordUrl(item.path, project.id) }));
    }),
  );
  const items = perProject
    .flat()
    .sort((a, b) => new Date(a.waitingSince).getTime() - new Date(b.waitingSince).getTime());
  return { user: who, eligible: true, items, generatedAt };
}

// ── nudging ────────────────────────────────────────────────

/** HMAC Task Hub checks: hex sha256 of `${timestamp}.${body}` keyed by TASKHUB_SYNC_SECRET. */
export function signNudge(timestamp: string, body: string, secret = syncSecret()): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** A steady stream of writes still sends a nudge at least this often. */
const NUDGE_MAX_WAIT_MS = 15_000;

let nudgeTimer: NodeJS.Timeout | null = null;
let firstChangeAt = 0;
const changedModels = new Set<string>();

async function sendNudge(): Promise<void> {
  const url = webhookUrl();
  const secret = syncSecret();
  const models = [...changedModels];
  changedModels.clear();
  if (!url || !secret) return;
  const body = JSON.stringify({ event: 'erp.approvals.changed', models, at: new Date().toISOString() });
  const timestamp = String(Date.now());
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: signNudge(timestamp, body, secret),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.warn({ event: 'taskhub_nudge_failed', status: res.status });
  } catch (err) {
    logger.warn({ event: 'taskhub_nudge_failed', err: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Notes a write. The nudge goes out once writes have been quiet for NUDGE_DEBOUNCE_MS, so one
 * approval touching several tables (often inside a transaction) is one nudge sent after commit.
 */
export function noteApprovalWrite(model: string | undefined, action: string): void {
  if (!model || !WATCHED_MODELS.has(model) || !WRITE_ACTIONS.has(action)) return;
  if (!webhookUrl() || !syncSecret()) return;
  const now = Date.now();
  if (changedModels.size === 0) firstChangeAt = now;
  changedModels.add(model);
  if (nudgeTimer) clearTimeout(nudgeTimer);
  const wait = Math.max(0, Math.min(NUDGE_DEBOUNCE_MS, firstChangeAt + NUDGE_MAX_WAIT_MS - now));
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    void sendNudge();
  }, wait);
  nudgeTimer.unref?.();
}

type WriteMiddleware = (
  params: { model?: string; action: string },
  next: (params: { model?: string; action: string }) => Promise<unknown>,
) => Promise<unknown>;
let hooked = false;

/** Starts nudging Task Hub (only when TASKHUB_WEBHOOK_URL and TASKHUB_SYNC_SECRET are set). */
export function startTaskHubNudges(): void {
  if (hooked || !webhookUrl() || !syncSecret()) return;
  const client = prisma as unknown as { $use?: (fn: WriteMiddleware) => void };
  if (typeof client.$use !== 'function') return;
  hooked = true;
  client.$use(async (params, next) => {
    const result = await next(params);
    noteApprovalWrite(params.model, params.action);
    return result;
  });
}

export function stopTaskHubNudges(): void {
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
  changedModels.clear();
}
