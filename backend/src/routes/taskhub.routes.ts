import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import {
  SECRET_HEADER,
  TaskHubLinkError,
  createLinkCode,
  getTaskHubApprovals,
  isTaskHubConfigured,
  isValidTaskHubSecret,
  redeemLinkCode,
} from '../services/taskhub.service';

// /api/integrations/taskhub — see services/taskhub.service.ts.
const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_CONFIGURED = { error: 'Task Hub is not connected on this server.', code: 'TASKHUB_NOT_CONFIGURED' } as const;

/** Server-to-server calls from Task Hub's backend carry the shared secret. */
function requireTaskHub(req: Request, res: Response, next: NextFunction): void {
  if (!isTaskHubConfigured()) {
    res.status(503).json(NOT_CONFIGURED);
    return;
  }
  if (!isValidTaskHubSecret(req.headers[SECRET_HEADER])) {
    res.status(401).json({ error: 'Unauthorized', code: 'TASKHUB_UNAUTHORIZED' });
    return;
  }
  next();
}

function sendLinkError(res: Response, err: unknown): boolean {
  if (!(err instanceof TaskHubLinkError)) return false;
  res.status(err.code === 'NOT_ALLOWED' ? 403 : 400).json({ error: err.message, code: err.code });
  return true;
}

// POST /link-code — the signed-in approver gets a 6-digit code to type into Task Hub.
router.post('/link-code', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!isTaskHubConfigured()) {
      res.status(503).json(NOT_CONFIGURED);
      return;
    }
    const user = req.user!;
    const { code, expiresAt } = createLinkCode({
      id: user.id,
      role: user.role,
      extraPermissions: user.extraPermissions,
    });
    res.json({ code, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    if (!sendLinkError(res, err)) next(err);
  }
});

// POST /link { code } — Task Hub redeems a code and learns the ERP user it belongs to.
router.post('/link', requireTaskHub, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    res.json({ user: await redeemLinkCode(code) });
  } catch (err) {
    if (!sendLinkError(res, err)) next(err);
  }
});

// GET /approvals?erpUserId= — what waits on that user's decision, in every live project.
router.get('/approvals', requireTaskHub, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const erpUserId = typeof req.query.erpUserId === 'string' ? req.query.erpUserId : '';
    if (!UUID.test(erpUserId)) {
      res.status(400).json({ error: 'erpUserId is required', code: 'VALIDATION_ERROR' });
      return;
    }
    res.json(await getTaskHubApprovals(erpUserId));
  } catch (err) {
    next(err);
  }
});

export default router;
