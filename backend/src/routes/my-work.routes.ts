import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { getMyWork } from '../services/my-work.service';

const router = Router();

// GET /api/my-work — what needs the signed-in user, and what they started.
// Read-only; scoped to the user's current project. Open to every signed-in
// user: each list is built from what their own role may act on.
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const data = await getMyWork(requireProjectId(req), {
      id: user.id,
      role: user.role,
      extraPermissions: user.extraPermissions,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
