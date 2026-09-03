import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Request logging middleware. Emits one structured log line per request with
 * method, path, status, and duration. Skips the /health endpoint to avoid
 * log spam from uptime monitors.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const fields: Record<string, unknown> = {
      event: 'request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    };

    // Attach the authenticated user id when available (set by authMiddleware).
    const userId = (req as { user?: { id?: string } }).user?.id;
    if (userId) fields.userId = userId;

    if (res.statusCode >= 500) {
      logger.error(fields);
    } else if (res.statusCode >= 400) {
      logger.warn(fields);
    } else {
      logger.info(fields);
    }
  });

  next();
}
