import { prisma } from '../config/prisma';
import { SocketEvents } from '@hospital-erp/shared';
import { emitToUsers } from '../socket';
import { getMyWork, type WorkItem } from './my-work.service';

// Approval pop-up: users with `approvalPopup` switched on (Project Heads by default) get a
// card for every request waiting for them, with Approve / Reject right on it.
//
// This is only a layer on top. The list is My Work's "needs action" list (so it follows exactly
// the same rules as the real approval flow), and Approve / Reject call the normal approval
// endpoints. Nothing here writes to the workflow.

export const POPUP_KINDS = new Set<WorkItem['kind']>(['MPR', 'PO', 'INVOICE']);

export interface PopupLine {
  name: string;
  quantity: number;
  unit: string | null;
}

export interface PopupItem {
  kind: WorkItem['kind'];
  id: string;
  number: string;
  party: string | null;
  amount: number | null;
  summary: string | null;
  lines: PopupLine[];
  requestedBy: string | null;
  waitingSince: string;
  path: string;
}

export interface PopupResponse {
  enabled: boolean;
  items: PopupItem[];
}

export async function getApprovalPopup(
  projectId: string,
  viewer: { id: string; role: string; extraPermissions: string[] },
): Promise<PopupResponse> {
  const flag = await prisma.user.findUnique({ where: { id: viewer.id }, select: { approvalPopup: true, isActive: true } });
  if (!flag?.approvalPopup || !flag.isActive) return { enabled: false, items: [] };

  const work = await getMyWork(projectId, viewer);
  const waiting = work.needsAction.filter((w) => w.action === 'APPROVE' && POPUP_KINDS.has(w.kind));

  // The material lines of each request, so the card shows what is being bought.
  const mprIds = waiting.filter((w) => w.kind === 'MPR').map((w) => w.id);
  const linesByMpr = new Map<string, PopupLine[]>();
  if (mprIds.length > 0) {
    const rows = await prisma.materialPurchaseRequest.findMany({
      where: { id: { in: mprIds }, projectId },
      select: { id: true, items: { select: { materialName: true, quantity: true, unit: true } } },
    });
    for (const r of rows) {
      linesByMpr.set(
        r.id,
        r.items.map((i) => ({ name: i.materialName, quantity: Number(i.quantity), unit: i.unit ?? null })),
      );
    }
  }

  // Oldest first: the one that has waited longest is asked first.
  const items = waiting
    .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))
    .map<PopupItem>((w) => ({
      kind: w.kind,
      id: w.id,
      number: w.number,
      party: w.party,
      amount: w.amount,
      summary: w.summary,
      lines: linesByMpr.get(w.id) ?? [],
      requestedBy: w.requestedBy,
      waitingSince: w.waitingSince,
      path: w.path,
    }));
  return { enabled: true, items };
}

// ── Live nudge ─────────────────────────────────────────────────
// Any write to an approval-bearing table tells every pop-up user's open app to refetch its list.
// Writes are batched (one approval touches several tables), so the nudge goes out once they pause.

const WATCHED_MODELS = new Set(['ApprovalWorkflow', 'ApprovalStep', 'MaterialPurchaseRequest', 'PurchaseOrder', 'VendorInvoice']);
const WRITE_ACTIONS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
export const POPUP_DEBOUNCE_MS = 700;
export const POPUP_MAX_WAIT_MS = 2500;

let timer: NodeJS.Timeout | null = null;
let firstChangeAt = 0;
let hooked = false;

async function flush(): Promise<void> {
  try {
    const users = await prisma.user.findMany({ where: { approvalPopup: true, isActive: true }, select: { id: true } });
    emitToUsers(users.map((u) => u.id), SocketEvents.APPROVAL_POPUP_REFRESH, {});
  } catch (err) {
    console.warn('[approval-popup] nudge failed', err);
  }
}

export function noteApprovalPopupWrite(model: string | undefined, action: string): void {
  if (!model || !WATCHED_MODELS.has(model) || !WRITE_ACTIONS.has(action)) return;
  const now = Date.now();
  if (!timer) firstChangeAt = now;
  else clearTimeout(timer);
  const wait = Math.max(0, Math.min(POPUP_DEBOUNCE_MS, firstChangeAt + POPUP_MAX_WAIT_MS - now));
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, wait);
  timer.unref?.();
}

type WriteMiddleware = (
  params: { model?: string; action: string },
  next: (params: { model?: string; action: string }) => Promise<unknown>,
) => Promise<unknown>;

export function startApprovalPopupNudges(): void {
  if (hooked) return;
  const client = prisma as unknown as { $use?: (fn: WriteMiddleware) => void };
  if (typeof client.$use !== 'function') return;
  hooked = true;
  client.$use(async (params, next) => {
    const result = await next(params);
    noteApprovalPopupWrite(params.model, params.action);
    return result;
  });
}

export function stopApprovalPopupNudges(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
