import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import {
  AuditAction,
  SocketEvents,
  hasFullModuleControl,
  canManageModuleAccess,
  normalizeModuleAccess,
  updateModuleAccessSchema,
  type ModuleAccessMap,
  type UpdateModuleAccessInput,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { emitToUsers } from '../socket';

// Module Access page: which modules each user sees. Users are shared by every
// project, so these lists are not project-scoped. Only Admin 1, Admin 2 and
// super admins may read or change them, and their own access is never overridden.
const router = Router();
router.use(authMiddleware);
router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const user = req.user!;
  if (!canManageModuleAccess(user.role, user.directPermissions)) {
    res.status(403).json({ error: 'You do not have permission to manage module access' });
    return;
  }
  next();
});

const USER_SELECT = {
  id: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  extraPermissions: true,
  moduleAccess: true,
} as const;

type AccessRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toDto(u: AccessRow) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    extraPermissions: u.extraPermissions,
    moduleAccess: normalizeModuleAccess(u.moduleAccess),
    fullControl: hasFullModuleControl(u.role, u.extraPermissions),
  };
}

// GET /api/module-access/users — every user with their module overrides
router.get('/users', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ select: USER_SELECT, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    res.json({ data: users.map(toDto) });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/module-access/users — switch modules on/off (or back to default) for one or more users
router.patch(
  '/users',
  validateMiddleware(updateModuleAccessSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { userIds, changes, replace } = req.body as UpdateModuleAccessInput;
      const targets = await prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SELECT });
      if (targets.length !== new Set(userIds).size) {
        res.status(404).json({ error: 'One or more users were not found' });
        return;
      }

      const editable = targets.filter((u) => !hasFullModuleControl(u.role, u.extraPermissions));
      const skipped = targets.length - editable.length;

      const updates: { before: ModuleAccessMap; after: ModuleAccessMap; user: AccessRow }[] = [];
      for (const user of editable) {
        const before = normalizeModuleAccess(user.moduleAccess);
        const after: ModuleAccessMap = replace ? {} : { ...before };
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) delete after[key];
          else after[key] = value;
        }
        updates.push({ before, after, user });
      }

      const saved = await prisma.$transaction(
        updates.map(({ user, after }) =>
          prisma.user.update({
            where: { id: user.id },
            data: { moduleAccess: Object.keys(after).length ? after : Prisma.DbNull },
            select: USER_SELECT,
          }),
        ),
      );

      await Promise.all(
        updates.map(({ user, before, after }) =>
          logAudit({
            userId: req.user!.id,
            action: AuditAction.UPDATE,
            entityType: 'UserModuleAccess',
            entityId: user.id,
            projectId: req.user!.projectId,
            oldValue: { user: user.name, moduleAccess: before },
            newValue: { user: user.name, moduleAccess: after },
          }),
        ),
      );

      // Open sessions of these users refresh their profile and sidebar.
      emitToUsers(saved.map((u) => u.id), SocketEvents.MODULE_ACCESS_CHANGED, {});

      res.json({ data: saved.map(toDto), skipped });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
