import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { getApprovalPopup } from '../services/approval-popup.service';

const router = Router();

// GET /api/approval-popup — requests waiting for the signed-in user, for the approval pop-up.
// Read-only. `enabled: false` (and no items) unless an admin switched the pop-up on for this user.
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    res.json(
      await getApprovalPopup(requireProjectId(req), {
        id: user.id,
        role: user.role,
        extraPermissions: user.extraPermissions ?? [],
      }),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
