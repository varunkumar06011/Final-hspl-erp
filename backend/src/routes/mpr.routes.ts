import { Router, Response, NextFunction } from 'express';
import { Permission, MPRStatus, AuditAction } from '@hospital-erp/shared';
import { createMPRSchema, updateMPRSchema, listMPRSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateSequenceNumber } from '../services/sequence.service';
import { streamMprPdf } from '../services/mpr-pdf.service';

const router = Router();
router.use(authMiddleware);

const mprInclude = {
  createdByUser: { select: { id: true, name: true } },
  requestRaisedBy: { select: { id: true, name: true } },
  items: true,
  project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
};

// GET / — list MPRs
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_MPR),
  validateMiddleware(listMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (status) where.status = status;
      if (search) where.mprNumber = { contains: search, mode: 'insensitive' };

      const [items, total] = await Promise.all([
        prisma.materialPurchaseRequest.findMany({
          where,
          include: mprInclude,
          orderBy: { date: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.materialPurchaseRequest.count({ where }),
      ]);

      res.json({ data: items, total, page, limit });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — single MPR
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: mprInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create MPR
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_MPR),
  validateMiddleware(createMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mprNumber = await generateSequenceNumber('materialPurchaseRequest', 'mprNumber', 'VGH-MPR', 3, { projectId });

      const items = req.body.items;
      const estimatedGstRate = Number(req.body.estimatedGstRate) || 0;

      // Compute estimated amounts
      const computedItems = items.map((item: any) => {
        const qty = Number(item.quantity);
        const rate = Number(item.estimatedRate) || 0;
        return { ...item, estimatedAmount: qty * rate };
      });
      const estimatedSubtotal = computedItems.reduce((sum: number, item: any) => sum + Number(item.estimatedAmount), 0);
      const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
      const estimatedTotal = estimatedSubtotal + estimatedGstAmount;

      const record = await prisma.materialPurchaseRequest.create({
        data: {
          projectId,
          mprNumber,
          requiredBy: req.body.requiredBy ? new Date(req.body.requiredBy) : null,
          department: req.body.department || null,
          priority: req.body.priority || null,
          status: MPRStatus.DRAFT,
          description: req.body.description || null,
          deliveryAddress: req.body.deliveryAddress || null,
          contactPerson: req.body.contactPerson || null,
          contactNumber: req.body.contactNumber || null,
          billingAddress: req.body.billingAddress || null,
          stateCode: req.body.stateCode || null,
          requestRaisedById: req.body.requestRaisedById || null,
          estimatedSubtotal,
          estimatedGstRate,
          estimatedGstAmount,
          estimatedTotal,
          technicalRequirements: req.body.technicalRequirements || null,
          createdBy: req.user!.id,
          items: {
            create: computedItems.map((item: any) => ({
              materialName: item.materialName,
              materialCode: item.materialCode || null,
              specification: item.specification || null,
              quantity: item.quantity,
              unit: item.unit || null,
              requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
              estimatedRate: item.estimatedRate,
              estimatedAmount: item.estimatedAmount,
              remarks: item.remarks || null,
            })),
          },
        },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CREATE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /:id — update MPR (only if DRAFT)
router.put(
  '/:id',
  rbacMiddleware(Permission.CREATE_MPR),
  validateMiddleware(updateMPRSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status !== MPRStatus.DRAFT) {
        res.status(400).json({ error: 'Cannot edit MPR after it has been submitted' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (req.body.requiredBy !== undefined) updateData.requiredBy = req.body.requiredBy ? new Date(req.body.requiredBy) : null;
      if (req.body.department !== undefined) updateData.department = req.body.department || null;
      if (req.body.priority !== undefined) updateData.priority = req.body.priority || null;
      if (req.body.description !== undefined) updateData.description = req.body.description || null;
      if (req.body.deliveryAddress !== undefined) updateData.deliveryAddress = req.body.deliveryAddress || null;
      if (req.body.contactPerson !== undefined) updateData.contactPerson = req.body.contactPerson || null;
      if (req.body.contactNumber !== undefined) updateData.contactNumber = req.body.contactNumber || null;
      if (req.body.billingAddress !== undefined) updateData.billingAddress = req.body.billingAddress || null;
      if (req.body.stateCode !== undefined) updateData.stateCode = req.body.stateCode || null;
      if (req.body.requestRaisedById !== undefined) updateData.requestRaisedById = req.body.requestRaisedById || null;
      if (req.body.technicalRequirements !== undefined) updateData.technicalRequirements = req.body.technicalRequirements || null;
      if (req.body.estimatedGstRate !== undefined) updateData.estimatedGstRate = Number(req.body.estimatedGstRate);

      // If items are provided, recompute totals and replace items
      if (req.body.items) {
        const items = req.body.items;
        const estimatedGstRate = Number(updateData.estimatedGstRate ?? existing.estimatedGstRate);
        const computedItems = items.map((item: any) => {
          const qty = Number(item.quantity);
          const rate = Number(item.estimatedRate) || 0;
          return { ...item, estimatedAmount: qty * rate };
        });
        const estimatedSubtotal = computedItems.reduce((sum: number, item: any) => sum + Number(item.estimatedAmount), 0);
        const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
        const estimatedTotal = estimatedSubtotal + estimatedGstAmount;

        updateData.estimatedSubtotal = estimatedSubtotal;
        updateData.estimatedGstAmount = estimatedGstAmount;
        updateData.estimatedTotal = estimatedTotal;

        // Delete old items and create new ones
        await prisma.materialPurchaseRequestItem.deleteMany({ where: { mprId: req.params.id } });
        updateData.items = {
          create: computedItems.map((item: any) => ({
            materialName: item.materialName,
            materialCode: item.materialCode || null,
            specification: item.specification || null,
            quantity: item.quantity,
            unit: item.unit || null,
            requiredDate: item.requiredDate ? new Date(item.requiredDate) : null,
            estimatedRate: item.estimatedRate,
            estimatedAmount: item.estimatedAmount,
            remarks: item.remarks || null,
          })),
        };
      } else if (req.body.estimatedGstRate !== undefined) {
        // Recompute GST with new rate but existing items
        const estimatedSubtotal = Number(existing.estimatedSubtotal);
        const estimatedGstRate = Number(updateData.estimatedGstRate);
        const estimatedGstAmount = (estimatedSubtotal * estimatedGstRate) / 100;
        updateData.estimatedGstAmount = estimatedGstAmount;
        updateData.estimatedTotal = estimatedSubtotal + estimatedGstAmount;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: updateData,
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.UPDATE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/submit — change status from DRAFT to SUBMITTED
router.post(
  '/:id/submit',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status !== MPRStatus.DRAFT) {
        res.status(400).json({ error: 'Only DRAFT MPRs can be submitted' });
        return;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { status: MPRStatus.SUBMITTED },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.SUBMIT_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/cancel — cancel an MPR
router.post(
  '/:id/cancel',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.CLOSED || existing.status === MPRStatus.CANCELLED) {
        res.status(400).json({ error: 'Cannot cancel a closed or already cancelled MPR' });
        return;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { status: MPRStatus.CANCELLED },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CANCEL_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/close — close an MPR (after POs created)
router.post(
  '/:id/close',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status === MPRStatus.CANCELLED) {
        res.status(400).json({ error: 'Cannot close a cancelled MPR' });
        return;
      }

      const record = await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { status: MPRStatus.CLOSED },
        include: mprInclude,
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.CLOSE_MPR, entityType: 'material_purchase_requests', entityId: record.id, projectId, newValue: { mprNumber: record.mprNumber } });
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (only if DRAFT)
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }
      if (existing.status !== MPRStatus.DRAFT) {
        res.status(400).json({ error: 'Only DRAFT MPRs can be deleted' });
        return;
      }

      await prisma.materialPurchaseRequest.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({ userId: req.user!.id, action: AuditAction.DELETE_MPR, entityType: 'material_purchase_requests', entityId: req.params.id, projectId, newValue: { mprNumber: existing.mprNumber } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/pdf — generate and download PDF
router.get(
  '/:id/pdf',
  rbacMiddleware(Permission.VIEW_MPR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const mpr = await prisma.materialPurchaseRequest.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          ...mprInclude,
          project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true, panNumber: true, logoUrl: true } },
        },
      });
      if (!mpr) {
        res.status(404).json({ error: 'Material Purchase Request not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${mpr.mprNumber}.pdf"`);
      await streamMprPdf(res as unknown as NodeJS.WritableStream, mpr);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
