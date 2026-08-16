import { Response, NextFunction } from 'express';
import { Permission, hasPermission } from '@hospital-erp/shared';
import { AuthenticatedRequest } from './auth';

export function rbacMiddleware(requiredPermission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!hasPermission(req.user.role, requiredPermission)) {
      res.status(403).json({
        error: `Insufficient permissions. Required: ${requiredPermission}`,
      });
      return;
    }

    next();
  };
}
