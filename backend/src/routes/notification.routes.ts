import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
  saveSubscription,
  removeSubscription,
  getSubscriptionStatus,
} from '../services/push.service';

const router = Router();
router.use(authMiddleware);

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

export default router;
