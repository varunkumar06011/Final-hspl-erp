import { Response, NextFunction } from 'express';
import type { CatalogItemKind } from '@hospital-erp/shared';
import { AuthenticatedRequest } from './auth';
import { resolveCatalogLines } from '../services/catalog.service';

/**
 * Links every typed material line in `req.body[field]` to the item catalog before the
 * handler runs: each line gets the catalog item's id, name and code and its canonical
 * spec (new items/specs are created on the spot). Put it after validateMiddleware on any
 * endpoint that accepts material lines, so no screen (or Miko) can save a material the
 * catalog does not know. Accepts the multipart JSON-string form too (it stays an array).
 */
export function catalogLinesMiddleware(opts: { field?: string; kind?: (req: AuthenticatedRequest) => CatalogItemKind | undefined } = {}) {
  const field = opts.field ?? 'items';
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      let raw: unknown = req.body?.[field];
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          next();
          return;
        }
      }
      if (!Array.isArray(raw) || raw.length === 0) {
        next();
        return;
      }
      const isLine = (l: unknown): l is { materialName: string } =>
        !!l && typeof l === 'object' && typeof (l as { materialName?: unknown }).materialName === 'string' && !!(l as { materialName: string }).materialName.trim();
      const resolved = await resolveCatalogLines(raw.filter(isLine), { kind: opts.kind?.(req), userId: req.user?.id });
      let k = 0;
      req.body[field] = raw.map((l) => (isLine(l) ? resolved[k++] : l));
      next();
    } catch (error) {
      next(error);
    }
  };
}
