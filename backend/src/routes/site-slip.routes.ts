/**
 * /api/inventory/site-slips — daily site material slips (see site-slip.service).
 *   GET  /?date=YYYY-MM-DD&mine=1   slips of a day + per-material totals
 *   GET  /history?from=&to=         day-wise used / returned per material
 *   POST /take                      { lines: [{ itemId, quantity }], work? }  morning: taken (stock down)
 *   POST /:id/close                 { lines: [{ lineId, usedQty, returnedQty }] }  evening: used / returned
 */
import { Router, Response, NextFunction } from 'express';
import { AuditAction, Permission } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { logAudit } from '../services/audit.service';
import { SlipError, closeSlip, listSlips, parseSlipDate, siteToday, takeMaterial, usageHistory } from '../services/site-slip.service';

const router = Router();
router.use(authMiddleware);

const actorOf = (req: AuthenticatedRequest) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });

function fail(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof SlipError) {
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }
  next(err);
}

router.get('/', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const date = req.query.date ? parseSlipDate(req.query.date) : siteToday();
    if (!date) {
      res.status(400).json({ error: 'Date must look like 2026-11-20' });
      return;
    }
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    res.json(await listSlips(projectId, date, mine ? req.user!.id : undefined));
  } catch (err) {
    fail(err, res, next);
  }
});

// GET /history?from=YYYY-MM-DD&to=YYYY-MM-DD — how much of each material was used on each day.
router.get('/history', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const to = req.query.to ? parseSlipDate(req.query.to) : siteToday();
    const from = req.query.from ? parseSlipDate(req.query.from) : to ? new Date(to.getTime() - 29 * 86_400_000) : null;
    if (!from || !to) {
      res.status(400).json({ error: 'Dates must look like 2026-11-20' });
      return;
    }
    res.json(await usageHistory(projectId, from, to));
  } catch (err) {
    fail(err, res, next);
  }
});

router.post('/take', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const slip = await takeMaterial(projectId, actorOf(req), { lines: req.body?.lines, work: req.body?.work });
    await logAudit({
      userId: req.user!.id,
      action: slip.created ? AuditAction.CREATE : AuditAction.UPDATE,
      entityType: 'SITE_MATERIAL_SLIP',
      entityId: slip.id,
      projectId,
      newValue: { slipNumber: slip.slipNumber, taken: req.body?.lines },
    });
    res.status(201).json(slip);
  } catch (err) {
    fail(err, res, next);
  }
});

router.post('/:id/close', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const slip = await closeSlip(projectId, actorOf(req), req.params.id, { lines: req.body?.lines });
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'SITE_MATERIAL_SLIP',
      entityId: slip.id,
      projectId,
      newValue: { slipNumber: slip.slipNumber, status: 'CLOSED', lines: req.body?.lines },
    });
    res.json(slip);
  } catch (err) {
    fail(err, res, next);
  }
});

export default router;
