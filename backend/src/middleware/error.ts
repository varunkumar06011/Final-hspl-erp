import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/**
 * Detect a ZodError that may come from a different instance of the `zod`
 * library (dual-package hazard between the backend and the
 * `@hospital-erp/shared` workspace).
 */
function isZodError(err: unknown): err is ZodError {
  if (err instanceof ZodError) return true;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return e.name === 'ZodError' && Array.isArray(e.errors);
  }
  return false;
}

export function errorMiddleware(
  err: Error & { status?: number; code?: string; meta?: Record<string, unknown> },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Unhandled error:', err.message);

  if (isZodError(err)) {
    const errs = (err as ZodError).errors ?? (err as { issues: unknown[] }).issues ?? [];
    res.status(400).json({
      error: 'Validation failed',
      details: errs.map((e: { path?: unknown[]; message?: string }) => ({
        path: Array.isArray(e.path) ? e.path.join('.') : '',
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[])?.join(', ') ?? 'field';
      res.status(409).json({ error: `A record with this ${target} already exists` });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ error: 'Referenced record does not exist' });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'Invalid data provided' });
    return;
  }

  const status = err.status ?? 500;
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
