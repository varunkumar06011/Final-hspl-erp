import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, UserRole } from '@hospital-erp/shared';
import {
  createGatePassSchema,
  listGatePassesSchema,
  verifyGatePassOtpSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateSequenceNumber } from '../services/sequence.service';
import { verifyFirebaseToken } from '../config/firebase';
import { notifyAllHeads } from '../services/push.service';
import { streamGatePassPdf } from '../services/gate-pass-pdf.service';
import { getStorageService } from '../services/storage.service';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authMiddleware);

const HEAD_ROLES = [
  UserRole.PROJECT_HEAD,
  UserRole.HEAD_OF_CONSTRUCTION,
  UserRole.ADMIN,
  UserRole.ADMIN_2,
];

function getPassDatePrefix(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `VGH-${dd}-${yy}`;
}

async function generateUniquePassNumber(): Promise<string> {
  const prefix = getPassDatePrefix();
  return generateSequenceNumber('gatePass', 'passNumber', `${prefix}-`, 3);
}

const gatePassInclude = {
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      vendor: { select: { id: true, name: true, vendorCode: true } },
      quotation: { select: { id: true, quotationNumber: true } },
      items: true,
    },
  },
  invoice: { select: { id: true, invoiceCode: true, invoiceNumber: true } },
  items: true,
  createdByUser: { select: { id: true, name: true } },
  otpRequestedForUser: { select: { id: true, name: true, role: true, phone: true } },
  otpApprovedByUser: { select: { id: true, name: true } },
  project: { select: { name: true, officeAddress: true, hospitalAddress: true, gstNumber: true } },
};

// GET /heads — list the 4 head users for OTP selection (not filtered by projectId — heads may not be assigned to a project)
router.get(
  '/heads',
  rbacMiddleware(Permission.VIEW_GATE_PASSES),
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
  },
);

// GET /approved-pos — list approved POs with their verified invoices and items (for gate pass creation)
router.get(
  '/approved-pos',
  rbacMiddleware(Permission.VIEW_GATE_PASSES),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pos = await prisma.purchaseOrder.findMany({
        where: { projectId, deletedAt: null, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED'] } },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          items: true,
          gatePasses: {
            where: { deletedAt: null, status: { in: ['PENDING', 'APPROVED'] } },
            select: { items: true },
          },
          goodsReceipts: {
            where: { deletedAt: null, status: 'POSTED' },
            select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
          },
          invoices: {
            where: { deletedAt: null, verificationStatus: 'VERIFIED' },
            select: {
              id: true,
              invoiceCode: true,
              invoiceNumber: true,
              verificationStatus: true,
              stockStatus: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      // Return all approved POs (invoice is optional for gate pass creation)
      // Received quantity is based on accepted quantities from posted Goods Receipts,
      // not gate pass quantities, so rejected material is not counted as received.
      const result = pos.map((po) => {
        const acceptedByPoItemId = new Map<string, number>();
        const acceptedByName = new Map<string, number>();
        for (const receipt of po.goodsReceipts) {
          for (const item of receipt.items) {
            const qty = Number(item.acceptedQty);
            if (item.poItemId) acceptedByPoItemId.set(item.poItemId, (acceptedByPoItemId.get(item.poItemId) ?? 0) + qty);
            const name = item.materialName.toLowerCase();
            acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + qty);
          }
        }
        // Also count gate pass quantities that are approved but not yet inspected/posted
        // so the user can see what is in transit (pending inspection)
        const inTransitByName = new Map<string, number>();
        for (const gatePass of po.gatePasses) {
          for (const item of gatePass.items) {
            const name = item.materialName.toLowerCase();
            inTransitByName.set(name, (inTransitByName.get(name) ?? 0) + Number(item.quantity));
          }
        }
        return {
          id: po.id,
          poNumber: po.poNumber,
          vendor: po.vendor,
          grandTotal: Number(po.grandTotal),
          items: po.items.map((item) => {
            const orderedQuantity = Number(item.quantity);
            const acceptedQuantity =
              item.id && acceptedByPoItemId.has(item.id)
                ? acceptedByPoItemId.get(item.id)!
                : acceptedByName.get(item.materialName.toLowerCase()) ?? 0;
            const inTransitQuantity = Math.max(0, (inTransitByName.get(item.materialName.toLowerCase()) ?? 0) - acceptedQuantity);
            return {
              materialName: item.materialName,
              quantity: orderedQuantity,
              orderedQuantity,
              receivedQuantity: acceptedQuantity,
              inTransitQuantity,
              remainingQuantity: Math.max(0, orderedQuantity - acceptedQuantity),
              unit: item.unit,
            };
          }),
          invoices: po.invoices,
        };
      });
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  },
);

// GET / — list gate passes
router.get(
  '/',
  rbacMiddleware(Permission.VIEW_GATE_PASSES),
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
  },
);

// GET /:id
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_GATE_PASSES),
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
  },
);

// GET /:id/pdf — download the gate pass PDF without requiring OTP approval
router.get(
  '/:id/pdf',
  rbacMiddleware(Permission.VIEW_GATE_PASSES),
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
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${record.passNumber}.pdf"`);
      streamGatePassPdf(res, record);
    } catch (error) {
      next(error);
    }
  },
);

// POST / — create gate pass (request OTP)
router.post(
  '/',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  upload.single('photoProof'),
  validateMiddleware(createGatePassSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const {
        gatePassCategory,
        poId,
        items: rawItems,
        invoiceId,
        otpRequestedFor,
        visitorName,
        visitorPhone,
        visitDate,
        visitTime,
        purpose,
        vehicleType,
        vehicleNumber,
        driverName,
        driverMobile,
        materialMovement,
        gatePassType,
        photoProofPath,
        remarks,
      } = req.body;

      const isVisitorGatePass = gatePassCategory === 'VISITOR';
      let items: { materialName: string; quantity: number; unit?: string | null }[] = [];
      let poItemsByName = new Map<string, { id: string; unit: string | null }>();

      if (isVisitorGatePass) {
        if (invoiceId || poId || rawItems) {
          res.status(400).json({ error: 'Visitor gatepasses cannot include a PO, invoice, or material items' });
          return;
        }
      } else {
        if (!poId) {
          res.status(400).json({ error: 'Purchase order is required for a material gatepass' });
          return;
        }
        const po = await prisma.purchaseOrder.findFirst({
          where: { id: poId, projectId, deletedAt: null },
          include: {
            items: true,
            gatePasses: {
              where: { deletedAt: null, status: { in: ['PENDING', 'APPROVED'] } },
              select: { items: true },
            },
            goodsReceipts: {
              where: { deletedAt: null, status: 'POSTED' },
              select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
            },
          },
        });
        if (!po) {
          res.status(400).json({ error: 'Purchase order not found' });
          return;
        }
        if (!['APPROVED', 'PARTIALLY_DELIVERED'].includes(po.status)) {
          res.status(400).json({ error: 'Purchase order must be approved first' });
          return;
        }

        // Invoice is optional for all payment types. If provided, it is validated below.

        // Accepted quantities from posted Goods Receipts
        const acceptedByPoItemId = new Map<string, number>();
        const acceptedByName = new Map<string, number>();
        for (const receipt of po.goodsReceipts) {
          for (const item of receipt.items) {
            const qty = Number(item.acceptedQty);
            if (item.poItemId) acceptedByPoItemId.set(item.poItemId, (acceptedByPoItemId.get(item.poItemId) ?? 0) + qty);
            const name = item.materialName.toLowerCase();
            acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + qty);
          }
        }
        // Gate pass quantities in transit (approved but not yet posted as accepted)
        const inTransitByName = new Map<string, number>();
        for (const existingGatePass of po.gatePasses) {
          for (const item of existingGatePass.items) {
            const name = item.materialName.toLowerCase();
            inTransitByName.set(name, (inTransitByName.get(name) ?? 0) + Number(item.quantity));
          }
        }
        // Remaining = ordered - accepted - in-transit (not yet inspected)
        const remainingByName = new Map(po.items.map((item) => [
          item.materialName.toLowerCase(),
          Math.max(
            0,
            Number(item.quantity) -
              (item.id && acceptedByPoItemId.has(item.id)
                ? acceptedByPoItemId.get(item.id)!
                : acceptedByName.get(item.materialName.toLowerCase()) ?? 0) -
              (inTransitByName.get(item.materialName.toLowerCase()) ?? 0),
          ),
        ]));

        // Gate pass is an authorization document — auto-fill all remaining PO items.
        // Actual delivered quantities are entered at goods receipt creation.
        items = po.items
          .filter((item) => (remainingByName.get(item.materialName.toLowerCase()) ?? 0) > 0)
          .map((item) => ({
            materialName: item.materialName,
            quantity: remainingByName.get(item.materialName.toLowerCase())!,
            unit: item.unit ?? undefined,
          }));
        if (items.length === 0) {
          res.status(400).json({ error: 'All items from this purchase order have already been delivered or are in transit' });
          return;
        }
        poItemsByName = new Map(po.items.map((item) => [item.materialName.toLowerCase(), { id: item.id, unit: item.unit }]));
      }

      // Validate invoice only if provided (invoice is optional for all payment types)
      if (invoiceId) {
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
      } else {
        // No invoice provided — check if an approved gate pass already exists for this PO without an invoice
        const existingGP = await prisma.gatePass.findFirst({
          where: { poId, projectId, deletedAt: null, status: 'APPROVED', invoiceId: null },
        });
        if (existingGP) {
          res
            .status(409)
            .json({ error: 'An approved gate pass already exists for this purchase order' });
          return;
        }
      }

      // Validate otpRequestedFor is one of the 4 heads
      const headUser = await prisma.user.findUnique({ where: { id: otpRequestedFor } });
      if (!headUser || !HEAD_ROLES.includes(headUser.role as UserRole)) {
        res.status(400).json({ error: 'OTP recipient must be one of the 4 heads' });
        return;
      }

      const passNumber = await generateUniquePassNumber();
      let uploadedPhotoPath: string | null = photoProofPath || null;
      if (req.file) {
        if (!req.file.mimetype.startsWith('image/')) {
          res.status(400).json({ error: 'Photo proof must be an image' });
          return;
        }
        const uploadResult = await getStorageService().upload(
          req.file.buffer,
          `gate-passes/${passNumber}-${req.file.originalname}`,
          req.file.mimetype,
          'documents',
        );
        uploadedPhotoPath = uploadResult.filePath;
      }

      const gatePass = await prisma.gatePass.create({
        data: {
          projectId,
          ...(poId ? { poId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
          gatePassCategory,
          passNumber,
          ...(visitDate ? { date: new Date(visitDate) } : {}),
          visitTime: isVisitorGatePass ? visitTime || null : null,
          visitorName: isVisitorGatePass ? visitorName || null : null,
          visitorPhone: isVisitorGatePass ? visitorPhone || null : null,
          purpose: isVisitorGatePass ? purpose || null : null,
          vehicleType: isVisitorGatePass ? null : vehicleType || null,
          vehicleNumber: isVisitorGatePass ? null : vehicleNumber ? String(vehicleNumber).trim().toUpperCase() : null,
          driverName: isVisitorGatePass ? null : driverName || null,
          driverMobile: isVisitorGatePass ? null : driverMobile || null,
          materialMovement: materialMovement ?? true,
          gatePassType: gatePassType ?? 'NON_RETURNABLE',
          photoProofPath: uploadedPhotoPath,
          remarks: remarks || null,
          status: 'PENDING',
          otpRequestedFor,
          createdBy: req.user!.id,
          items: {
            create: items.map((item) => ({
              materialName: item.materialName,
              quantity: item.quantity,
              unit: item.unit || poItemsByName.get(item.materialName.toLowerCase())?.unit || null,
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
        newValue: { passNumber, gatePassCategory, poId: poId ?? null, invoiceId: invoiceId ?? null, otpRequestedFor },
      });

      // Notify all heads about the new gate pass
      notifyAllHeads(projectId, {
        entityType: 'GATE_PASS',
        entityId: gatePass.id,
        title: gatePassCategory === 'VISITOR' ? 'New Visitor Gate Pass Created' : 'New Material Gate Pass Created',
        body: `${gatePassCategory === 'VISITOR' ? 'Visitor' : 'Material'} gate pass ${passNumber} — OTP sent to ${headUser.name}`,
        url: '/gate-passes',
      }).catch((err) => console.error('[Push] Gate pass notification error:', err));

      // Return the gate pass — the frontend will use Firebase to send the OTP to the head's phone
      res.status(201).json({
        ...gatePass,
        headPhone: headUser.phone,
        headName: headUser.name,
        message: `Gate pass created. An OTP has been sent to ${headUser.name} at ${headUser.phone}. Get the OTP from them to approve.`,
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /:id/verify-otp — verify Firebase ID token and approve gate pass
router.post(
  '/:id/verify-otp',
  rbacMiddleware(Permission.CREATE_GATE_PASS),
  validateMiddleware(verifyGatePassOtpSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const gatePass = await prisma.gatePass.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          purchaseOrder: { include: { items: true, approvalWorkflow: { select: { id: true } } } },
          items: true,
          otpRequestedForUser: { select: { id: true, name: true, phone: true } },
        },
      });
      if (!gatePass) {
        res.status(404).json({ error: 'Gate pass not found' });
        return;
      }
      if (gatePass.status === 'APPROVED') {
        res.status(400).json({ error: 'Gate pass already approved' });
        return;
      }
      if (!gatePass.otpRequestedForUser) {
        res.status(400).json({ error: 'No OTP recipient was set for this gate pass' });
        return;
      }

      // Verify the Firebase ID token
      const { idToken } = req.body;
      let decodedToken;
      try {
        decodedToken = await verifyFirebaseToken(idToken);
      } catch {
        res.status(400).json({ error: 'Invalid or expired OTP token' });
        return;
      }

      // Check that the phone number in the verified token matches the selected head's phone number
      const tokenPhone = decodedToken.phone_number;
      const headPhone = gatePass.otpRequestedForUser.phone;
      if (!tokenPhone || !headPhone || tokenPhone !== headPhone) {
        res
          .status(400)
          .json({
            error:
              'OTP was not verified for the correct head. The OTP must be sent to ' + headPhone,
          });
        return;
      }

      // OTP approval only approves the gate pass. Inventory is intentionally decoupled
      // until the inventory receiving workflow is defined.

      // Mark gate pass as approved
      const updated = await prisma.gatePass.update({
        where: { id: gatePass.id },
        data: {
          status: 'APPROVED',
          otpApprovedBy: gatePass.otpRequestedForUser.id,
          otpApprovedAt: new Date(),
        },
        include: gatePassInclude,
      });

      if (gatePass.poId) {
        // PO status is based on accepted quantities from posted Goods Receipts,
        // not gate pass quantities. Rejected material does not count as received.
        const poWithReceipts = await prisma.purchaseOrder.findUnique({
          where: { id: gatePass.poId },
          include: {
            items: true,
            goodsReceipts: {
              where: { deletedAt: null, status: 'POSTED' },
              select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
            },
          },
        });
      if (poWithReceipts) {
        const acceptedByPoItemId = new Map<string, number>();
        const acceptedByName = new Map<string, number>();
        for (const receipt of poWithReceipts.goodsReceipts) {
          for (const item of receipt.items) {
            const qty = Number(item.acceptedQty);
            if (item.poItemId) acceptedByPoItemId.set(item.poItemId, (acceptedByPoItemId.get(item.poItemId) ?? 0) + qty);
            const name = item.materialName.toLowerCase();
            acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + qty);
          }
        }
        const fullyReceived = poWithReceipts.items.every(
          (item) =>
            (item.id && acceptedByPoItemId.has(item.id)
              ? acceptedByPoItemId.get(item.id)!
              : acceptedByName.get(item.materialName.toLowerCase()) ?? 0) >= Number(item.quantity),
        );
        await prisma.purchaseOrder.update({
          where: { id: gatePass.poId },
          data: { status: fullyReceived ? 'DELIVERED' : 'PARTIALLY_DELIVERED' },
        });
      }
      }

      await logAudit({
        userId: gatePass.otpRequestedForUser.id,
        action: AuditAction.APPROVE,
        entityType: 'GATE_PASS',
        entityId: gatePass.id,
        projectId,
        newValue: { status: 'APPROVED', approvedBy: gatePass.otpRequestedForUser.id, requestedBy: req.user!.id, inventoryUpdated: false },
      });

      res.json({
        ...updated,
        inventoryResults: [],
        message: 'Gate pass approved. Inventory has not been updated.',
      });
    } catch (error) {
      next(error);
    }
  },
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
      if (existing.createdBy !== req.user!.id) {
        res.status(403).json({ error: 'Only the creator can delete this gate pass' });
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

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'GATE_PASS',
        entityId: existing.id,
        projectId,
      });

      res.json({ message: 'Gate pass deleted' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
