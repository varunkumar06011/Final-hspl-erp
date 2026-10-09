import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { getCombinedRecord, listCombinedRecords } from '../services/combined-records.service';

/**
 * Combined Records: one record per purchase (MPR → quotations → POs → delivery →
 * invoice → payment). Read-only; every action on the page goes through the normal
 * MPR / quotation / PO endpoints, so their permissions and checks still apply.
 */
const router = Router();
router.use(authMiddleware);

// GET /?q=&stage=&page=&pageSize=
router.get('/', rbacMiddleware(Permission.VIEW_MPR), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const q = req.query as Record<string, string | undefined>;
    res.json(
      await listCombinedRecords(projectId, req.user!, {
        q: typeof q.q === 'string' ? q.q.slice(0, 200) : undefined,
        stage: q.stage,
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || 25,
      }),
    );
  } catch (error) {
    next(error);
  }
});

// GET /:type/:id — type is mpr | quotation | po; any record of the chain opens the whole record
router.get('/:type/:id', rbacMiddleware(Permission.VIEW_MPR), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const record = await getCombinedRecord(projectId, req.user!, req.params.type, req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
