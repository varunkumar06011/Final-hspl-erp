import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuditAction, CatalogItemKind, canManageCatalog } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import { findCatalogItemByName, priceCheck, priceHistory, evaluatePrice, resolveCatalogLines } from '../services/catalog.service';
import {
  CatalogError,
  addCatalogSpec,
  deleteCatalogSpec,
  mergeCatalogItems,
  renameCatalogItem,
  renameCatalogSpec,
} from '../services/catalog-admin.service';

/**
 * Item catalog: one list of materials and services shared by every project. Pickers on
 * every screen read it; new items and specs are created on the spot (and by the server
 * whenever a document is saved), and admins/heads/supervisors tidy it up here.
 */
const router = Router();
router.use(authMiddleware);

const kindParam = z.nativeEnum(CatalogItemKind).optional();

function handle(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof CatalogError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.errors[0]?.message ?? 'Invalid input' });
    return;
  }
  next(error);
}

function requireManager(req: AuthenticatedRequest, res: Response): boolean {
  if (canManageCatalog(req.user!.role, req.user!.extraPermissions)) return true;
  res.status(403).json({ error: 'Only admins, heads and supervisors can change the item list' });
  return false;
}

// GET /items?kind=&all=1 — the catalog for pickers (live items with their specs and how often used)
router.get('/items', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const kind = kindParam.parse(req.query.kind || undefined);
    const items = await prisma.catalogItem.findMany({
      where: { isActive: true, ...(kind ? { kind } : {}) },
      include: {
        specs: { select: { id: true, value: true, isPredefined: true }, orderBy: { value: 'asc' } },
        _count: { select: { mprItems: true, quotationItems: true, poItems: true, stockItems: true } },
      },
      orderBy: { name: 'asc' },
      take: 10000,
    });
    res.json({
      data: items.map(({ _count, nameKey: _nameKey, mergedIntoId: _merged, ...item }) => ({
        ...item,
        uses: _count.mprItems + _count.quotationItems + _count.poItems + _count.stockItems,
      })),
    });
  } catch (error) {
    handle(error, res, next);
  }
});

// GET /items/:id — one item with its specs and price history per vendor
router.get('/items/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.catalogItem.findUnique({
      where: { id: req.params.id },
      include: { specs: { orderBy: { value: 'asc' } } },
    });
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    // Without ?specification= the overview covers every spec of the item.
    const spec = typeof req.query.specification === 'string' ? req.query.specification : null;
    const history = await priceHistory(item.id, spec, {}, spec === null);
    res.json({ ...item, prices: evaluatePrice(history, null) });
  } catch (error) {
    handle(error, res, next);
  }
});

const createItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.nativeEnum(CatalogItemKind).default(CatalogItemKind.MATERIAL),
  unit: z.string().trim().max(20).optional(),
  specification: z.string().trim().max(500).optional(),
});

// POST /items — create an item on the spot (or get the existing one with that name)
router.post('/items', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const body = createItemBody.parse(req.body);
    const existing = await findCatalogItemByName(prisma, body.name, body.kind);
    const [line] = await resolveCatalogLines(
      [{ materialName: body.name, unit: body.unit, specification: body.specification, itemId: existing?.id }],
      { kind: body.kind, userId: req.user!.id },
    );
    const item = await prisma.catalogItem.findUnique({
      where: { id: line.itemId },
      include: { specs: { select: { id: true, value: true, isPredefined: true }, orderBy: { value: 'asc' } } },
    });
    if (!existing) {
      await logAudit({
        userId: req.user!.id, action: AuditAction.CREATE, entityType: 'CATALOG_ITEM', entityId: line.itemId,
        projectId: requireProjectId(req), newValue: { code: item?.code, name: item?.name, kind: item?.kind },
      }).catch(() => {});
    }
    res.status(existing ? 200 : 201).json({ ...item, existed: !!existing, specification: line.specification });
  } catch (error) {
    handle(error, res, next);
  }
});

// PATCH /items/:id — rename / change unit, category or kind (managers)
router.patch('/items/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!requireManager(req, res)) return;
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      unit: z.string().trim().max(20).nullable().optional(),
      category: z.string().trim().max(100).nullable().optional(),
      kind: z.nativeEnum(CatalogItemKind).optional(),
    }).parse(req.body);
    const before = await prisma.catalogItem.findUnique({ where: { id: req.params.id } });
    const item = await renameCatalogItem(req.params.id, body);
    await logAudit({
      userId: req.user!.id, action: AuditAction.UPDATE, entityType: 'CATALOG_ITEM', entityId: item.id, projectId: requireProjectId(req),
      oldValue: before ? { name: before.name, unit: before.unit, kind: before.kind, code: before.code } : undefined,
      newValue: { name: item.name, unit: item.unit, kind: item.kind, code: item.code },
    }).catch(() => {});
    res.json(item);
  } catch (error) {
    handle(error, res, next);
  }
});

// POST /items/:id/merge — fold this item into another; with `asSpecification` it becomes a spec of it
router.post('/items/:id/merge', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!requireManager(req, res)) return;
    const body = z.object({
      targetId: z.string().uuid(),
      asSpecification: z.string().trim().max(500).optional(),
    }).parse(req.body);
    const result = await mergeCatalogItems(req.params.id, body.targetId, { asSpec: body.asSpecification, userId: req.user!.id });
    await logAudit({
      userId: req.user!.id, action: AuditAction.UPDATE, entityType: 'CATALOG_ITEM', entityId: body.targetId, projectId: requireProjectId(req),
      newValue: { action: body.asSpecification ? 'MAKE_SPEC' : 'MERGE', mergedFrom: req.params.id, ...result.summary },
    }).catch(() => {});
    res.json(result);
  } catch (error) {
    handle(error, res, next);
  }
});

// POST /items/:id/specs — add a specification to an item's list (anyone entering a line)
router.post('/items/:id/specs', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { value } = z.object({ value: z.string().trim().min(1).max(500) }).parse(req.body);
    res.status(201).json(await addCatalogSpec(req.params.id, value, req.user!.id));
  } catch (error) {
    handle(error, res, next);
  }
});

// PATCH /specs/:id — rename a spec everywhere it is used (managers)
router.patch('/specs/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!requireManager(req, res)) return;
    const { value } = z.object({ value: z.string().trim().min(1).max(500) }).parse(req.body);
    res.json(await renameCatalogSpec(req.params.id, value));
  } catch (error) {
    handle(error, res, next);
  }
});

// DELETE /specs/:id — drop a spec from the list (managers; lines keep their text)
router.delete('/specs/:id', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!requireManager(req, res)) return;
    await deleteCatalogSpec(req.params.id);
    res.status(204).end();
  } catch (error) {
    handle(error, res, next);
  }
});

const priceCheckBody = z.object({
  lines: z.array(z.object({
    itemId: z.string().uuid().nullish(),
    materialName: z.string().max(200).nullish(),
    specification: z.string().max(500).nullish(),
    rate: z.coerce.number().finite().min(0).nullish(),
    unit: z.string().max(20).nullish(),
  })).max(200),
  exclude: z.object({
    poId: z.string().uuid().nullish(),
    quotationId: z.string().uuid().nullish(),
    mprId: z.string().uuid().nullish(),
  }).optional(),
});

// POST /price-check — last price paid for each line, the difference, and every vendor's price
router.post('/price-check', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const body = priceCheckBody.parse(req.body);
    res.json({ data: await priceCheck(body.lines, body.exclude ?? {}) });
  } catch (error) {
    handle(error, res, next);
  }
});

export default router;
