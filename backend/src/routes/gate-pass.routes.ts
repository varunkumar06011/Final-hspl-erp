import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { AuditAction, Permission, createGatePassSchema, updateGatePassSchema, listGatePassesSchema, verifyGatePassOtpSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { getStorageService } from '../services/storage.service';
import { generateOtp, verifyOtp } from '../services/otp.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = Router();

router.use(authMiddleware);

const include = {
  vendor: { select: { id: true, name: true, phone: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  invoice: { select: { id: true, invoiceNumber: true } },
  approver: { select: { id: true, name: true, phone: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
};

// GET /approvers — list project users that can approve gate passes
router.get(
  '/approvers',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        where: { projectId: req.user!.projectId, isActive: true },
        select: { id: true, name: true, phone: true, role: true },
        orderBy: { name: 'asc' },
      });
      res.json({ data: users });
    } catch (error) {
      next(error);
    }
  }
);

// GET /approved-pos — list approved POs with their verified invoices and items (for gate pass creation)
router.get(
  '/approved-pos',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pos = await prisma.purchaseOrder.findMany({
        where: { projectId, deletedAt: null, status: 'APPROVED' },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          items: true,
          invoices: {
            where: { deletedAt: null, verificationStatus: 'VERIFIED' },
            select: { id: true, invoiceNumber: true, verificationStatus: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      // Return all approved POs (invoice is optional for gate pass creation)
      const result = pos.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        vendor: po.vendor,
        totalAmount: Number(po.totalAmount),
        items: po.items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
        invoices: po.invoices,
      }));
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  }
);

// GET / — list
router.get(
  '/',
  validateMiddleware(listGatePassesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search, type, status } = req.query as Record<string, unknown>;
      const projectId = req.user!.projectId;

      const where: Record<string, unknown> = {
        projectId,
        deletedAt: null,
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
      };

      if (search) {
        where.OR = [
          { passNumber: { contains: String(search), mode: 'insensitive' } },
          { vehicleNumber: { contains: String(search), mode: 'insensitive' } },
          { driverName: { contains: String(search), mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.gatePass.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.gatePass.count({ where }),
      ]);

      res.json({
        data,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / Number(pageSize)) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id
router.get(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include,
      });
      if (!record) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create with photo upload
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  upload.single('vehiclePhoto'),
  validateMiddleware(createGatePassSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const body = req.body as Record<string, unknown>;

      let vehiclePhoto: string | null = null;
      if (req.file) {
        const storage = getStorageService();
        const uploadResult = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, 'gate-pass-photos');
        vehiclePhoto = uploadResult.filePath;
      }

      const record = await prisma.gatePass.create({
        data: {
          projectId,
          createdBy: req.user!.id,
          vendorId: body.vendorId as string,
          poId: (body.poId as string) ?? null,
          invoiceId: (body.invoiceId as string) ?? null,
          passNumber: body.passNumber as string,
          type: body.type as string,
          date: body.date ? new Date(String(body.date)) : new Date(),
          timeIn: (body.timeIn as string) ?? null,
          vehicleNumber: (body.vehicleNumber as string) ?? null,
          driverName: (body.driverName as string) ?? null,
          driverPhone: (body.driverPhone as string) ?? null,
          carrierName: (body.carrierName as string) ?? null,
          vehiclePhoto,
          approverId: (body.approverId as string) ?? null,
          items: { create: body.items as { description: string; quantity: number; unit: string }[] },
        },
        include,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'GATE_PASS',
        entityId: record.id,
        projectId,
        newValue: { passNumber: record.passNumber, vendorId: record.vendorId },
      });

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id
router.patch(
  '/:id',
  validateMiddleware(updateGatePassSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const record = await prisma.gatePass.update({
        where: { id: req.params.id },
        data: {
          status: (body.status as string) ?? undefined,
          timeIn: (body.timeIn as string) ?? undefined,
          vehicleNumber: (body.vehicleNumber as string) ?? undefined,
          driverName: (body.driverName as string) ?? undefined,
          driverPhone: (body.driverPhone as string) ?? undefined,
          vehiclePhoto: (body.vehiclePhoto as string) ?? undefined,
          approverId: (body.approverId as string) ?? undefined,
        },
        include,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'GATE_PASS',
        entityId: record.id,
        projectId: req.user!.projectId,
        newValue: body,
      });

      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id
router.delete(
  '/:id',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }

      await prisma.gatePass.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'GATE_PASS',
        entityId: req.params.id,
        projectId: req.user!.projectId,
      });

      res.json({ message: 'Gate Pass deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/send-otp — generate and (placeholder) send OTP to approver
router.post(
  '/:id/send-otp',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include: { approver: { select: { phone: true, name: true } } },
      });
      if (!record) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }
      if (!record.approverId || !record.approver?.phone) {
        res.status(400).json({ error: 'Approver or phone number not set' });
        return;
      }
      if (record.otpVerified) {
        res.status(400).json({ error: 'Gate Pass already verified' });
        return;
      }

      const otp = generateOtp(record.id);
      // TODO: integrate Firebase/SMS OTP service; for now fallback 1234 is returned for testing
      res.json({
        message: 'OTP generated (fallback active)',
        // Do not expose OTP in production; exposed here for local testing only
        otp,
        phone: record.approver.phone,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/verify-otp — verify OTP and approve gate pass
router.post(
  '/:id/verify-otp',
  validateMiddleware(verifyGatePassOtpSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!record) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }

      const { otp } = req.body as { otp: string };
      if (!verifyOtp(record.id, otp)) {
        res.status(400).json({ error: 'Invalid or expired OTP' });
        return;
      }

      const updated = await prisma.gatePass.update({
        where: { id: req.params.id },
        data: { otpVerified: true, status: 'APPROVED', approvedAt: new Date() },
        include,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'GATE_PASS',
        entityId: record.id,
        projectId: req.user!.projectId,
        newValue: { status: 'APPROVED', otpVerified: true },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/whatsapp-link — generate a shareable WhatsApp message link
router.get(
  '/:id/whatsapp-link',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
        include,
      });
      if (!record) {
        res.status(404).json({ error: 'Gate Pass not found' });
        return;
      }

      const message = encodeURIComponent(
        `Gate Pass #${record.passNumber}\n` +
        `Date: ${new Date(record.date).toLocaleDateString()} ${record.timeIn ? ' at ' + record.timeIn : ''}\n` +
        `Vehicle: ${record.vehicleNumber ?? '—'}\n` +
        `Driver: ${record.driverName ?? '—'} (${record.driverPhone ?? '—'})\n` +
        `Vendor: ${(record.vendor as any)?.name ?? '—'}\n` +
        `Materials: ${record.items.map((i: any) => `${i.description} ${i.quantity} ${i.unit}`).join(', ')}\n` +
        `Status: ${record.status}`
      );

      res.json({
        message: message.replace(/%20/g, ' '),
        mobileLink: `whatsapp://send?text=${message}`,
        webLink: `https://wa.me/?text=${message}`,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
