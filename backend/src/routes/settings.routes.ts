import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { updateProjectSettingsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { AuditAction } from '@hospital-erp/shared';

const router = Router();
router.use(authMiddleware);

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100).optional(),
    phone: z.string().min(1, 'Phone is required').max(20).optional(),
  }),
});

// GET / — get project settings
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          officeAddress: true,
          hospitalAddress: true,
          totalBudget: true,
        },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      res.json(project);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH / — update project settings
router.patch(
  '/',
  validateMiddleware(updateProjectSettingsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { name, officeAddress, hospitalAddress, totalBudget } = req.body;

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (officeAddress !== undefined) updateData.officeAddress = officeAddress;
      if (hospitalAddress !== undefined) updateData.hospitalAddress = hospitalAddress;
      if (totalBudget !== undefined) updateData.totalBudget = totalBudget;

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        select: {
          id: true,
          name: true,
          officeAddress: true,
          hospitalAddress: true,
          totalBudget: true,
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /profile — get current user's profile
router.get(
  '/profile',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, name: true, phone: true, role: true },
      });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(user);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /profile — update current user's name and/or phone
router.patch(
  '/profile',
  validateMiddleware(updateProfileSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { name, phone } = req.body;
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (phone !== undefined) updateData.phone = phone;

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      const updated = await prisma.user.update({
        where: { id: req.user!.id },
        data: updateData,
        select: { id: true, name: true, phone: true, role: true },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'USER',
        entityId: req.user!.id,
        projectId: req.user!.projectId ?? '',
        newValue: updateData,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
