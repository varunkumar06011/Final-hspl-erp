import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { AuditAction } from '@hospital-erp/shared';
import { getStorageService, serveFile } from '../services/storage.service';

const router = Router();
router.use(authMiddleware);
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const guessMimeType = (filePath: string): string | null => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'svg': return 'image/svg+xml';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return null;
  }
};

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100).optional(),
    phone: z.string().min(1, 'Phone is required').max(20).optional(),
  }),
});

const updateProjectSettingsSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    totalBudget: z.coerce.number().min(0).optional(),
    officeAddress: z.string().max(2000).optional(),
    hospitalAddress: z.string().max(2000).optional(),
    gstNumber: z.string().max(50).optional(),
    panNumber: z.string().max(50).optional(),
    logoUrl: z.string().max(1000).optional(),
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
          description: true,
          totalBudget: true,
          status: true,
          officeAddress: true,
          hospitalAddress: true,
          gstNumber: true,
          panNumber: true,
          logoUrl: true,
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
      const { name, description, totalBudget, officeAddress, hospitalAddress, gstNumber, panNumber, logoUrl } = req.body;

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (totalBudget !== undefined) updateData.totalBudget = totalBudget;
      if (officeAddress !== undefined) updateData.officeAddress = officeAddress;
      if (hospitalAddress !== undefined) updateData.hospitalAddress = hospitalAddress;
      if (gstNumber !== undefined) updateData.gstNumber = gstNumber;
      if (panNumber !== undefined) updateData.panNumber = panNumber;
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl;

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: updateData,
        select: {
          id: true,
          name: true,
          description: true,
          totalBudget: true,
          status: true,
          officeAddress: true,
          hospitalAddress: true,
          gstNumber: true,
          panNumber: true,
          logoUrl: true,
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// POST /logo — upload project logo
router.post(
  '/logo',
  logoUpload.single('logo'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!req.file) {
        res.status(400).json({ error: 'No logo uploaded' });
        return;
      }
      if (!req.file.mimetype.startsWith('image/')) {
        res.status(400).json({ error: 'Logo must be an image' });
        return;
      }

      const storage = getStorageService();
      const result = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'logos');

      const updated = await prisma.project.update({
        where: { id: projectId },
        data: { logoUrl: result.filePath },
        select: { id: true, logoUrl: true },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /logo — serve the project logo
router.get(
  '/logo',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { logoUrl: true },
      });

      if (!project?.logoUrl) {
        res.status(404).json({ error: 'No logo uploaded' });
        return;
      }

      await serveFile(res, project.logoUrl, guessMimeType(project.logoUrl));
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
