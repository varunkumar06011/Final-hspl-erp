import { Router, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { invalidateProjectCache } from '../services/project.service';
import {
  AuditAction,
  Permission,
  hasPermission,
  createProjectSchema,
  updateProjectSchema,
} from '@hospital-erp/shared';

const router = Router();

// The login picker is unauthenticated, so keep it cheap and rate-limited.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

const projectSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  totalBudget: true,
  startDate: true,
  endDate: true,
  status: true,
  officeAddress: true,
  hospitalAddress: true,
  gstNumber: true,
  panNumber: true,
  logoUrl: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.ProjectSelect;

// GET /projects/public — projects offered on the login page (no auth).
// Names/logos only; nothing about a project's data is exposed.
router.get('/public', publicLimiter, async (_req, res: Response, next: NextFunction) => {
  try {
    const projects = await prisma.project.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, name: true, logoUrl: true },
    });
    res.json({
      data: projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        hasLogo: !!p.logoUrl,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.use(authMiddleware);

// GET /projects — every project (used by the in-app switcher and the Projects page).
// Archived ones are included only for users who can manage projects.
router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const includeArchived =
      req.query.includeArchived === 'true' && hasPermission(req.user!.role, Permission.MANAGE_PROJECTS);

    const projects = await prisma.project.findMany({
      where: includeArchived ? {} : { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: projectSelect,
    });
    res.json({ data: projects, activeProjectId: requireProjectId(req) });
  } catch (error) {
    next(error);
  }
});

// POST /projects — create a new, completely empty project.
// Users, roles and PINs are shared; no business data is copied from any other project.
router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_PROJECTS),
  validateMiddleware(createProjectSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { code, name, description, totalBudget, startDate, endDate, status, officeAddress, hospitalAddress, gstNumber, panNumber } =
        req.body;

      const codeTaken = await prisma.project.findUnique({ where: { code }, select: { id: true } });
      if (codeTaken) {
        res.status(409).json({ error: `Project code "${code}" is already in use` });
        return;
      }

      const project = await prisma.project.create({
        data: {
          code,
          name,
          description: description ?? null,
          totalBudget: totalBudget ?? 0,
          startDate: startDate ?? new Date(),
          endDate: endDate ?? null,
          status: status ?? 'ACTIVE',
          officeAddress: officeAddress ?? null,
          hospitalAddress: hospitalAddress ?? null,
          gstNumber: gstNumber ?? null,
          panNumber: panNumber ?? null,
        },
        select: projectSelect,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'PROJECT',
        entityId: project.id,
        projectId: requireProjectId(req),
        newValue: { code: project.code, name: project.name },
      });

      res.status(201).json(project);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /projects/:id — edit details, change status, archive / restore. The code never changes.
router.patch(
  '/:id',
  rbacMiddleware(Permission.MANAGE_PROJECTS),
  validateMiddleware(updateProjectSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { archived, name, description, totalBudget, startDate, endDate, status, officeAddress, hospitalAddress, gstNumber, panNumber } =
        req.body;

      const existing = await prisma.project.findUnique({ where: { id }, select: projectSelect });
      if (!existing) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      if (archived === true && !existing.deletedAt) {
        if (id === requireProjectId(req)) {
          res.status(400).json({ error: 'You cannot archive the project you are currently working in. Switch to another project first.' });
          return;
        }
        const liveCount = await prisma.project.count({ where: { deletedAt: null } });
        if (liveCount <= 1) {
          res.status(400).json({ error: 'At least one active project must remain.' });
          return;
        }
      }

      const data: Prisma.ProjectUpdateInput = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (totalBudget !== undefined) data.totalBudget = totalBudget;
      if (startDate !== undefined) data.startDate = startDate;
      if (endDate !== undefined) data.endDate = endDate;
      if (status !== undefined) data.status = status;
      if (officeAddress !== undefined) data.officeAddress = officeAddress;
      if (hospitalAddress !== undefined) data.hospitalAddress = hospitalAddress;
      if (gstNumber !== undefined) data.gstNumber = gstNumber;
      if (panNumber !== undefined) data.panNumber = panNumber;
      if (archived !== undefined) data.deletedAt = archived ? new Date() : null;

      const updated = await prisma.project.update({ where: { id }, data, select: projectSelect });
      invalidateProjectCache(id);

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'PROJECT',
        entityId: id,
        projectId: requireProjectId(req),
        oldValue: { name: existing.name, status: existing.status, archived: !!existing.deletedAt },
        newValue: { name: updated.name, status: updated.status, archived: !!updated.deletedAt },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
