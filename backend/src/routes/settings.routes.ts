import { Router, Response, NextFunction } from 'express';
import { updateProjectSettingsSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';

const router = Router();
router.use(authMiddleware);

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
      const { officeAddress, hospitalAddress } = req.body;

      const updateData: Record<string, unknown> = {};
      if (officeAddress !== undefined) updateData.officeAddress = officeAddress;
      if (hospitalAddress !== undefined) updateData.hospitalAddress = hospitalAddress;

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        select: {
          id: true,
          name: true,
          officeAddress: true,
          hospitalAddress: true,
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
