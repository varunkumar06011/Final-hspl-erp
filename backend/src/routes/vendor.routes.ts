import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { AuditAction, Permission } from '@hospital-erp/shared';
import {
  createVendorSchema,
  updateVendorSchema,
  listVendorsSchema,
  recordVendorPaymentSchema,
} from '@hospital-erp/shared';

const router = Router();
router.use(authMiddleware);

const withTotals = (v: any, totals: { totalBilled: number; totalPaid: number; outstanding: number }) => ({
  ...v,
  ...totals,
});

async function getVendorTotals(vendorId: string) {
  const [invoicesAgg, paymentsAgg] = await Promise.all([
    prisma.vendorInvoice.aggregate({
      where: { vendorId, deletedAt: null },
      _sum: { totalAmount: true },
    }),
    prisma.vendorPayment.aggregate({
      where: { vendorId },
      _sum: { amount: true },
    }),
  ]);
  const totalBilled = Number(invoicesAgg._sum.totalAmount ?? 0);
  const totalPaid = Number(paymentsAgg._sum.amount ?? 0);
  return { totalBilled, totalPaid, outstanding: totalBilled - totalPaid };
}

async function nextVendorCode(projectId: string) {
  const existing = await prisma.vendor.findMany({
    where: { projectId, vendorCode: { not: null } },
    select: { vendorCode: true },
  });
  const max = existing
    .map((v) => parseInt(v.vendorCode || '0', 10))
    .filter((n) => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return String(max + 1).padStart(3, '0');
}

// GET / — list
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listVendorsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search, status } = req.query as Record<string, unknown>;
      const projectId = requireProjectId(req);

      const where: any = { projectId, deletedAt: null };
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { name: { contains: String(search), mode: 'insensitive' } },
          { vendorCode: { contains: String(search), mode: 'insensitive' } },
          { gstNumber: { contains: String(search), mode: 'insensitive' } },
          { phone: { contains: String(search) } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.vendor.findMany({
          where,
          include: { createdByUser: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.vendor.count({ where }),
      ]);

      const data = await Promise.all(
        rows.map(async (v) => withTotals(v, await getVendorTotals(v.id)))
      );

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
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const record = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { createdByUser: { select: { id: true, name: true } } },
      });
      if (!record) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      res.json(withTotals(record, await getVendorTotals(record.id)));
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_VENDOR),
  validateMiddleware(createVendorSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendorCode = await nextVendorCode(projectId);

      const record = await prisma.vendor.create({
        data: {
          ...req.body,
          projectId,
          vendorCode,
          createdBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VENDOR',
        entityId: record.id,
        projectId,
        newValue: record,
      });

      res.status(201).json(record);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A vendor with this identifier already exists' });
        return;
      }
      next(error);
    }
  }
);

// PATCH /:id — update
router.patch(
  '/:id',
  rbacMiddleware(Permission.CREATE_VENDOR),
  validateMiddleware(updateVendorSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      const updated = await prisma.vendor.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'VENDOR',
        entityId: req.params.id,
        projectId,
        oldValue: existing,
        newValue: updated,
      });

      res.json(withTotals(updated, await getVendorTotals(updated.id)));
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_VENDOR),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.vendor.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      await prisma.vendor.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'VENDOR',
        entityId: req.params.id,
        projectId,
        oldValue: existing,
      });

      res.json({ message: 'Vendor deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/payments — record payment
router.post(
  '/:id/payments',
  rbacMiddleware(Permission.CREATE_VENDOR),
  validateMiddleware(recordVendorPaymentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const vendorId = req.params.id;

      const vendor = await prisma.vendor.findFirst({
        where: { id: vendorId, projectId, deletedAt: null },
      });
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }

      const { amount, date, mode, reference, notes, proofUrl } = req.body;
      const payment = await prisma.vendorPayment.create({
        data: {
          projectId,
          vendorId,
          amount: new Prisma.Decimal(amount),
          date: date ? new Date(date) : new Date(),
          mode,
          reference,
          notes,
          proofUrl,
          createdBy: req.user!.id,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'VENDOR_PAYMENT',
        entityId: payment.id,
        projectId,
        newValue: payment,
      });

      res.status(201).json(payment);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
