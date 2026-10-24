import { Router, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { logger } from '../utils/logger';
import { QueryError, describeData, runDataQuery, type QueryCaller } from '../services/data-query/query';
import { readerRoleAvailable } from '../services/data-query/dbGuard';

// Read-only questions over any table the caller may read (used by Miko's
// query_data / describe_data tools). The project is always the caller's own,
// see services/data-query for the guard rails.
const router = Router();
router.use(authMiddleware);

const PER_MINUTE = 60;
const recent = new Map<string, number[]>();
function allow(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) {
    recent.set(userId, hits);
    return false;
  }
  hits.push(now);
  recent.set(userId, hits);
  return true;
}

function caller(req: AuthenticatedRequest): QueryCaller {
  const u = req.user!;
  return {
    role: u.role,
    extraPermissions: u.extraPermissions,
    projectId: requireProjectId(req),
    subject: { role: u.role, extraPermissions: u.directPermissions, moduleAccess: u.moduleAccess },
  };
}

// GET /data-query/tables[?model=PurchaseOrder] — what the caller may ask about.
router.get('/tables', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const model = typeof req.query.model === 'string' ? req.query.model.slice(0, 80) : undefined;
    res.json({ tables: await describeData(caller(req), model) });
  } catch (error) {
    if (error instanceof QueryError) {
      res.status(400).json({ error: error.message, code: 'DATA_QUERY_INVALID' });
      return;
    }
    next(error);
  }
});

// GET /data-query/status — whether the database enforces the reader role too.
router.get('/status', async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ readerRole: await readerRoleAvailable() });
});

// POST /data-query — one structured question (see querySpecSchema).
router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!allow(req.user!.id)) {
      res.status(429).json({ error: 'Too many data questions; wait a minute', code: 'DATA_QUERY_LIMIT' });
      return;
    }
    const result = await runDataQuery(caller(req), req.body);
    logger.info({
      event: 'data_query',
      userId: req.user!.id,
      model: result.model,
      rows: result.rows?.length ?? result.groups?.length ?? 0,
      dbRole: result.dbRole,
      ms: result.ms,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof QueryError) {
      res.status(400).json({ error: error.message, code: 'DATA_QUERY_INVALID' });
      return;
    }
    const message = (error as { message?: string })?.message ?? '';
    // A question too heavy for the time limit.
    if (message.includes('statement timeout')) {
      res.status(400).json({ error: 'That question took too long; narrow it (a period, a vendor, a status).', code: 'DATA_QUERY_TIMEOUT' });
      return;
    }
    // The database refused the reader role (a table or column added after the guard migration).
    if (message.includes('permission denied')) {
      logger.warn({ event: 'data_query_denied', userId: req.user!.id, message: message.slice(0, 300) });
      res.status(400).json({ error: 'That table or column is not open to data questions yet.', code: 'DATA_QUERY_DENIED' });
      return;
    }
    next(error);
  }
});

export default router;
