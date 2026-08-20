import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, UserRole, InventoryTxnType } from '@hospital-erp/shared';
import { createGatePassSchema, listGatePassesSchema, verifyGatePassOtpSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [UserRole.PROJECT_HEAD, UserRole.HEAD_OF_CONSTRUCTION, UserRole.ADMIN, UserRole.ADMIN_2];

function getPassDatePrefix(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `VGH-${dd}-${yy}`;
}

async function generateUniquePassNumber(): Promise<string> {
  const prefix = getPassDatePrefix();
  // Find all gate passes with this date prefix (across all projects, to keep global sequence)
  const existing = await prisma.gatePass.findMany({
    where: { passNumber: { startsWith: `${prefix}-` } },
    select: { passNumber: true },
  });
  const maxSeq = existing.reduce((max, gp) => {
    const match = gp.passNumber?.match(/^VGH-\d{2}-\d{2}-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  const seq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${seq}`;
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const gatePassInclude = {
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      vendor: { select: { id: true, name: true, vendorCode: true } },
      items: true,
    },
  },
  invoice: { select: { id: true, invoiceCode: true, invoiceNumber: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  otpRequestedForUser: { select: { id: true, name: true, role: true, phone: true } },
  otpApprovedByUser: { select: { id: true, name: true } },
};

// GET /heads — list the 4 head users for OTP selection (not filtered by projectId — heads may not be assigned to a project)
router.get(
  '/heads',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const users = await prisma.user.findMany({
        where: {
          role: { in: HEAD_ROLES },
          isActive: true,
        },
        select: { id: true, name: true, role: true, phone: true },
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
            select: { id: true, invoiceCode: true, invoiceNumber: true, verificationStatus: true, stockStatus: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      // Only return POs that have at least one verified invoice
      const result = pos
        .filter((po) => po.invoices.length > 0)
        .map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          vendor: po.vendor,
          grandTotal: Number(po.grandTotal),
          items: po.items.map((item) => ({
            materialName: item.materialName,
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

// GET / — list gate passes
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  validateMiddleware(listGatePassesSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, status } = req.query as Record<string, unknown>;
      const pageNum = Number(page) || 1;
      const size = Number(pageSize) || 20;

      const where: Record<string, unknown> = { projectId, deletedAt: null };
      if (status) where.status = status;

      const [data, total] = await Promise.all([
        prisma.gatePass.findMany({
          where,
          include: gatePassInclude,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * size,
          take: size,
        }),
        prisma.gatePass.count({ where }),
      ]);

      res.json({
        data,
        pagination: { page: pageNum, pageSize: size, total, totalPages: Math.ceil(total / size) },
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
      const record = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: gatePassInclude,
      });
      if (!record) {
        res.status(404).json({ error: 'Gate pass not found' });
        return;
      }
      res.json(record);
    } catch (error) {
      next(error);
    }
  }
);

// POST / — create gate pass (request OTP)
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  validateMiddleware(createGatePassSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { poId, invoiceId, otpRequestedFor } = req.body;

      // Validate PO exists and is approved
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: poId, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!po) {
        res.status(400).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.status !== 'APPROVED') {
        res.status(400).json({ error: 'Purchase order must be approved first' });
        return;
      }

      // Validate invoice exists and is verified
      const invoice = await prisma.vendorInvoice.findFirst({
        where: { id: invoiceId, projectId, deletedAt: null },
      });
      if (!invoice) {
        res.status(400).json({ error: 'Invoice not found' });
        return;
      }
      if (invoice.verificationStatus !== 'VERIFIED') {
        res.status(400).json({ error: 'Invoice must be verified first' });
        return;
      }
      if (invoice.poId !== poId) {
        res.status(400).json({ error: 'Invoice does not belong to this purchase order' });
        return;
      }

      // Check if a gate pass already exists for this invoice
      const existingGP = await prisma.gatePass.findFirst({
        where: { invoiceId, projectId, deletedAt: null, status: 'APPROVED' },
      });
      if (existingGP) {
        res.status(409).json({ error: 'An approved gate pass already exists for this invoice' });
        return;
      }

      // Validate otpRequestedFor is one of the 4 heads
      const headUser = await prisma.user.findUnique({ where: { id: otpRequestedFor } });
      if (!headUser || !HEAD_ROLES.includes(headUser.role as UserRole)) {
        res.status(400).json({ error: 'OTP recipient must be one of the 4 heads' });
        return;
      }

      const passNumber = await generateUniquePassNumber();
      const otpCode = generateOtp();

      const gatePass = await prisma.gatePass.create({
        data: {
          projectId,
          poId,
          invoiceId,
          passNumber,
          status: 'PENDING',
          otpCode,
          otpRequestedFor,
          createdBy: req.user!.id,
          items: {
            create: po.items.map((item) => ({
              materialName: item.materialName,
              quantity: item.quantity,
              unit: item.unit,
            })),
          },
        },
        include: gatePassInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'GATE_PASS',
        entityId: gatePass.id,
        projectId,
        newValue: { passNumber, poId, invoiceId, otpRequestedFor },
      });

      // Return the gate pass with the OTP (for now — SMS integration later)
      // The OTP is communicated to the head outside the software
      res.status(201).json({
        ...gatePass,
        otpCode, // Included so the creator knows it was generated (SMS later)
        message: `OTP has been generated. Please get the OTP from ${headUser.name} to approve this gate pass.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/verify-otp — verify OTP and approve gate pass
router.post(
  '/:id/verify-otp',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  validateMiddleware(verifyGatePassOtpSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const gatePass = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { purchaseOrder: { include: { items: true } }, items: true },
      });
      if (!gatePass) {
        res.status(404).json({ error: 'Gate pass not found' });
        return;
      }
      if (gatePass.status === 'APPROVED') {
        res.status(400).json({ error: 'Gate pass already approved' });
        return;
      }
      if (!gatePass.otpCode) {
        res.status(400).json({ error: 'No OTP was generated for this gate pass' });
        return;
      }

      if (req.body.otp !== gatePass.otpCode) {
        res.status(400).json({ error: 'Invalid OTP' });
        return;
      }

      // OTP verified — approve the gate pass and add items to inventory
      const inventoryResults: { name: string; quantity: number; action: string }[] = [];

      for (const item of gatePass.items) {
        let invItem = await prisma.inventoryItem.findFirst({
          where: { projectId, name: { equals: item.materialName, mode: 'insensitive' }, deletedAt: null },
        });

        if (!invItem) {
          invItem = await prisma.inventoryItem.create({
            data: {
              projectId,
              name: item.materialName,
              unit: item.unit ?? 'nos',
              currentStock: 0,
              minStockLevel: 0,
            },
          });
          inventoryResults.push({ name: item.materialName, quantity: Number(item.quantity), action: 'created' });
        } else {
          inventoryResults.push({ name: item.materialName, quantity: Number(item.quantity), action: 'updated' });
        }

        const newBalance = Number(invItem.currentStock) + Number(item.quantity);

        await prisma.$transaction([
          prisma.inventoryTransaction.create({
            data: {
              itemId: invItem.id,
              gatePassId: gatePass.id,
              type: InventoryTxnType.IN,
              quantity: Number(item.quantity),
              balanceAfter: newBalance,
              userId: req.user!.id,
              notes: `Auto-added from gate pass ${gatePass.passNumber}`,
            },
          }),
          prisma.inventoryItem.update({
            where: { id: invItem.id },
            data: { currentStock: newBalance },
          }),
        ]);
      }

      // Mark gate pass as approved
      const updated = await prisma.gatePass.update({
        where: { id: gatePass.id },
        data: {
          status: 'APPROVED',
          otpApprovedBy: req.user!.id,
          otpApprovedAt: new Date(),
        },
        include: gatePassInclude,
      });

      // Also mark the invoice's stock as received and flag inventory as added
      await prisma.vendorInvoice.update({
        where: { id: gatePass.invoiceId },
        data: { stockStatus: 'RECEIVED', inventoryAdded: true },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.APPROVE,
        entityType: 'GATE_PASS',
        entityId: gatePass.id,
        projectId,
        newValue: { status: 'APPROVED', inventoryResults },
      });

      res.json({
        ...updated,
        inventoryResults,
        message: `Gate pass approved! ${inventoryResults.length} item(s) added to inventory.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:id — soft delete (only if pending)
router.delete(
  '/:id',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const existing = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Gate pass not found' });
        return;
      }
      if (existing.status === 'APPROVED') {
        res.status(400).json({ error: 'Cannot delete an approved gate pass' });
        return;
      }

      await prisma.gatePass.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      res.json({ message: 'Gate pass deleted' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
