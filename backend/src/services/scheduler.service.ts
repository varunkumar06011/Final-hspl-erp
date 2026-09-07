import { prisma } from '../config/prisma';
import { QuotationStatus, UserRole } from '@hospital-erp/shared';
import { notifyAdmins } from './push.service';

// ─── Quotation Approval Aging Scheduler ─────────────────────────────
// Runs entirely on the backend (independent of any frontend activity).
// Checks every hour for quotations that have been pending approval for
// ≥ 24 hours. For each, if no AppNotification exists yet (dedup), sends
// a push notification to all admins and creates in-app notification
// entries.
//
// This ensures admins receive overdue notifications even if:
//   - The app is not open
//   - The app is not in recent tabs
//   - Nobody has loaded the QuotationsPage
//   - The admin added the app to home screen (PWA) and closed it
//
// Push delivery to closed apps is handled by Firebase Cloud Messaging
// (FCM) — the browser/OS service worker receives the push and displays
// it as a system notification, even when the web app is not running.

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours

let schedulerTimer: NodeJS.Timeout | null = null;

async function checkOverdueQuotations(): Promise<void> {
  try {
    const now = new Date();

    // Find all quotations across ALL projects that are still pending
    // approval with an approval workflow.
    const quotations = await prisma.quotation.findMany({
      where: {
        deletedAt: null,
        status: { in: [QuotationStatus.SUBMITTED, QuotationStatus.UNDER_REVIEW] },
        approvalWorkflow: { isNot: null },
      },
      select: {
        id: true,
        quotationNumber: true,
        grandTotal: true,
        projectId: true,
        approvalWorkflow: { select: { id: true, createdAt: true } },
      },
    });

    // Filter to those with aging ≥ 24 hours
    const overdueQuotations = quotations.filter((q) => {
      const approvalRequestedAt = q.approvalWorkflow?.createdAt;
      if (!approvalRequestedAt) return false;
      return (now.getTime() - approvalRequestedAt.getTime()) >= ONE_DAY_MS;
    });

    if (overdueQuotations.length === 0) {
      return; // nothing to do
    }

    // Dedup: check which quotations already have notifications
    const existingNotifications = await prisma.appNotification.findMany({
      where: {
        entityId: { in: overdueQuotations.map((q) => q.id) },
        type: 'QUOTATION_APPROVAL_OVERDUE',
      },
      select: { entityId: true },
    });
    const alreadyNotified = new Set(existingNotifications.map((n) => n.entityId));

    const newOverdue = overdueQuotations.filter((q) => !alreadyNotified.has(q.id));

    if (newOverdue.length === 0) {
      return; // all already notified
    }

    // Get all admin users
    const admins = await prisma.user.findMany({
      where: { isActive: true, role: { in: [UserRole.ADMIN, UserRole.ADMIN_2] } },
      select: { id: true },
    });

    if (admins.length === 0) {
      console.log('[Scheduler] No admin users found — skipping overdue notifications');
      return;
    }

    // Create in-app notifications (one per admin × per overdue quotation)
    const notificationData: Array<{
      userId: string;
      projectId: string;
      type: string;
      title: string;
      body: string;
      url: string;
      entityId: string;
      entityType: string;
    }> = [];

    for (const q of newOverdue) {
      const agingHours = Math.floor(
        (now.getTime() - (q.approvalWorkflow?.createdAt?.getTime() ?? now.getTime())) / (1000 * 60 * 60)
      );
      const agingDays = Math.floor(agingHours / 24);
      const agingLabel = agingDays > 0 ? `${agingDays} day${agingDays === 1 ? '' : 's'}` : `${agingHours} hours`;

      for (const admin of admins) {
        notificationData.push({
          userId: admin.id,
          projectId: q.projectId,
          type: 'QUOTATION_APPROVAL_OVERDUE',
          title: '🔴 Quotation Approval Required',
          body: `Quotation ${q.quotationNumber} has been pending approval since ${agingLabel}. Total: ₹${Number(q.grandTotal).toLocaleString('en-IN')}`,
          url: `/quotations?approval=${q.approvalWorkflow?.id ?? ''}`,
          entityId: q.id,
          entityType: 'QUOTATION',
        });
      }
    }

    // Batch create all in-app notifications
    if (notificationData.length > 0) {
      await prisma.appNotification.createMany({ data: notificationData });
    }

    // Send push notifications (one per quotation, batched to all admins)
    let pushSent = 0;
    for (const q of newOverdue) {
      try {
        await notifyAdmins({
          entityType: 'QUOTATION',
          entityId: q.id,
          title: 'Pending Approval',
          body: `Quotation #${q.quotationNumber} has been pending approval for 1 day. Please review and confirm.`,
          url: `/quotations?approval=${q.approvalWorkflow?.id ?? ''}`,
        });
        pushSent++;
      } catch (pushError) {
        console.error(`[Scheduler] Push failed for ${q.quotationNumber} (non-fatal):`, pushError);
      }
    }

    console.log(
      `[Scheduler] Quotation aging check: ${quotations.length} pending, ${overdueQuotations.length} overdue, ${newOverdue.length} new notifications, ${pushSent} push(s) sent`
    );
  } catch (error) {
    console.error('[Scheduler] Quotation aging check failed:', error);
  }
}

/**
 * Start the quotation approval aging scheduler.
 * Runs an initial check immediately, then every hour.
 * Safe to call multiple times — won't create duplicate timers.
 */
export function startQuotationAgingScheduler(): void {
  if (schedulerTimer) {
    console.log('[Scheduler] Quotation aging scheduler already running');
    return;
  }

  console.log('[Scheduler] Starting quotation approval aging scheduler (checks every 1 hour)');

  // Run an initial check 30 seconds after startup (give the server time to settle)
  setTimeout(() => {
    checkOverdueQuotations().catch((err) =>
      console.error('[Scheduler] Initial aging check failed:', err)
    );
  }, 30000);

  // Then check every hour
  schedulerTimer = setInterval(() => {
    checkOverdueQuotations().catch((err) =>
      console.error('[Scheduler] Periodic aging check failed:', err)
    );
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the scheduler (for testing or graceful shutdown).
 */
export function stopQuotationAgingScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Scheduler] Quotation aging scheduler stopped');
  }
}
