import { Router, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { AuditAction, Permission } from '@hospital-erp/shared';

interface CrudConfig {
  entityType: string;
  model: string;
  createPermission: Permission;
  viewPermission?: Permission;
  createSchema: ZodSchema;
  updateSchema: ZodSchema;
  listSchema: ZodSchema;
  include?: Record<string, unknown>;
  defaultSort?: Record<string, 'asc' | 'desc'>;
  searchFields?: string[];
  intSearchFields?: string[];
  transformCreate?: (body: Record<string, unknown>, userId: string, projectId: string) => Record<string, unknown> | Promise<Record<string, unknown>>;
  transformUpdate?: (body: Record<string, unknown>, userId: string, projectId: string, existingId: string) => Record<string, unknown> | Promise<Record<string, unknown>>;
  transformList?: (records: Record<string, unknown>[], projectId: string) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
  beforeDelete?: (id: string) => Promise<void>;
  afterCreate?: (record: Record<string, unknown>, userId: string, projectId: string) => void | Promise<void>;
}

export function createCrudRouter(config: CrudConfig): Router {
  const router = Router();
  const model = (prisma as any)[config.model];

  router.use(authMiddleware);

  // GET / — list with pagination, project scoping, search
  router.get(
    '/',
    config.viewPermission ? rbacMiddleware(config.viewPermission) : (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next(),
    validateMiddleware(config.listSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const { page = 1, pageSize = 20, search, ...filters } = req.query as Record<string, unknown>;
        const projectId = requireProjectId(req);

        const where: Record<string, unknown> = {
          projectId,
          deletedAt: null,
          ...buildFilterWhere(filters),
        };

        if (search && config.searchFields?.length) {
          const orConditions: Record<string, unknown>[] = config.searchFields.map((field) => ({
            [field]: { contains: String(search), mode: 'insensitive' },
          }));

          const searchNum = Number(search);
          if (!isNaN(searchNum) && config.intSearchFields?.length) {
            config.intSearchFields.forEach((field) => {
              orConditions.push({ [field]: searchNum });
            });
          }

          where.OR = orConditions;
        }

        const [data, total] = await Promise.all([
          model.findMany({
            where,
            include: config.include,
            orderBy: config.defaultSort ?? { createdAt: 'desc' },
            skip: (Number(page) - 1) * Number(pageSize),
            take: Number(pageSize),
          }),
          model.count({ where }),
        ]);

        const transformedData = config.transformList
          ? await config.transformList(data as Record<string, unknown>[], projectId)
          : data;

        res.json({
          data: transformedData,
          pagination: {
            page: Number(page),
            pageSize: Number(pageSize),
            total,
            totalPages: Math.ceil(total / Number(pageSize)),
          },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /:id — single record
  router.get(
    '/:id',
    config.viewPermission ? rbacMiddleware(config.viewPermission) : (_req: AuthenticatedRequest, _res: Response, next: NextFunction) => next(),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const record = await model.findFirst({
          where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
          include: config.include,
        });
        if (!record) {
          res.status(404).json({ error: `${config.entityType} not found` });
          return;
        }
        res.json(record);
      } catch (error) {
        next(error);
      }
    }
  );

  // POST / — create
  router.post(
    '/',
    rbacMiddleware(config.createPermission),
    validateMiddleware(config.createSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const projectId = requireProjectId(req);

        let data: Record<string, unknown> = {
          ...req.body,
          projectId,
          createdBy: req.user!.id,
        };

        if (config.transformCreate) {
          data = await config.transformCreate(req.body, req.user!.id, projectId);
        }

        const record = await model.create({ data, include: config.include });

        await logAudit({
          userId: req.user!.id,
          action: AuditAction.CREATE,
          entityType: config.entityType,
          entityId: record.id,
          projectId,
          newValue: sanitizeForAudit(record),
        });

        if (config.afterCreate) {
          Promise.resolve(config.afterCreate(record, req.user!.id, projectId)).catch((err: unknown) =>
            console.error(`[CrudFactory] afterCreate error for ${config.entityType}:`, err)
          );
        }

        res.status(201).json(record);
      } catch (error: unknown) {
        if (isUniqueConstraintError(error)) {
          res.status(409).json({ error: `A ${config.entityType.toLowerCase()} with this identifier already exists` });
          return;
        }
        next(error);
      }
    }
  );

  // PATCH /:id — update
  router.patch(
    '/:id',
    rbacMiddleware(config.createPermission),
    validateMiddleware(config.updateSchema),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const existing = await model.findFirst({
          where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        });
        if (!existing) {
          res.status(404).json({ error: `${config.entityType} not found` });
          return;
        }

        let updateData: Record<string, unknown> = req.body;
        if (config.transformUpdate) {
          updateData = await config.transformUpdate(req.body, req.user!.id, requireProjectId(req), req.params.id);
        }

        const updated = await model.update({
          where: { id: req.params.id },
          data: updateData,
          include: config.include,
        });

        await logAudit({
          userId: req.user!.id,
          action: AuditAction.UPDATE,
          entityType: config.entityType,
          entityId: req.params.id,
          projectId: req.user!.projectId,
          oldValue: sanitizeForAudit(existing),
          newValue: sanitizeForAudit(updated),
        });

        res.json(updated);
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /:id — soft delete
  router.delete(
    '/:id',
    rbacMiddleware(config.createPermission),
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const existing = await model.findFirst({
          where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        });
        if (!existing) {
          res.status(404).json({ error: `${config.entityType} not found` });
          return;
        }

        if (config.beforeDelete) {
          await config.beforeDelete(req.params.id);
        }

        await model.update({
          where: { id: req.params.id },
          data: { deletedAt: new Date() },
        });

        await logAudit({
          userId: req.user!.id,
          action: AuditAction.DELETE,
          entityType: config.entityType,
          entityId: req.params.id,
          projectId: req.user!.projectId,
          oldValue: sanitizeForAudit(existing),
        });

        res.json({ message: `${config.entityType} deleted` });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function buildFilterWhere(filters: Record<string, unknown>): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && key !== 'page' && key !== 'pageSize' && key !== 'search') {
      where[key] = value;
    }
  }
  return where;
}

function sanitizeForAudit(record: Record<string, unknown>): Record<string, unknown> {
  const { deletedAt, ...rest } = record;
  return rest;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Prisma.PrismaClientKnownRequestError).code === 'P2002'
  );
}
