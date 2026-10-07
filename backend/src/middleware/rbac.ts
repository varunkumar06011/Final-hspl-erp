import { Response, NextFunction } from 'express';
import { Permission, UserRole, hasPermission, isAdminRole } from '@hospital-erp/shared';
import { AuthenticatedRequest } from './auth';

export function rbacMiddleware(requiredPermission: Permission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!hasPermission(req.user.role, requiredPermission, req.user.extraPermissions)) {
      res.status(403).json({
        error: `Insufficient permissions. Required: ${requiredPermission}`,
      });
      return;
    }

    next();
  };
}

/**
 * Finance masters (budget heads and the like): Admins and Supervisors are always allowed,
 * on top of anyone holding MANAGE_FINANCE through their role or personal grants.
 */
export function rbacFinanceManager(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { role, extraPermissions } = req.user;
  if (hasPermission(role, Permission.MANAGE_FINANCE, extraPermissions) || isAdminRole(role) || role === UserRole.SUPERVISOR) {
    next();
    return;
  }
  res.status(403).json({ error: 'Only Admins, Supervisors and finance managers can change budget heads' });
}
