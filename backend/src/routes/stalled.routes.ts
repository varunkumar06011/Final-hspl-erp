import { Router, Response, NextFunction } from 'express';
import { Permission, hasPermission, isModuleSwitchedOff } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { findStalled, StalledScope, STALLED_AFTER_MS } from '../services/stalled.service';

const router = Router();
router.use(authMiddleware);

// GET /stalled: approved records of the procurement chain that have waited
// STALLED_AFTER_MS without reaching the next step. Only the modules the caller
// may see are included. Read-only.
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const can = (permission: Permission, moduleKey: string) =>
      hasPermission(user.role, permission, user.extraPermissions) &&
      !isModuleSwitchedOff({ role: user.role, extraPermissions: user.directPermissions, moduleAccess: user.moduleAccess }, moduleKey);
    const scope: StalledScope = {
      MPR: can(Permission.VIEW_MPR, 'mpr'),
      QUOTATION: can(Permission.VIEW_FINANCIALS, 'quotations'),
      PO: can(Permission.VIEW_FINANCIALS, 'purchaseOrders'),
      GOODS_RECEIPT: can(Permission.MANAGE_INVENTORY, 'goodsReceipts'),
      INVOICE: can(Permission.VIEW_FINANCIALS, 'invoices'),
      PAYMENT_REQUEST: can(Permission.VIEW_FINANCIALS, 'payments'),
    };
    const items = await findStalled(requireProjectId(req), scope);
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
    res.json({ thresholdMinutes: STALLED_AFTER_MS / 60000, total: items.length, counts, items });
  } catch (err) {
    next(err);
  }
});

export default router;
