import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { prisma } from '../config/prisma';
import {
  saveSubscription,
  removeSubscription,
  getSubscriptionStatus,
} from '../services/push.service';

const router = Router();
router.use(authMiddleware);

// Allowed notification event types (matches push.service send categories).
const NOTIFICATION_EVENT_TYPES = ['entity_created', 'approval_request', 'approval_result'] as const;
const updatePrefsSchema = z.object({
  body: z.object({
    prefs: z.record(z.enum(NOTIFICATION_EVENT_TYPES), z.boolean()),
  }),
});

// POST /notifications/subscribe — save FCM token for the current user/device
router.post(
  '/subscribe',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ error: 'FCM token is required' });
        return;
      }

      const userAgent = req.headers['user-agent'] || undefined;
      await saveSubscription(req.user!.id, token, userAgent);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /notifications/subscribe — remove FCM token for the current user/device
router.delete(
  '/subscribe',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body as { token?: string };
      if (!token) {
        res.status(400).json({ error: 'FCM token is required' });
        return;
      }

      await removeSubscription(req.user!.id, token);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /notifications/status — check current user's notification subscription status
router.get(
  '/status',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const status = await getSubscriptionStatus(req.user!.id);
      res.json(status);
    } catch (error) {
      next(error);
    }
  }
);

// GET /notifications/preferences — get current user's notification preferences
router.get(
  '/preferences',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { notificationPrefs: true },
      });
      // Default: all event types enabled.
      const prefs = (user?.notificationPrefs as Record<string, boolean> | null) ?? {};
      const defaults = Object.fromEntries(NOTIFICATION_EVENT_TYPES.map((t) => [t, prefs[t] !== false]));
      res.json({ prefs: defaults });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /notifications/preferences — update current user's notification preferences
router.patch(
  '/preferences',
  validateMiddleware(updatePrefsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { prefs } = req.body as { prefs: Record<string, boolean> };
      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: { notificationPrefs: prefs },
        select: { notificationPrefs: true },
      });
      const normalized = Object.fromEntries(
        NOTIFICATION_EVENT_TYPES.map((t) => [t, (updated.notificationPrefs as Record<string, boolean>)?.[t] !== false]),
      );
      res.json({ prefs: normalized });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
