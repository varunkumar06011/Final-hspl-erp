import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  materialPurchaseRequest: { findMany: vi.fn() },
}));
vi.mock('../src/config/prisma', () => ({ prisma: db }));

const myWork = vi.hoisted(() => ({ getMyWork: vi.fn() }));
vi.mock('../src/services/my-work.service', () => myWork);

const socket = vi.hoisted(() => ({ emitToUsers: vi.fn() }));
vi.mock('../src/socket', () => socket);

import {
  getApprovalPopup,
  noteApprovalPopupWrite,
  stopApprovalPopupNudges,
  POPUP_DEBOUNCE_MS,
} from '../src/services/approval-popup.service';

const viewer = { id: 'u1', role: 'PROJECT_HEAD', extraPermissions: [] };
const work = (over: Record<string, unknown>) => ({
  kind: 'MPR', id: 'a', number: 'VGH-MPR001', party: 'Sri Lakshmi', amount: 5000, summary: 'Cement × 5', why: null,
  paymentTerms: null, requirements: null, status: 'SUBMITTED', action: 'APPROVE', requestedBy: 'Site Sup',
  waitingOn: [], waitingSince: '2026-11-25T10:00:00.000Z', path: '/material-purchase-requests?id=a', flags: [], ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('getApprovalPopup', () => {
  it('returns nothing and reads no records when the switch is off', async () => {
    db.user.findUnique.mockResolvedValue({ approvalPopup: false, isActive: true });
    expect(await getApprovalPopup('p1', viewer)).toEqual({ enabled: false, items: [] });
    expect(myWork.getMyWork).not.toHaveBeenCalled();
  });

  it('lists only approvals (not drafts, finalize or receiving), oldest first, with material lines', async () => {
    db.user.findUnique.mockResolvedValue({ approvalPopup: true, isActive: true });
    myWork.getMyWork.mockResolvedValue({
      needsAction: [
        work({ id: 'new', waitingSince: '2026-11-25T12:00:00.000Z' }),
        work({ id: 'old', number: 'VGH-MPR000', waitingSince: '2026-11-24T09:00:00.000Z' }),
        work({ id: 'q', kind: 'QUOTATION', action: 'FINALIZE' }),
        work({ id: 'g', kind: 'GRN', action: 'INSPECT' }),
        work({ id: 'po', kind: 'PO', action: 'APPROVE', number: 'VGH-PO001' }),
      ],
      drafts: [], sentBack: [], waiting: [],
    });
    db.materialPurchaseRequest.findMany.mockResolvedValue([
      { id: 'old', items: [{ materialName: 'Cement', quantity: '50', unit: 'bag' }] },
    ]);
    const res = await getApprovalPopup('p1', viewer);
    expect(res.enabled).toBe(true);
    expect(res.items.map((i) => i.id)).toEqual(['old', 'po', 'new']);
    expect(res.items[0].lines).toEqual([{ name: 'Cement', quantity: 50, unit: 'bag' }]);
    expect(db.materialPurchaseRequest.findMany.mock.calls[0][0].where.projectId).toBe('p1');
  });
});

describe('live nudge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stopApprovalPopupNudges();
    vi.useRealTimers();
  });

  it('tells pop-up users once after a burst of approval writes, and ignores other tables', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    noteApprovalPopupWrite('Vendor', 'update');
    noteApprovalPopupWrite('MaterialPurchaseRequest', 'create');
    noteApprovalPopupWrite('ApprovalWorkflow', 'create');
    noteApprovalPopupWrite('MaterialPurchaseRequest', 'findMany');
    await vi.advanceTimersByTimeAsync(POPUP_DEBOUNCE_MS + 10);
    expect(socket.emitToUsers).toHaveBeenCalledTimes(1);
    expect(socket.emitToUsers.mock.calls[0][0]).toEqual(['u1']);
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ approvalPopup: true, isActive: true });
  });
});
