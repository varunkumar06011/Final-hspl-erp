import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuditAction, isAdminRole, isSuperAdmin } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { backfillFingerprints, labelEntity, locateFile, SOFT_DUPLICATE_DAYS, type EntityRef } from '../services/duplicate.service';

/**
 * Possible duplicates for admins to reconcile: same file uploaded twice, same shop/vendor + amount
 * within a few days, a proof number used twice. Also lists proof numbers issued but never used.
 */
const router = Router();
router.use(authMiddleware);

router.use((req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const u = req.user!;
  if (isAdminRole(u.role) || isSuperAdmin(u.directPermissions)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Only admins can see possible duplicates' });
});

const listSchema = z.object({
  query: z.object({
    status: z.enum(['OPEN', 'GENUINE', 'DUPLICATE', 'ALL']).default('OPEN'),
    kind: z.enum(['FILE', 'AMOUNT', 'PROOF_REUSE']).optional(),
  }),
});
const reviewSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ status: z.enum(['GENUINE', 'DUPLICATE', 'OPEN']), note: z.string().trim().max(1000).optional() }),
});

// GET / - flags with the records they point at
router.get('/', validateMiddleware(listSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const { status, kind } = req.query as { status?: string; kind?: string };
    const where = { projectId, ...(status && status !== 'ALL' ? { status } : {}), ...(kind ? { kind } : {}) };
    const [flags, counts] = await Promise.all([
      prisma.duplicateFlag.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.duplicateFlag.groupBy({ by: ['status'], where: { projectId }, _count: true }),
    ]);
    const fps = await prisma.fileFingerprint.findMany({
      where: { id: { in: flags.flatMap((f) => [f.fingerprintId, f.matchedFingerprintId]).filter((x): x is string => !!x) } },
    });
    const fpById = new Map(fps.map((f) => [f.id, f]));
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(flags.flatMap((f) => [f.uploadedBy, f.reviewedBy]).filter((x): x is string => !!x))] } },
      select: { id: true, name: true },
    });
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const data = await Promise.all(
      flags.map(async (f) => {
        const fp = f.fingerprintId ? fpById.get(f.fingerprintId) : undefined;
        const mfp = f.matchedFingerprintId ? fpById.get(f.matchedFingerprintId) : undefined;
        let record: EntityRef | null = f.entityType && f.entityId ? await labelEntity(f.entityType, f.entityId) : null;
        if (!record && fp) record = await locateFile(fp.filePath);
        let matched: EntityRef | null = f.matchedEntityType && f.matchedEntityId ? await labelEntity(f.matchedEntityType, f.matchedEntityId) : null;
        if (!matched && mfp) matched = await locateFile(mfp.filePath);
        return {
          id: f.id,
          kind: f.kind,
          status: f.status,
          reason: f.reason,
          createdAt: f.createdAt,
          uploadedBy: f.uploadedBy ? userName.get(f.uploadedBy) ?? null : null,
          reviewedBy: f.reviewedBy ? userName.get(f.reviewedBy) ?? null : null,
          reviewedAt: f.reviewedAt,
          reviewNote: f.reviewNote,
          proofNumber: f.proofNumber,
          vendorName: f.vendorName,
          amount: f.amount != null ? Number(f.amount) : null,
          fileName: fp?.fileName ?? null,
          matchedFileName: mfp?.fileName ?? null,
          record,
          matched,
        };
      }),
    );
    const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
    res.json({ data, counts: { open: count('OPEN'), genuine: count('GENUINE'), duplicate: count('DUPLICATE') }, softDuplicateDays: SOFT_DUPLICATE_DAYS });
  } catch (err) {
    next(err);
  }
});

// POST /:id/review - mark genuine / confirmed duplicate (or reopen)
router.post('/:id/review', validateMiddleware(reviewSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const flag = await prisma.duplicateFlag.findFirst({ where: { id: req.params.id, projectId } });
    if (!flag) {
      res.status(404).json({ error: 'Flag not found' });
      return;
    }
    const { status, note } = req.body;
    const updated = await prisma.duplicateFlag.update({
      where: { id: flag.id },
      data: status === 'OPEN' ? { status, reviewedBy: null, reviewedAt: null, reviewNote: null } : { status, reviewedBy: req.user!.id, reviewedAt: new Date(), reviewNote: note || null },
    });
    await logAudit({
      userId: req.user!.id,
      action: AuditAction.UPDATE,
      entityType: 'DUPLICATE_FLAG',
      entityId: flag.id,
      projectId,
      oldValue: { status: flag.status },
      newValue: { status, note: note ?? null, kind: flag.kind, reason: flag.reason },
    });
    res.json({ id: updated.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

// GET /unused-proofs - proof numbers issued but never used on an upload
router.get('/unused-proofs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const rows = await prisma.proofNumber.findMany({ where: { projectId, usedAt: null }, orderBy: { issuedAt: 'desc' }, take: 300 });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.issuedBy))] } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    res.json({
      data: rows.map((r) => ({ id: r.id, number: r.number, baseType: r.baseType, baseNumber: r.baseNumber, issuedAt: r.issuedAt, issuedBy: name.get(r.issuedBy) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /backfill - fingerprint attachments uploaded before this feature (a batch per call)
router.post('/backfill', async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ fingerprinted: await backfillFingerprints(200) });
  } catch (err) {
    next(err);
  }
});

export default router;
