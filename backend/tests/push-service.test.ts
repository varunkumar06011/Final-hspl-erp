/**
 * Push Service Tests
 * ==================
 *
 * The push service sends Firebase Cloud Messaging (FCM) push notifications to
 * approvers' phones when a payment request, quotation, PO, or invoice needs
 * their approval. Without push notifications, approvers would have to
 * constantly refresh the app to check for pending items.
 *
 * The service has two parts:
 *  1. Subscription management — users register/unregister their device tokens.
 *     A user can have multiple devices (phone + tablet), each with its own token.
 *  2. Notification dispatch — when an approval is needed, find all approvers
 *     in the project, look up their device tokens, and send a push to each.
 *
 * These tests mock Prisma and firebase-admin so they run without a database
 * or Firebase credentials. An in-memory store simulates the push_subscriptions
 * table so we can assert on state changes.
 *
 * Properties verified:
 *  - Subscriptions are upserted (same token = update, not duplicate)
 *  - Removing subscriptions works by user+token or by token alone
 *  - getSubscriptionStatus correctly reports enabled/disabled
 *  - notifyApprovers sends to all approver devices in the project
 *  - Invalid FCM tokens (uninstalled app, etc.) are cleaned up after a failure
 *  - Firebase send failures are swallowed (don't break the approval workflow)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRole } from '@hospital-erp/shared';

// In-memory push subscription store that simulates the push_subscriptions table.
// Each entry represents one device registered by one user.
const subStore: { userId: string; token: string; isActive: boolean; userAgent?: string }[] = [];

// Mock Prisma so the push service talks to our in-memory store instead of Postgres.
vi.mock('../src/config/prisma', () => ({
  prisma: {
    pushSubscription: {
      // upsert: if the token exists, update it (re-bind to a new user);
      // otherwise create a new subscription.
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const idx = subStore.findIndex((s) => s.token === where.token);
        if (idx >= 0) {
          subStore[idx] = { ...subStore[idx], ...update };
        } else {
          subStore.push({ ...create });
        }
        return subStore.find((s) => s.token === where.token)!;
      }),
      // deleteMany: supports deletion by token, by user+token, or by token-in-list.
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = subStore.length;
        for (let i = subStore.length - 1; i >= 0; i--) {
          const s = subStore[i];
          if (where.token && where.token === s.token) {
            subStore.splice(i, 1);
          } else if (where.userId && where.userId === s.userId && where.token === s.token) {
            subStore.splice(i, 1);
          } else if (where.userId && where.userId === s.userId && !where.token) {
            subStore.splice(i, 1);
          } else if (where.token && where.token.in && where.token.in.includes(s.token)) {
            subStore.splice(i, 1);
          }
        }
        return { count: before - subStore.length };
      }),
      // count: used by getSubscriptionStatus to check if a user has any active subs.
      count: vi.fn(async ({ where }: any) => {
        return subStore.filter(
          (s) => s.userId === where.userId && s.isActive === where.isActive
        ).length;
      }),
      // findMany: used by notifyApprovers to get all tokens for a set of users.
      findMany: vi.fn(async ({ where, select }: any) => {
        let results = subStore.filter((s) => s.isActive === true);
        if (where.userId?.in) {
          results = results.filter((s) => where.userId.in.includes(s.userId));
        }
        return results.map((s) => (select?.token ? { token: s.token } : s));
      }),
    },
    // user.findMany: used by notifyApprovers to find all approvers in a project.
    user: {
      findMany: vi.fn(async ({ where, select }: any) => {
        const roles = where.role?.in ?? [];
        // Synthetic approver rows for project "p1".
        const users = [
          { id: 'user-head', role: UserRole.PROJECT_HEAD, projectId: 'p1', isActive: true },
          { id: 'user-hoc', role: UserRole.HEAD_OF_CONSTRUCTION, projectId: 'p1', isActive: true },
        ];
        return users
          .filter((u) => u.projectId === where.projectId && u.isActive === where.isActive)
          .filter((u) => roles.includes(u.role))
          .map((u) => (select?.id ? { id: u.id } : u));
      }),
    },
  },
}));

// Mock Firebase Admin so we don't need real Firebase credentials.
vi.mock('../src/config/firebase', () => ({
  getFirebaseApp: vi.fn(() => ({})),
}));

// Mock the FCM messaging function so we can assert on what was sent.
const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin', () => ({
  default: {
    messaging: () => ({ sendEachForMulticast }),
  },
}));

import {
  saveSubscription,
  removeSubscription,
  removeSubscriptionByToken,
  getSubscriptionStatus,
  notifyApprovers,
} from '../src/services/push.service';

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION MANAGEMENT — registering and unregistering devices.
// ─────────────────────────────────────────────────────────────────────────────
describe('Push Service — subscription management', () => {
  beforeEach(() => {
    // Start each test with an empty subscription store.
    subStore.length = 0;
    vi.clearAllMocks();
  });

  it('saveSubscription creates a new active subscription for a first-time device', async () => {
    // When a user opens the app for the first time, the frontend sends their
    // FCM token to the backend. We store it so we can send push notifications.
    await saveSubscription('user-1', 'token-A', 'browser');
    expect(subStore).toHaveLength(1);
    expect(subStore[0]).toEqual({
      userId: 'user-1',
      token: 'token-A',
      isActive: true,
      userAgent: 'browser',
    });
  });

  it('saveSubscription upserts an existing token (re-binds it to a new user instead of duplicating)', async () => {
    // If a user logs out and another user logs in on the same device, the
    // FCM token stays the same but the userId changes. We update the row
    // rather than creating a duplicate — otherwise we'd send notifications
    // to the wrong user.
    await saveSubscription('user-1', 'token-A', 'browser');
    await saveSubscription('user-2', 'token-A', 'new-browser');

    expect(subStore).toHaveLength(1); // no duplicate
    expect(subStore[0].userId).toBe('user-2'); // re-bound to the new user
    expect(subStore[0].userAgent).toBe('new-browser');
  });

  it('removeSubscription deletes a specific user+token pair (used when a user logs out)', async () => {
    // A user logging out should stop getting notifications on that device,
    // but their other devices (tablet, etc.) should keep working.
    await saveSubscription('user-1', 'token-A');
    await saveSubscription('user-1', 'token-B');
    await removeSubscription('user-1', 'token-A');

    expect(subStore).toHaveLength(1);
    expect(subStore[0].token).toBe('token-B'); // token-A was removed, token-B remains
  });

  it('removeSubscriptionByToken deletes by token alone (used for FCM cleanup)', async () => {
    // When FCM tells us a token is permanently invalid (app uninstalled),
    // we delete it by token — we don't know or care which user it belonged to.
    await saveSubscription('user-1', 'token-A');
    await removeSubscriptionByToken('token-A');
    expect(subStore).toHaveLength(0);
  });

  it('getSubscriptionStatus reports enabled=true when the user has at least one active subscription', async () => {
    // The frontend uses this to show the bell-icon toggle in settings.
    await saveSubscription('user-1', 'token-A');
    const status = await getSubscriptionStatus('user-1');
    expect(status.enabled).toBe(true);
    expect(status.subscriptionCount).toBe(1);
  });

  it('getSubscriptionStatus reports enabled=false when the user has no active subscriptions', async () => {
    // A user who never opened the app, or who unregistered all devices.
    const status = await getSubscriptionStatus('user-without-subs');
    expect(status.enabled).toBe(false);
    expect(status.subscriptionCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION DISPATCH — sending approval requests to approvers.
// ─────────────────────────────────────────────────────────────────────────────
describe('Push Service — notifyApprovers (approval request dispatch)', () => {
  beforeEach(() => {
    subStore.length = 0;
    sendEachForMulticast.mockReset();
  });

  it('sends a push notification to every approver device in the project', async () => {
    // The core feature: when a supervisor creates a payment request, every
    // approver (Project Head, Head of Construction, etc.) gets a push
    // notification on every device they've registered.
    await saveSubscription('user-head', 'device-1');
    await saveSubscription('user-hoc', 'device-2');

    sendEachForMulticast.mockResolvedValue({ successCount: 2, failureCount: 0, responses: [] });

    await notifyApprovers('p1', [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION], {
      approvalId: 'ap-1',
      entityType: 'PAYMENT_REQUEST',
      entityId: 'pr-1',
      title: 'Approval needed',
      body: 'Please review',
      url: '/approvals/1',
    });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const message = sendEachForMulticast.mock.calls[0][0];
    // Both devices should be in the recipient list.
    expect(message.tokens).toEqual(expect.arrayContaining(['device-1', 'device-2']));
    // The notification title and body come from the payload.
    expect(message.notification.title).toBe('Approval needed');
    // The data payload carries deep-link info so the app can open the right screen.
    expect(message.data.approvalId).toBe('ap-1');
    expect(message.data.type).toBe('approval_request');
  });

  it('does not call Firebase when there are no approvers with the requested roles', async () => {
    // If nobody in the project has the ADMIN role (e.g. it's a small project),
    // don't waste an FCM API call — just log and return.
    await notifyApprovers('p1', [UserRole.ADMIN], {
      approvalId: 'ap-2',
      entityType: 'PAYMENT_REQUEST',
      entityId: 'pr-2',
      title: 'x',
      body: 'y',
      url: '/x',
    });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('does not call Firebase when approvers exist but none have registered a device', async () => {
    // Approvers exist in the project but haven't installed the app yet (no
    // push subscriptions). Silently skip — there's nobody to push to.
    await notifyApprovers('p1', [UserRole.PROJECT_HEAD], {
      approvalId: 'ap-3',
      entityType: 'PAYMENT_REQUEST',
      entityId: 'pr-3',
      title: 'x',
      body: 'y',
      url: '/x',
    });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('cleans up invalid FCM tokens after a partial delivery failure', async () => {
    // FCM returns per-token success/failure. If a token is permanently invalid
    // (app uninstalled, OS update changed the token, etc.), FCM returns an
    // error code. We delete those tokens so we never try to send to them again
    // — sending to dead tokens wastes FCM quota.
    await saveSubscription('user-head', 'valid-token');
    await saveSubscription('user-hoc', 'invalid-token');

    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, error: null },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
    });

    await notifyApprovers('p1', [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION], {
      approvalId: 'ap-4',
      entityType: 'PAYMENT_REQUEST',
      entityId: 'pr-4',
      title: 'x',
      body: 'y',
      url: '/x',
    });

    // The invalid token should be removed from the store.
    expect(subStore.find((s) => s.token === 'invalid-token')).toBeUndefined();
    // The valid token should still be there.
    expect(subStore.find((s) => s.token === 'valid-token')).toBeDefined();
  });

  it('swallows Firebase send failures so the approval workflow is not broken', async () => {
    // If FCM is down (500) or rate-limiting us (429), the push notification
    // fails — but the approval request itself must still succeed. The user
    // can still see the pending approval in the app; they just don't get a
    // push notification this time.
    await saveSubscription('user-head', 'device-1');
    sendEachForMulticast.mockRejectedValue(new Error('FCM down'));

    await expect(
      notifyApprovers('p1', [UserRole.PROJECT_HEAD], {
        approvalId: 'ap-5',
        entityType: 'PAYMENT_REQUEST',
        entityId: 'pr-5',
        title: 'x',
        body: 'y',
        url: '/x',
      })
    ).resolves.toBeUndefined(); // does not throw
  });
});
