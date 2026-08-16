import { Router, Response, NextFunction } from 'express';
import { AuditAction } from '@hospital-erp/shared';
import { createDropdownOptionSchema, listDropdownOptionsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

// GET / — list dropdown options by type for the current project
router.get(
  '/',
  validateMiddleware(listDropdownOptionsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { type, isActive } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        type: String(type),
        ...(isActive !== undefined ? { isActive: isActive === 'true' || isActive === true } : {}),
      };

      const data = await prisma.dropdownOption.findMany({
        where,
        orderBy: { value: 'asc' },
      });

      res.json({ data });
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create a new dropdown option (user-expandable)
router.post(
  '/',
  validateMiddleware(createDropdownOptionSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { type, value, label } = req.body;

      const existing = await prisma.dropdownOption.findFirst({
        where: { projectId, type, value },
      });
      if (existing) {
        res.status(409).json({ error: 'This option already exists' });
        return;
      }

      const record = await prisma.dropdownOption.create({
        data: {
          projectId,
          type,
          value,
          label: label || null,
          createdBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'DROPDOWN_OPTION',
        entityId: record.id,
        projectId,
        newValue: { type, value, label },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id — toggle active/inactive
router.patch(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.dropdownOption.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req) },
      });
      if (!existing) {
        res.status(404).json({ error: 'Dropdown option not found' });
        return;
      }

      const updated = await prisma.dropdownOption.update({
        where: { id: req.params.id },
        data: { isActive: !existing.isActive },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
