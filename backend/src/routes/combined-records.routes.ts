import { Router, Response, NextFunction } from 'express';
import { Permission } from '@hospital-erp/shared';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { getCombinedRecord, listCombinedRecords } from '../services/combined-records.service';
import { MAX_PROOF_KEYS, buildCombinedProofPdf, listCombinedProofs } from '../services/combined-proofs.service';

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

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

// GET /:type/:id/proofs — system generated PDFs and uploaded files of the whole record
router.get('/:type/:id/proofs', rbacMiddleware(Permission.VIEW_MPR), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!validId(req.params.id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const data = await listCombinedProofs(requireProjectId(req), req.user!.role, req.params.type, req.params.id);
    if (!data) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// POST /:type/:id/proof-pdf { keys } — the chosen proofs merged into one PDF (to print or save)
router.post('/:type/:id/proof-pdf', rbacMiddleware(Permission.VIEW_MPR), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!validId(req.params.id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const keys: unknown = req.body?.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_PROOF_KEYS || !keys.every((k) => typeof k === 'string' && k.length <= 120)) {
      res.status(400).json({ error: `keys must list 1 to ${MAX_PROOF_KEYS} proofs` });
      return;
    }
    const result = await buildCombinedProofPdf(requireProjectId(req), req.user!.role, req.params.type, req.params.id, [...new Set(keys as string[])]);
    if (!result) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (result.included === 0) {
      res.status(422).json({ error: 'None of the selected files can be put into a PDF', skipped: result.skipped });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="proofs.pdf"');
    res.setHeader('X-Proof-Included', String(result.included));
    res.setHeader('X-Proof-Skipped', String(result.skipped.length));
    res.setHeader('Access-Control-Expose-Headers', 'X-Proof-Included, X-Proof-Skipped, Content-Disposition');
    res.send(result.pdf);
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
