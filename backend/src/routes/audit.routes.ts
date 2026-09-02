import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { Permission } from '@hospital-erp/shared';
import { getAuditLogs } from '../services/audit.service';
import { AuthenticatedRequest } from '../middleware/auth';
import { Response, NextFunction } from 'express';

const router = Router();

router.get(
  '/',
  authMiddleware,
  rbacMiddleware(Permission.VIEW_AUDIT_LOG),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'No project assigned to user' });
        return;
      }

      const filters = {
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId as string | undefined,
        userId: req.query.userId as string | undefined,
        action: req.query.action as string | undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 20,
      };

      const result = await getAuditLogs(projectId, filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

export default router;
