import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { listRelatedRecords } from '../services/related-records.service';

const router = Router();
router.use(authMiddleware);

// GET /?entityType=PO&entityId=<uuid> — records linked to a procurement record
// (MPR -> quotation -> PO -> gate pass / receipt / invoice -> payment), grouped by type.
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { entityType, entityId } = req.query as Record<string, string | undefined>;
    if (!entityType || !entityId || !/^[0-9a-f-]{36}$/i.test(entityId)) {
      res.status(400).json({ error: 'entityType and a valid entityId are required' });
      return;
    }
    const data = await listRelatedRecords(requireProjectId(req), req.user!.role, entityType, entityId);
    if (!data) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
