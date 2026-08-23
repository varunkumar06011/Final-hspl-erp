import { prisma } from '../config/prisma';
import { getFirebaseApp } from '../config/firebase';
import admin from 'firebase-admin';
import { UserRole } from '@hospital-erp/shared';

// ─── Types ────────────────────────────────────────────────

export interface ApprovalNotificationPayload {
  approvalId: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  url: string;
}

// ─── Subscription management ──────────────────────────────

export async function saveSubscription(
  userId: string,
  token: string,
  userAgent?: string
): Promise<void> {
  // upsert — if token already exists for this user, update it; otherwise create
  await prisma.pushSubscription.upsert({
    where: { token },
    create: { userId, token, userAgent, isActive: true },
    update: { userId, userAgent, isActive: true, updatedAt: new Date() },
  });
  console.log(`[Push] Subscription saved for user ${userId}`);
}

export async function removeSubscription(userId: string, token: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({
    where: { userId, token },
  });
  console.log(`[Push] Subscription removed for user ${userId}`);
}

export async function removeSubscriptionByToken(token: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({
    where: { token },
  });
  console.log(`[Push] Subscription removed by token (cleanup)`);
}

export async function getSubscriptionStatus(userId: string): Promise<{
  enabled: boolean;
  subscriptionCount: number;
}> {
  const count = await prisma.pushSubscription.count({
    where: { userId, isActive: true },
  });
  return { enabled: count > 0, subscriptionCount: count };
}

// ─── Send push to specific users ──────────────────────────

async function sendPushToTokens(
  tokens: string[],
  payload: ApprovalNotificationPayload
): Promise<void> {
  if (tokens.length === 0) return;

  const app = getFirebaseApp();
  const messaging = admin.messaging(app);

  const message = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      type: 'approval_request',
      approvalId: payload.approvalId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: payload.title,
      body: payload.body,
      url: payload.url,
    },
    tokens,
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    console.log(
      `[Push] Sent to ${response.successCount}/${tokens.length} devices (approval ${payload.approvalId})`
    );

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens: string[] = [];
      response.responses.forEach((resp, index) => {
        if (!resp.success && resp.error) {
          const errorCode = resp.error.code;
          // FCM error codes that mean the token is permanently invalid
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-argument'
          ) {
            invalidTokens.push(tokens[index]);
          }
        }
      });

      if (invalidTokens.length > 0) {
        await prisma.pushSubscription.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        console.log(`[Push] Removed ${invalidTokens.length} invalid subscription(s)`);
      }
    }
  } catch (error) {
    console.error(`[Push] Failed to send push (approval ${payload.approvalId}):`, error);
  }
}

// ─── Notify approvers for an approval workflow ────────────

export async function notifyApprovers(
  projectId: string,
  approverRoles: UserRole[],
  payload: ApprovalNotificationPayload
): Promise<void> {
  // Find all active users in the project with one of the approver roles
  const approvers = await prisma.user.findMany({
    where: {
      projectId,
      isActive: true,
      role: { in: approverRoles as string[] },
    },
    select: { id: true },
  });

  if (approvers.length === 0) {
    console.log(`[Push] No approvers found for project ${projectId}, roles ${approverRoles.join(', ')}`);
    return;
  }

  const approverIds = approvers.map((a) => a.id);

  // Get all active push subscriptions for these approvers
  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: { in: approverIds },
      isActive: true,
    },
    select: { token: true },
  });

  const tokens = subscriptions.map((s) => s.token);

  if (tokens.length === 0) {
    console.log(`[Push] No push subscriptions for approvers in project ${projectId}`);
    return;
  }

  console.log(
    `[Push] Approval notification triggered — approval ${payload.approvalId}, ` +
    `${approvers.length} approver(s), ${tokens.length} device(s)`
  );

  await sendPushToTokens(tokens, payload);
}
