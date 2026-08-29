import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Detect a ZodError thrown by a schema that may have been constructed with a
 * different instance of the `zod` library (dual-package hazard — the
 * `@hospital-erp/shared` workspace resolves to its own copy of zod, so
 * `error instanceof ZodError` can be false even though the error is a
 * genuine ZodError). We fall back to a structural duck-type check.
 */
function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    return e.name === 'ZodError' && Array.isArray(e.errors);
  }
  return false;
}

export function validateMiddleware(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      req.body = result.body ?? req.body;
      req.query = result.query ?? req.query;
      req.params = result.params ?? req.params;

      next();
    } catch (error) {
      if (isZodError(error)) {
        const errs = (error as ZodError).errors ?? (error as { issues: unknown[] }).issues ?? [];
        res.status(400).json({
          error: 'Validation failed',
          details: errs.map((e: { path?: unknown[]; message?: string }) => ({
            path: Array.isArray(e.path) ? e.path.join('.') : '',
            message: e.message,
          })),
        });
        return;
      }
      res.status(500).json({ error: 'Internal validation error' });
    }
  };
}
