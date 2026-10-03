import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { logger } from '../utils/logger';
import { runChat, confirmAction, cancelAction, consumeDailyQuota, type AssistantUser } from '../services/assistant/engine';
import { AssistantProviderError } from '../services/assistant/gemini';

const router = Router();
router.use(authMiddleware);

const isConfigured = () => env.ASSISTANT_ENABLED && !!env.GEMINI_API_KEY;

function assistantUser(req: AuthenticatedRequest): AssistantUser {
  return {
    id: req.user!.id,
    name: req.user!.name,
    role: req.user!.role,
    projectId: requireProjectId(req),
    auth: req.headers.authorization as string,
  };
}

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.unknown().optional(),
});

// GET /assistant/status — lets the UI hide the assistant when it is switched off.
router.get('/status', (_req: AuthenticatedRequest, res: Response) => {
  res.json({ enabled: isConfigured(), dailyLimit: env.ASSISTANT_DAILY_LIMIT });
});

// POST /assistant/chat — one user message. Reads run now; creates come back as
// pending proposals the user must confirm.
router.post('/chat', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'The AI assistant is not enabled', code: 'ASSISTANT_DISABLED' });
      return;
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    const quota = consumeDailyQuota(req.user!.id);
    if (!quota.ok) {
      res.status(429).json({ error: 'Daily assistant limit reached', code: 'ASSISTANT_LIMIT', limit: quota.limit });
      return;
    }

    const started = Date.now();
    const result = await runChat(assistantUser(req), parsed.data.message, parsed.data.history);
    logger.info({
      event: 'assistant_chat',
      userId: req.user!.id,
      ms: Date.now() - started,
      pending: result.pending.map((p) => p.tool),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof AssistantProviderError) {
      logger.error({ event: 'assistant_provider_error', message: error.message });
      res.status(error.status === 429 ? 429 : 502).json({ error: error.message, code: 'ASSISTANT_PROVIDER' });
      return;
    }
    next(error);
  }
});

// POST /assistant/actions/:id/confirm — user pressed Confirm on a proposal.
router.post('/actions/:id/confirm', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!isConfigured()) {
      res.status(503).json({ error: 'The AI assistant is not enabled', code: 'ASSISTANT_DISABLED' });
      return;
    }
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(400).json({ error: 'Invalid action id' });
      return;
    }
    const out = await confirmAction(req.params.id, assistantUser(req));
    logger.info({ event: 'assistant_confirm', userId: req.user!.id, actionId: req.params.id, ok: out.ok });
    res.status(out.ok ? 201 : out.status).json(out);
  } catch (error) {
    next(error);
  }
});

// POST /assistant/actions/:id/cancel
router.post('/actions/:id/cancel', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(400).json({ error: 'Invalid action id' });
      return;
    }
    const ok = await cancelAction(req.params.id, assistantUser(req));
    res.json({ ok });
  } catch (error) {
    next(error);
  }
});

export default router;
