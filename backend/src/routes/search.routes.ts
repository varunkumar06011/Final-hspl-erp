import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { APP_MODULES, isModuleSwitchedOff } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { searchProject } from '../services/search/manager';

const router = Router();
router.use(authMiddleware);

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  perType: z.coerce.number().int().min(1).max(50).default(8),
  // Comma-separated model names to restrict the search to, e.g. "PurchaseOrder,Vendor".
  types: z.string().max(500).optional(),
});

// GET /search?q=cement 53 — typo-tolerant search across every record in the
// caller's project (including line items, comments and attachments), limited
// to what the caller's role may see. Read-only; backed by an in-memory index.
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.json({ query: '', tookMs: 0, total: 0, counts: {}, results: [] });
      return;
    }
    const { q, limit, perType, types } = parsed.data;
    const response = await searchProject({
      projectId: requireProjectId(req),
      role: req.user!.role,
      extraPermissions: req.user!.extraPermissions,
      // Records of modules an admin switched off for this user are left out.
      hiddenPaths: APP_MODULES.filter(
        (m) => m.path && isModuleSwitchedOff(
          { role: req.user!.role, extraPermissions: req.user!.directPermissions, moduleAccess: req.user!.moduleAccess },
          m.key,
        ),
      ).map((m) => m.path!),
      query: q,
      limit,
      perTypeLimit: perType,
      models: types ? types.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
