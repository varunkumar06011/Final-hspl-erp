import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuditAction } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { labelEntity } from '../services/duplicate.service';
import {
  ProofError,
  issueChainProof,
  issueSiteBillProof,
  listChainProofs,
  listOpenSiteBillProofs,
  PROOF_ENTITY_TYPES,
} from '../services/proof.service';

/**
 * Proof numbers: GET lists the numbers issued on a record's chain, POST issues the next one
 * (only when someone clicks "Get proof number"), GET /lookup finds where a written number went.
 */
const router = Router();
router.use(authMiddleware);

const issueSchema = z.object({
  body: z.object({ entityType: z.enum(PROOF_ENTITY_TYPES), entityId: z.string().uuid() }),
});
const listSchema = z.object({
  query: z.object({ entityType: z.enum(PROOF_ENTITY_TYPES), entityId: z.string().uuid() }),
});

function fail(res: Response, next: NextFunction, err: unknown) {
  if (err instanceof ProofError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// GET /?entityType=&entityId= - numbers issued on this record's chain
router.get('/', validateMiddleware(listSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const q = req.query as { entityType: string; entityId: string };
    res.json(await listChainProofs(requireProjectId(req), q.entityType, q.entityId));
  } catch (err) {
    fail(res, next, err);
  }
});

// POST / - issue the next number of this record's chain
router.post('/', validateMiddleware(issueSchema), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const issued = await issueChainProof(projectId, req.user!.id, req.body.entityType, req.body.entityId);
    await logAudit({ userId: req.user!.id, action: AuditAction.CREATE, entityType: 'PROOF_NUMBER', entityId: issued.id, projectId, newValue: { number: issued.number } });
    res.status(201).json(issued);
  } catch (err) {
    fail(res, next, err);
  }
});

// GET /site-bill - site-bill numbers this user issued and has not used yet
router.get('/site-bill', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await listOpenSiteBillProofs(requireProjectId(req), req.user!.id) });
  } catch (err) {
    fail(res, next, err);
  }
});

// POST /site-bill - issue the next site-bill number
router.post('/site-bill', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const issued = await issueSiteBillProof(projectId, req.user!.id);
    await logAudit({ userId: req.user!.id, action: AuditAction.CREATE, entityType: 'PROOF_NUMBER', entityId: issued.id, projectId, newValue: { number: issued.number } });
    res.status(201).json(issued);
  } catch (err) {
    fail(res, next, err);
  }
});

// GET /lookup?number= - where a number written on a paper was used
router.get('/lookup', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const number = String(req.query.number ?? '').trim().toUpperCase();
    if (!number) {
      res.status(400).json({ error: 'number is required' });
      return;
    }
    const p = await prisma.proofNumber.findUnique({ where: { projectId_number: { projectId, number } } });
    if (!p) {
      res.status(404).json({ error: 'No such proof number' });
      return;
    }
    const where = p.usedOnType && p.usedOnId ? await labelEntity(p.usedOnType, p.usedOnId) : null;
    const issuer = await prisma.user.findUnique({ where: { id: p.issuedBy }, select: { name: true } });
    res.json({ number: p.number, issuedAt: p.issuedAt, issuedBy: issuer?.name ?? null, usedAt: p.usedAt, reuseCount: p.reuseCount, usedOn: where });
  } catch (err) {
    fail(res, next, err);
  }
});

export default router;
