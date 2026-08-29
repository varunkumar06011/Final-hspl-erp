import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, AssetStatus, AssetMovementType, UserRole, InventoryItemType } from '@hospital-erp/shared';
import {
  listAssetsSchema,
  createAssetSchema,
  updateAssetSerialSchema,
  updateAssetDetailsSchema,
  issueAssetSchema,
  returnAssetSchema,
  relocateAssetSchema,
  sendMaintenanceSchema,
  completeMaintenanceSchema,
  scanAssetSchema,
  generateAssetsSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { optionalAuthMiddleware } from '../middleware/optional-auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';

const router = Router();

const ASSET_ADMIN_ROLES = [UserRole.ADMIN, UserRole.ADMIN_2];

const assetInclude = {
  inventoryItem: { select: { id: true, name: true, category: true, unit: true, itemType: true } },
  issuedByUser: { select: { id: true, name: true } },
  movements: {
    orderBy: { timestamp: 'desc' as const },
    include: { user: { select: { id: true, name: true, role: true } } },
    take: 50,
  },
  scans: {
    orderBy: { timestamp: 'desc' as const },
    include: { user: { select: { id: true, name: true } } },
    take: 20,
  },
  maintenances: {
    orderBy: { sentAt: 'desc' as const },
    include: {
      sentByUser: { select: { id: true, name: true } },
      completedByUser: { select: { id: true, name: true } },
    },
  },
};

/**
 * Generate the next human-readable asset ID: VGH-AST-00001, VGH-AST-00002, ...
 */
async function generateAssetId(tx: Prisma.TransactionClient): Promise<string> {
  const lastAsset = await tx.asset.findFirst({
    where: { assetId: { startsWith: 'VGH-AST-' } },
    orderBy: { assetId: 'desc' },
    select: { assetId: true },
  });
  let nextNum = 1;
  if (lastAsset) {
    const match = lastAsset.assetId.match(/^VGH-AST-(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `VGH-AST-${String(nextNum).padStart(5, '0')}`;
}

// GET / — list assets with filters
router.get(
  '/',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(listAssetsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { page, pageSize, inventoryItemId, status, location, search, category, warrantyExpiring, amcExpiring } = req.query as Record<string, unknown>;
      const where: Prisma.AssetWhereInput = { projectId };
      if (inventoryItemId) where.inventoryItemId = String(inventoryItemId);
      if (status) where.status = String(status);
      if (location) where.location = { contains: String(location), mode: 'insensitive' };
      if (category) where.inventoryItem = { category: { contains: String(category), mode: 'insensitive' } };
      if (search) {
        where.OR = [
          { assetId: { contains: String(search), mode: 'insensitive' } },
          { serialNumber: { contains: String(search), mode: 'insensitive' } },
          { udi: { contains: String(search), mode: 'insensitive' } },
          { gtin: { contains: String(search), mode: 'insensitive' } },
        ];
      }
      // Warranty expiring within N days
      if (warrantyExpiring) {
        const days = Number(warrantyExpiring);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + days);
        where.warrantyExpiry = { gte: new Date(), lte: cutoff };
      }
      // AMC expiring within N days
      if (amcExpiring) {
        const days = Number(amcExpiring);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + days);
        where.amcExpiry = { gte: new Date(), lte: cutoff };
      }

      const [data, total] = await Promise.all([
        prisma.asset.findMany({
          where,
          include: assetInclude,
          orderBy: { assetId: 'asc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.asset.count({ where }),
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

// GET /stats — asset dashboard stats
// NOTE: must be registered before GET /:id, otherwise /:id shadows /stats
router.get(
  '/stats',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const now = new Date();
      const thirtyDaysLater = new Date();
      thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

      const [total, byStatus, warrantyExpiring, amcExpiring, byCategory] = await Promise.all([
        prisma.asset.count({ where: { projectId } }),
        prisma.asset.groupBy({ by: ['status'], where: { projectId }, _count: true }),
        prisma.asset.count({ where: { projectId, warrantyExpiry: { gte: now, lte: thirtyDaysLater } } }),
        prisma.asset.count({ where: { projectId, amcExpiry: { gte: now, lte: thirtyDaysLater } } }),
        prisma.asset.findMany({
          where: { projectId },
          select: { inventoryItem: { select: { category: true } }, totalCost: true },
        }),
      ]);

      const categoryMap = new Map<string, number>();
      let totalValue = 0;
      for (const a of byCategory) {
        const cat = a.inventoryItem.category ?? 'Uncategorized';
        categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
        if (a.totalCost) totalValue += Number(a.totalCost);
      }

      const statusCounts: Record<string, number> = {};
      for (const s of byStatus) statusCounts[s.status] = s._count;

      res.json({
        total,
        statusCounts,
        warrantyExpiring,
        amcExpiring,
        totalValue,
        categoryCounts: Object.fromEntries(categoryMap),
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /generate/:itemId — generate missing individual asset records for an
// inventory item whose stock was received before per-unit asset tracking was
// introduced (or otherwise lacks asset rows). Creates one Asset per missing unit.
router.post(
  '/generate/:itemId',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(generateAssetsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const item = await prisma.inventoryItem.findFirst({
        where: { id: req.params.itemId, projectId, deletedAt: null },
      });
      if (!item) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }
      if (item.itemType !== InventoryItemType.ASSET) {
        res.status(400).json({ error: 'Only asset-type items can have asset records' });
        return;
      }

      const existingCount = await prisma.asset.count({ where: { inventoryItemId: item.id, projectId } });
      const targetCount = Math.floor(Number(item.currentStock));
      const missing = targetCount - existingCount;
      if (missing <= 0) {
        res.json({ created: 0, message: 'All asset records already exist for this item.' });
        return;
      }

      const created = await prisma.$transaction(async (tx) => {
        const assets: { id: string; assetId: string }[] = [];
        for (let i = 0; i < missing; i++) {
          const assetId = await generateAssetId(tx);
          const asset = await tx.asset.create({
            data: {
              projectId,
              inventoryItemId: item.id,
              assetId,
              status: AssetStatus.ACTIVE,
              location: item.location ?? 'Main Store',
            },
          });
          await tx.assetMovement.create({
            data: {
              assetId: asset.id,
              type: AssetMovementType.CREATED,
              toLocation: item.location ?? 'Main Store',
              toStatus: AssetStatus.ACTIVE,
              notes: 'Generated to match received stock',
              userId: req.user!.id,
            },
          });
          assets.push({ id: asset.id, assetId: asset.assetId });
        }
        return assets;
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'ASSET',
        entityId: item.id,
        projectId,
        newValue: { generated: created.length, itemId: item.id },
      });

      res.status(201).json({ created: created.length });
    } catch (error) {
      next(error);
    }
  }
);

// POST /:itemId — manually create a new asset unit for an inventory item
router.post(
  '/:itemId',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(createAssetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const item = await prisma.inventoryItem.findFirst({
        where: { id: req.params.itemId, projectId, deletedAt: null },
      });
      if (!item) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }
      if (item.itemType !== InventoryItemType.ASSET) {
        res.status(400).json({ error: 'Only asset-type items can have asset records' });
        return;
      }

      const data = req.body;
      const result = await prisma.$transaction(async (tx) => {
        const assetId = await generateAssetId(tx);
        const asset = await tx.asset.create({
          data: {
            projectId,
            inventoryItemId: item.id,
            assetId,
            status: AssetStatus.ACTIVE,
            location: data.location,
            serialNumber: data.serialNumber ?? null,
            notes: data.notes ?? null,
            udi: data.udi ?? null,
            gtin: data.gtin ?? null,
            warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
            amcVendor: data.amcVendor ?? null,
            amcExpiry: data.amcExpiry ? new Date(data.amcExpiry) : null,
            usefulLifeYears: data.usefulLifeYears ?? null,
            depreciationMethod: data.depreciationMethod ?? null,
            salvageValue: data.salvageValue ?? null,
            vendorName: data.vendorName ?? null,
            poNumber: data.poNumber ?? null,
            invoiceNumber: data.invoiceNumber ?? null,
            receiptNumber: data.receiptNumber ?? null,
            unitPrice: data.unitPrice ?? null,
            totalCost: data.totalCost ?? null,
            receiptDate: data.receiptDate ? new Date(data.receiptDate) : null,
          },
        });
        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.CREATED,
            toLocation: data.location,
            toStatus: AssetStatus.ACTIVE,
            notes: data.notes ?? 'Manually registered asset',
            userId: req.user!.id,
          },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: item.id,
            type: 'IN',
            quantity: 1,
            balanceAfter: Number(item.currentStock) + 1,
            userId: req.user!.id,
            notes: `Manual asset creation: ${assetId}`,
          },
        });
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { currentStock: Number(item.currentStock) + 1 },
        });
        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'ASSET',
        entityId: result!.id,
        projectId,
        newValue: { assetId: result!.assetId, itemId: item.id },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id — full asset lifecycle
router.get(
  '/:id',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
        include: assetInclude,
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      res.json(asset);
    } catch (error) {
      next(error);
    }
  }
);

// GET /:id/trace — full procurement chain traceability for an asset.
// Returns the live linked records (vendor + referenceBy, quotation, purchase
// order + items + budget head + created-by, gate pass + items, goods receipt +
// inspection + created/inspected/posted-by users) so the frontend can render a
// complete backtrackable history. Falls back to snapshot strings when a FK is
// null (e.g. legacy assets whose source record was deleted).
const traceInclude = {
  inventoryItem: { select: { id: true, name: true, category: true, unit: true, itemType: true } },
  vendor: {
    select: {
      id: true, vendorCode: true, name: true, referenceBy: true, contactPersonName: true,
      contactPersonPhone: true, phone: true, email: true, gstNumber: true, address: true, category: true, status: true,
    },
  },
  quotation: {
    select: {
      id: true, quotationNumber: true, date: true, status: true, totalAmount: true, gstAmount: true,
      grandTotal: true, fileName: true, filePath: true, fileMimeType: true,
      items: { select: { id: true, materialName: true, quantity: true, unit: true, unitPrice: true, amount: true, gstRate: true } },
      createdByUser: { select: { id: true, name: true } },
    },
  },
  purchaseOrder: {
    select: {
      id: true, poNumber: true, date: true, status: true, paymentType: true, deliveryDate: true,
      totalAmount: true, gstAmount: true, grandTotal: true, notes: true, regenerationNumber: true, editReason: true,
      vendor: { select: { id: true, name: true, vendorCode: true, referenceBy: true } },
      quotation: { select: { id: true, quotationNumber: true, date: true } },
      budgetHead: { select: { id: true, particulars: true } },
      createdByUser: { select: { id: true, name: true } },
      items: { select: { id: true, materialName: true, quantity: true, unit: true, unitPrice: true, gstRate: true, amount: true } },
    },
  },
  gatePass: {
    select: {
      id: true, passNumber: true, date: true, status: true, gatePassType: true, vehicleNumber: true,
      driverName: true, driverMobile: true, remarks: true,
      items: { select: { id: true, materialName: true, quantity: true, unit: true } },
      createdByUser: { select: { id: true, name: true } },
    },
  },
  goodsReceipt: {
    select: {
      id: true, receiptNumber: true, status: true, createdAt: true, inspectedAt: true, postedAt: true,
      items: { select: { id: true, materialName: true, deliveredQty: true, acceptedQty: true, rejectedQty: true, rejectionReason: true, itemType: true } },
      inspection: { select: { id: true, status: true, completedDate: true } },
      createdByUser: { select: { id: true, name: true } },
      inspectedByUser: { select: { id: true, name: true } },
      postedByUser: { select: { id: true, name: true } },
    },
  },
};

router.get(
  '/:id/trace',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
        include: traceInclude,
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      res.json(asset);
    } catch (error) {
      next(error);
    }
  }
);


// PATCH /:id/serial — update serial number (only if not issued)
router.patch(
  '/:id/serial',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(updateAssetSerialSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status === AssetStatus.ISSUED) {
        res.status(400).json({ error: 'Serial number cannot be changed while asset is issued. Return it first.' });
        return;
      }
      if (asset.status === AssetStatus.RETIRED) {
        res.status(400).json({ error: 'Serial number cannot be changed for retired assets' });
        return;
      }

      // Check serial number uniqueness if provided
      if (req.body.serialNumber) {
        const existing = await prisma.asset.findFirst({
          where: { serialNumber: req.body.serialNumber, NOT: { id: asset.id } },
        });
        if (existing) {
          res.status(409).json({ error: 'Another asset already has this serial number' });
          return;
        }
      }

      const oldValue = { serialNumber: asset.serialNumber, notes: asset.notes };
      const updated = await prisma.asset.update({
        where: { id: asset.id },
        data: {
          serialNumber: req.body.serialNumber ?? asset.serialNumber,
          notes: req.body.notes ?? asset.notes,
        },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue,
        newValue: { serialNumber: updated.serialNumber, notes: updated.notes },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /:id/details — update asset details (serial, UDI, GTIN, warranty, AMC, depreciation)
router.patch(
  '/:id/details',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(updateAssetDetailsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status === AssetStatus.RETIRED) {
        res.status(400).json({ error: 'Cannot update details for a retired asset' });
        return;
      }

      // Check serial number uniqueness if being changed
      if (req.body.serialNumber !== undefined && req.body.serialNumber) {
        const existing = await prisma.asset.findFirst({
          where: { serialNumber: req.body.serialNumber, NOT: { id: asset.id } },
        });
        if (existing) {
          res.status(409).json({ error: 'Another asset already has this serial number' });
          return;
        }
      }

      const oldValue = {
        serialNumber: asset.serialNumber,
        notes: asset.notes,
        udi: asset.udi,
        gtin: asset.gtin,
        warrantyExpiry: asset.warrantyExpiry,
        amcVendor: asset.amcVendor,
        amcExpiry: asset.amcExpiry,
        usefulLifeYears: asset.usefulLifeYears,
        depreciationMethod: asset.depreciationMethod,
        salvageValue: asset.salvageValue,
      };

      const data: Record<string, unknown> = {};
      const fields = ['serialNumber', 'notes', 'udi', 'gtin', 'amcVendor', 'depreciationMethod'] as const;
      for (const f of fields) {
        if (req.body[f] !== undefined) data[f] = req.body[f] ?? null;
      }
      if (req.body.warrantyExpiry !== undefined) data.warrantyExpiry = req.body.warrantyExpiry ? new Date(req.body.warrantyExpiry) : null;
      if (req.body.amcExpiry !== undefined) data.amcExpiry = req.body.amcExpiry ? new Date(req.body.amcExpiry) : null;
      if (req.body.usefulLifeYears !== undefined) data.usefulLifeYears = req.body.usefulLifeYears ?? null;
      if (req.body.salvageValue !== undefined) data.salvageValue = req.body.salvageValue ?? null;

      const updated = await prisma.asset.update({
        where: { id: asset.id },
        data,
        include: assetInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue,
        newValue: data,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);
router.post(
  '/:id/issue',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(issueAssetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status !== AssetStatus.ACTIVE) {
        res.status(400).json({ error: `Asset must be ACTIVE to issue. Current status: ${asset.status}` });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        // Optimistic concurrency check
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version, status: AssetStatus.ACTIVE },
          data: {
            status: AssetStatus.ISSUED,
            location: req.body.location,
            issuedToDept: req.body.issuedToDept ?? null,
            issuedToPerson: req.body.issuedToPerson ?? null,
            issuedAt: new Date(),
            issuedBy: req.user!.id,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.ISSUED,
            fromLocation: asset.location,
            toLocation: req.body.location,
            fromStatus: asset.status,
            toStatus: AssetStatus.ISSUED,
            issuedToDept: req.body.issuedToDept ?? null,
            issuedToPerson: req.body.issuedToPerson ?? null,
            notes: req.body.notes ?? null,
            userId: req.user!.id,
          },
        });

        // Also create inventory transaction and decrement stock so the
        // InventoryItem.currentStock stays in sync with the asset register.
        const invItem = await tx.inventoryItem.findUnique({
          where: { id: asset.inventoryItemId },
          select: { currentStock: true },
        });
        const newBalance = Number(invItem?.currentStock ?? 0) - 1;
        await tx.inventoryItem.update({
          where: { id: asset.inventoryItemId },
          data: { currentStock: newBalance },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: asset.inventoryItemId,
            type: 'OUT',
            quantity: 1,
            balanceAfter: newBalance,
            userId: req.user!.id,
            notes: `Asset ${asset.assetId} issued to ${req.body.issuedToDept ?? ''} ${req.body.issuedToPerson ?? ''}`.trim(),
          },
        });

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { status: asset.status, location: asset.location },
        newValue: { status: AssetStatus.ISSUED, location: req.body.location, issuedToDept: req.body.issuedToDept, issuedToPerson: req.body.issuedToPerson },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/return — return asset to stock
router.post(
  '/:id/return',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(returnAssetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status !== AssetStatus.ISSUED && asset.status !== AssetStatus.UNDER_MAINTENANCE) {
        res.status(400).json({ error: `Asset must be ISSUED or UNDER_MAINTENANCE to return. Current status: ${asset.status}` });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version },
          data: {
            status: AssetStatus.ACTIVE,
            location: req.body.location,
            issuedToDept: null,
            issuedToPerson: null,
            issuedAt: null,
            issuedBy: null,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.RETURNED,
            fromLocation: asset.location,
            toLocation: req.body.location,
            fromStatus: asset.status,
            toStatus: AssetStatus.ACTIVE,
            notes: req.body.notes ?? null,
            userId: req.user!.id,
          },
        });

        // ── B21: Only restore inventory stock when returning from ISSUED ──
        // Maintenance (sendMaintenance) does NOT decrement currentStock — the
        // asset stays counted in inventory while being repaired. So returning
        // from UNDER_MAINTENANCE must NOT increment stock either, otherwise we
        // create phantom inventory (+1 for an asset that was never removed).
        // Only ISSUED assets were decremented at issue time, so only they get
        // the +1 restoration here.
        if (asset.status === AssetStatus.ISSUED) {
          const invItem = await tx.inventoryItem.findUnique({
            where: { id: asset.inventoryItemId },
            select: { currentStock: true },
          });
          const newBalance = Number(invItem?.currentStock ?? 0) + 1;
          await tx.inventoryItem.update({
            where: { id: asset.inventoryItemId },
            data: { currentStock: newBalance },
          });
          await tx.inventoryTransaction.create({
            data: {
              itemId: asset.inventoryItemId,
              type: 'IN',
              quantity: 1,
              balanceAfter: newBalance,
              userId: req.user!.id,
              notes: `Asset ${asset.assetId} returned to ${req.body.location}`,
            },
          });
        }

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { status: asset.status, location: asset.location },
        newValue: { status: AssetStatus.ACTIVE, location: req.body.location },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/relocate — change location
router.post(
  '/:id/relocate',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(relocateAssetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status === AssetStatus.RETIRED) {
        res.status(400).json({ error: 'Cannot relocate a retired asset' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version },
          data: {
            location: req.body.location,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.RELOCATED,
            fromLocation: asset.location,
            toLocation: req.body.location,
            reason: req.body.reason ?? null,
            userId: req.user!.id,
          },
        });

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { location: asset.location },
        newValue: { location: req.body.location },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/maintenance — send asset for maintenance
router.post(
  '/:id/maintenance',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(sendMaintenanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status === AssetStatus.RETIRED) {
        res.status(400).json({ error: 'Cannot send a retired asset for maintenance' });
        return;
      }
      if (asset.status === AssetStatus.UNDER_MAINTENANCE) {
        res.status(400).json({ error: 'Asset is already under maintenance' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version },
          data: {
            status: AssetStatus.UNDER_MAINTENANCE,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        await tx.assetMaintenance.create({
          data: {
            assetId: asset.id,
            reason: req.body.reason,
            maintenanceVendor: req.body.maintenanceVendor ?? null,
            technician: req.body.technician ?? null,
            notes: req.body.notes ?? null,
            cost: req.body.cost ?? null,
            sentBy: req.user!.id,
          },
        });

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.MAINTENANCE_START,
            fromStatus: asset.status,
            toStatus: AssetStatus.UNDER_MAINTENANCE,
            notes: req.body.reason,
            userId: req.user!.id,
          },
        });

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { status: asset.status },
        newValue: { status: AssetStatus.UNDER_MAINTENANCE, reason: req.body.reason },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/maintenance/complete — complete maintenance
router.post(
  '/:id/maintenance/complete',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(completeMaintenanceSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status !== AssetStatus.UNDER_MAINTENANCE) {
        res.status(400).json({ error: `Asset must be UNDER_MAINTENANCE to complete. Current status: ${asset.status}` });
        return;
      }

      const targetStatus = req.body.issueDirectly ? AssetStatus.ISSUED : AssetStatus.ACTIVE;
      const targetLocation = req.body.issueDirectly
        ? req.body.returnToLocation ?? asset.location
        : req.body.returnToLocation ?? 'Main Store';

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version, status: AssetStatus.UNDER_MAINTENANCE },
          data: {
            status: targetStatus,
            location: targetLocation,
            ...(req.body.issueDirectly
              ? {
                  issuedToDept: req.body.issuedToDept ?? null,
                  issuedToPerson: req.body.issuedToPerson ?? null,
                  issuedAt: new Date(),
                  issuedBy: req.user!.id,
                }
              : {
                  issuedToDept: null,
                  issuedToPerson: null,
                  issuedAt: null,
                  issuedBy: null,
                }),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        // Find the latest open maintenance record and complete it
        const openMaintenance = await tx.assetMaintenance.findFirst({
          where: { assetId: asset.id, completedAt: null },
          orderBy: { sentAt: 'desc' },
        });
        if (openMaintenance) {
          await tx.assetMaintenance.update({
            where: { id: openMaintenance.id },
            data: {
              completedAt: new Date(),
              completedBy: req.user!.id,
              completionNotes: req.body.completionNotes ?? null,
              finalCost: req.body.finalCost ?? null,
            },
          });
        }

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.MAINTENANCE_COMPLETE,
            fromStatus: AssetStatus.UNDER_MAINTENANCE,
            toStatus: targetStatus,
            fromLocation: asset.location,
            toLocation: targetLocation,
            notes: req.body.completionNotes ?? null,
            userId: req.user!.id,
          },
        });

        // ── B20: If issuing directly from maintenance, decrement inventory stock ──
        // Maintenance itself doesn't change stock (the asset stays in inventory
        // while being repaired). But issuing directly means the asset leaves
        // inventory, so currentStock must decrease by 1 — same as a regular issue.
        if (req.body.issueDirectly) {
          const invItem = await tx.inventoryItem.findUnique({
            where: { id: asset.inventoryItemId },
            select: { currentStock: true },
          });
          const newBalance = Number(invItem?.currentStock ?? 0) - 1;
          await tx.inventoryItem.update({
            where: { id: asset.inventoryItemId },
            data: { currentStock: newBalance },
          });
          await tx.inventoryTransaction.create({
            data: {
              itemId: asset.inventoryItemId,
              type: 'OUT',
              quantity: 1,
              balanceAfter: newBalance,
              userId: req.user!.id,
              notes: `Asset ${asset.assetId} issued directly from maintenance to ${req.body.issuedToDept ?? ''} ${req.body.issuedToPerson ?? ''}`.trim(),
            },
          });
        }

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { status: AssetStatus.UNDER_MAINTENANCE },
        newValue: { status: targetStatus, location: targetLocation },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/retire — permanently retire asset
router.post(
  '/:id/retire',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!ASSET_ADMIN_ROLES.includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only Admin and Admin 2 can retire assets' });
        return;
      }
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      if (asset.status === AssetStatus.RETIRED) {
        res.status(400).json({ error: 'Asset is already retired' });
        return;
      }
      // ── B22: Only ACTIVE assets can be retired ──
      // Retiring an ISSUED or UNDER_MAINTENANCE asset would leave the
      // inventory/issue state inconsistent. The asset must be returned to
      // ACTIVE first, then retired.
      if (asset.status !== AssetStatus.ACTIVE) {
        res.status(400).json({ error: `Asset must be ACTIVE to retire. Current status: ${asset.status}. Return the asset first.` });
        return;
      }

      const reason = req.body.reason;
      if (!reason || !String(reason).trim()) {
        res.status(400).json({ error: 'Reason is required to retire an asset' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.asset.updateMany({
          where: { id: asset.id, version: asset.version, status: AssetStatus.ACTIVE },
          data: {
            status: AssetStatus.RETIRED,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new Error('Asset was already modified by another user. Please refresh and try again.');

        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.RETIRED,
            fromStatus: asset.status,
            toStatus: AssetStatus.RETIRED,
            reason: String(reason),
            userId: req.user!.id,
          },
        });

        // ── B22: Decrement inventory stock on retirement ──
        // A retired asset is permanently removed from the register, so
        // currentStock must decrease by 1 to keep inventory reconciled.
        const invItem = await tx.inventoryItem.findUnique({
          where: { id: asset.inventoryItemId },
          select: { currentStock: true },
        });
        const newBalance = Number(invItem?.currentStock ?? 0) - 1;
        await tx.inventoryItem.update({
          where: { id: asset.inventoryItemId },
          data: { currentStock: newBalance },
        });
        await tx.inventoryTransaction.create({
          data: {
            itemId: asset.inventoryItemId,
            type: 'OUT',
            quantity: 1,
            balanceAfter: newBalance,
            userId: req.user!.id,
            notes: `Asset ${asset.assetId} retired: ${String(reason)}`,
          },
        });

        return tx.asset.findUnique({ where: { id: asset.id }, include: assetInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        oldValue: { status: asset.status },
        newValue: { status: AssetStatus.RETIRED, reason },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /scan/:assetId — public endpoint (no auth required, limited fields)
router.get(
  '/scan/:assetId',
  optionalAuthMiddleware,
  validateMiddleware(scanAssetSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const asset = await prisma.asset.findUnique({
        where: { assetId: req.params.assetId },
        include: {
          inventoryItem: { select: { id: true, name: true, category: true, itemType: true } },
        },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }

      // If authenticated, record scan + update last scan info
      if (req.user) {
        // Deduplicate: skip if same user scanned within 60 seconds
        const recentScan = await prisma.assetScan.findFirst({
          where: {
            assetId: asset.id,
            userId: req.user.id,
            timestamp: { gte: new Date(Date.now() - 60_000) },
          },
        });

        if (!recentScan) {
          const userAgent = String(req.headers['user-agent'] ?? '');
          const location = req.body?.location ?? null;
          await prisma.$transaction([
            prisma.assetScan.create({
              data: {
                assetId: asset.id,
                userId: req.user.id,
                userAgent,
                location: location ?? null,
              },
            }),
            prisma.asset.update({
              where: { id: asset.id },
              data: {
                lastScannedAt: new Date(),
                lastScannedBy: req.user.id,
                lastScanLocation: location ?? null,
              },
            }),
            prisma.assetMovement.create({
              data: {
                assetId: asset.id,
                type: AssetMovementType.SCANNED,
                userId: req.user.id,
                notes: location ? `Scanned at ${location}` : 'Scanned',
              },
            }),
          ]);
        }
      }

      // Public fields (always returned)
      const publicFields = {
        assetId: asset.assetId,
        name: asset.inventoryItem.name,
        category: asset.inventoryItem.category,
        status: asset.status,
      };

      // If authenticated, return full lifecycle + traceability chain
      if (req.user) {
        const fullAsset = await prisma.asset.findUnique({
          where: { id: asset.id },
          include: {
            ...assetInclude,
            vendor: { select: { id: true, vendorCode: true, name: true, referenceBy: true, contactPersonName: true, contactPersonPhone: true, phone: true, address: true } },
            quotation: { select: { id: true, quotationNumber: true, date: true, status: true, grandTotal: true } },
            purchaseOrder: { select: { id: true, poNumber: true, date: true, status: true, paymentType: true, grandTotal: true, vendor: { select: { id: true, name: true, vendorCode: true } }, budgetHead: { select: { id: true, particulars: true } }, createdByUser: { select: { id: true, name: true } }, items: { select: { id: true, materialName: true, quantity: true, unit: true, unitPrice: true, gstRate: true } } } },
            gatePass: { select: { id: true, passNumber: true, date: true, status: true, gatePassType: true, items: { select: { id: true, materialName: true, quantity: true, unit: true } }, createdByUser: { select: { id: true, name: true } } } },
            goodsReceipt: { select: { id: true, receiptNumber: true, status: true, createdAt: true, inspectedAt: true, postedAt: true, items: { select: { id: true, materialName: true, deliveredQty: true, acceptedQty: true, rejectedQty: true, itemType: true } }, inspection: { select: { id: true, status: true, completedDate: true } }, createdByUser: { select: { id: true, name: true } }, inspectedByUser: { select: { id: true, name: true } }, postedByUser: { select: { id: true, name: true } } } },
          },
        });
        res.json({ ...publicFields, authenticated: true, full: fullAsset });
      } else {
        res.json({ ...publicFields, authenticated: false });
      }
    } catch (error) {
      next(error);
    }
  }
);

// POST /:id/print-log — log that a QR sticker was printed
router.post(
  '/:id/print-log',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const asset = await prisma.asset.findFirst({
        where: { id: req.params.id, projectId },
      });
      if (!asset) {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'ASSET',
        entityId: asset.id,
        projectId,
        newValue: { action: 'QR_PRINTED', assetId: asset.assetId },
      });

      res.json({ message: 'Print logged' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /export/csv — export all assets for a project as CSV
router.get(
  '/export/csv',
  authMiddleware,
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const assets = await prisma.asset.findMany({
        where: { projectId },
        include: {
          inventoryItem: { select: { name: true, category: true } },
        },
        orderBy: { assetId: 'asc' },
      });

      const headers = [
        'Asset ID', 'Name', 'Category', 'Serial Number', 'UDI', 'GTIN', 'Status', 'Location',
        'Issued To Dept', 'Issued To Person', 'Issued At',
        'Vendor', 'PO Number', 'Invoice Number',
        'Unit Price', 'GST Rate', 'GST Amount', 'Total Cost',
        'Receipt Number', 'Received Date', 'Last Scanned At',
        'Warranty Expiry', 'AMC Vendor', 'AMC Expiry',
        'Useful Life (Years)', 'Depreciation Method', 'Salvage Value',
      ];

      const rows = assets.map((a) => [
        a.assetId,
        a.inventoryItem.name,
        a.inventoryItem.category ?? '',
        a.serialNumber ?? '',
        a.udi ?? '',
        a.gtin ?? '',
        a.status,
        a.location,
        a.issuedToDept ?? '',
        a.issuedToPerson ?? '',
        a.issuedAt ? new Date(a.issuedAt).toISOString() : '',
        a.vendorName ?? '',
        a.poNumber ?? '',
        a.invoiceNumber ?? '',
        a.unitPrice ? String(a.unitPrice) : '',
        a.gstRate ? String(a.gstRate) : '',
        a.gstAmount ? String(a.gstAmount) : '',
        a.totalCost ? String(a.totalCost) : '',
        a.receiptNumber ?? '',
        a.receiptDate ? new Date(a.receiptDate).toISOString() : '',
        a.lastScannedAt ? new Date(a.lastScannedAt).toISOString() : '',
        a.warrantyExpiry ? new Date(a.warrantyExpiry).toISOString() : '',
        a.amcVendor ?? '',
        a.amcExpiry ? new Date(a.amcExpiry).toISOString() : '',
        a.usefulLifeYears ? String(a.usefulLifeYears) : '',
        a.depreciationMethod ?? '',
        a.salvageValue ? String(a.salvageValue) : '',
      ]);

      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="assets-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
export { generateAssetId };
