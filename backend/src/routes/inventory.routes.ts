import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, InventoryTxnType, UserRole, InventoryItemType, AssetStatus, AssetMovementType } from '@hospital-erp/shared';
import {
  createInventoryItemSchema,
  updateInventoryItemSchema,
  createInventoryTxnSchema,
  listInventorySchema,
  listInventoryTxnsSchema,
} from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { notifyAllHeads } from '../services/push.service';
import { generateAssetId } from './asset.routes';

const CATEGORY_SKU_PREFIXES: Record<string, string> = {
  MATERIAL: 'MAT',
  ELECTRICAL: 'ELC',
  MACHINERY: 'MCH',
  TOOLS: 'TOL',
  CONSUMABLE: 'CON',
  STEEL: 'STL',
  CEMENT: 'CMT',
  WOOD: 'WOD',
  PLUMBING: 'PLB',
  HARDWARE: 'HRD',
  PAINT: 'PNT',
  SAFETY: 'SAF',
};

function categoryPrefix(category: string | null | undefined): string {
  if (!category) return 'GEN';
  const upper = category.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (CATEGORY_SKU_PREFIXES[upper]) return CATEGORY_SKU_PREFIXES[upper];
  return upper.slice(0, 3) || 'GEN';
}

async function generateInventorySku(projectId: string, category: string | null): Promise<string> {
  const prefix = categoryPrefix(category);
  const existing = await prisma.inventoryItem.findMany({
    where: { projectId, sku: { startsWith: `${prefix}-` }, deletedAt: null },
    select: { sku: true },
  });
  const maxNumber = existing.reduce((max, item) => {
    const match = item.sku?.match(/^([A-Z]+)-(\d+)$/);
    return match ? Math.max(max, Number(match[2])) : max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(4, '0')}`;
}

const router = Router();
router.use(authMiddleware);

// GET /items — list inventory items
router.get(
  '/items',
  validateMiddleware(listInventorySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search, category, itemType } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        deletedAt: null,
        ...(category ? { category } : {}),
        ...(itemType ? { itemType } : {}),
      };
      if (search) {
        where.OR = [
          { name: { contains: String(search), mode: 'insensitive' } },
          { sku: { contains: String(search), mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.inventoryItem.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.inventoryItem.count({ where }),
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

// POST /items — create inventory item
router.post(
  '/items',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(createInventoryItemSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = req.user!.projectId;
      if (!projectId) {
        res.status(400).json({ error: 'User is not assigned to a project' });
        return;
      }

      if (req.body.currentStock !== undefined && Number(req.body.currentStock) !== 0) {
        res.status(400).json({ error: 'Opening stock must be added through a goods receipt' });
        return;
      }

      const sku = req.body.sku || await generateInventorySku(projectId, req.body.category ?? null);

      const record = await prisma.inventoryItem.create({
        data: { ...req.body, sku, currentStock: 0, projectId },
      });

      if (record.itemType === InventoryItemType.ASSET) {
        await prisma.$transaction(async (tx) => {
          const assetId = await generateAssetId(tx);
          const asset = await tx.asset.create({
            data: {
              projectId,
              inventoryItemId: record.id,
              assetId,
              status: AssetStatus.ACTIVE,
              location: record.location ?? 'Main Store',
            },
          });
          await tx.assetMovement.create({
            data: {
              assetId: asset.id,
              type: AssetMovementType.CREATED,
              toLocation: record.location ?? 'Main Store',
              toStatus: AssetStatus.ACTIVE,
              notes: 'Created with inventory item',
              userId: req.user!.id,
            },
          });
        });
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'INVENTORY_ITEM',
        entityId: record.id,
        projectId,
        newValue: { name: record.name },
      });

      notifyAllHeads(projectId, {
        entityType: 'INVENTORY_ITEM',
        entityId: record.id,
        title: 'New Inventory Item',
        body: `Item "${record.name}" added to inventory`,
        url: '/inventory',
      }).catch((err) => console.error('[Push] Inventory item notification error:', err));

      res.status(201).json(record);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /items/:id — update inventory item
router.patch(
  '/items/:id',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(updateInventoryItemSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.inventoryItem.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }

      if (req.body.currentStock !== undefined) {
        res.status(400).json({ error: 'Stock changes must be recorded through a receipt or stock movement' });
        return;
      }

      // Allow itemType change only when item has no stock, transactions, or assets
      if (req.body.itemType !== undefined && req.body.itemType !== existing.itemType) {
        if (Number(existing.currentStock) !== 0) {
          res.status(400).json({ error: 'Item type cannot be changed while stock is non-zero. Remove stock first.' });
          return;
        }
        const txnCount = await prisma.inventoryTransaction.count({ where: { itemId: existing.id } });
        const assetCount = await prisma.asset.count({ where: { inventoryItemId: existing.id } });
        if (txnCount > 0 || assetCount > 0) {
          res.status(400).json({ error: 'Item type cannot be changed after transactions or assets exist. Delete and recreate the item if needed.' });
          return;
        }
      }

      const updated = await prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: req.body,
      });

      const auditValue: Record<string, unknown> = { ...req.body };
      if (req.body.itemType !== undefined && req.body.itemType !== existing.itemType) {
        auditValue.itemTypeChanged = { from: existing.itemType, to: req.body.itemType };
      }

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'INVENTORY_ITEM',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { name: existing.name, itemType: existing.itemType },
        newValue: auditValue,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /items/:id — soft delete
router.delete(
  '/items/:id',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.inventoryItem.findFirst({
        where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }

      if (Number(existing.currentStock) !== 0) {
        res.status(400).json({ error: 'Inventory items with stock cannot be deleted' });
        return;
      }

      await prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        entityType: 'INVENTORY_ITEM',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        oldValue: { name: existing.name },
      });

      res.json({ message: 'Inventory item deleted' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /transactions — list transactions
router.get(
  '/transactions',
  validateMiddleware(listInventoryTxnsSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, itemId, type } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        inventoryItem: { projectId: req.user!.projectId },
        ...(itemId ? { itemId } : {}),
        ...(type ? { type } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.inventoryTransaction.findMany({
          where,
          include: {
            inventoryItem: { select: { id: true, name: true, unit: true } },
            user: { select: { id: true, name: true } },
            gatePass: { select: { id: true, passNumber: true } },
          },
          orderBy: { timestamp: 'desc' },
          skip: (Number(page) - 1) * Number(pageSize),
          take: Number(pageSize),
        }),
        prisma.inventoryTransaction.count({ where }),
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

// POST /transactions — record stock movement (updates balance)
router.post(
  '/transactions',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(createInventoryTxnSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const item = await prisma.inventoryItem.findFirst({
        where: { id: req.body.itemId, projectId: requireProjectId(req), deletedAt: null },
      });
      if (!item) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }
      if (req.body.type === InventoryTxnType.IN) {
        res.status(400).json({ error: 'Inbound stock must be posted from an inspected goods receipt' });
        return;
      }
      // ── B24: Asset-typed items must only move via the asset lifecycle ──
      // Generic OUT/ADJUST on an ASSET item would change currentStock without
      // updating the underlying Asset status, causing the register and stock
      // to diverge. Asset issues, returns, maintenance, and retirement all go
      // through dedicated endpoints that keep both in sync.
      if (item.itemType === InventoryItemType.ASSET) {
        res.status(400).json({
          error: 'Asset-typed items cannot be adjusted via generic inventory transactions. Use the asset issue/return/maintenance/retire workflow instead.',
        });
        return;
      }
      if (req.body.type === InventoryTxnType.ADJUST && ![UserRole.ADMIN, UserRole.ADMIN_2].includes(req.user!.role as UserRole)) {
        res.status(403).json({ error: 'Only inventory administrators can make stock adjustments' });
        return;
      }

      const quantity = Number(req.body.quantity);
      const currentStock = Number(item.currentStock);
      let newBalance: number;

      if (req.body.type === InventoryTxnType.IN) {
        newBalance = currentStock + Math.abs(quantity);
      } else if (req.body.type === InventoryTxnType.OUT) {
        newBalance = currentStock - Math.abs(quantity);
        if (newBalance < 0) {
          res.status(400).json({
            error: `Insufficient stock. Current: ${currentStock}, Requested: ${Math.abs(quantity)}`,
          });
          return;
        }
      } else {
        // ── B27: Prevent negative stock on ADJUST ──
        newBalance = quantity;
        if (newBalance < 0) {
          res.status(400).json({ error: `Adjustment would set stock to a negative value (${newBalance})` });
          return;
        }
      }

      const [txn] = await prisma.$transaction([
        prisma.inventoryTransaction.create({
          data: {
            itemId: item.id,
            gatePassId: req.body.gatePassId ?? null,
            type: req.body.type,
            quantity,
            balanceAfter: newBalance,
            userId: req.user!.id,
            notes: req.body.notes ?? null,
          },
        }),
        prisma.inventoryItem.update({
          where: { id: item.id },
          data: { currentStock: newBalance },
        }),
      ]);

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'INVENTORY_ITEM',
        entityId: item.id,
        projectId: req.user!.projectId,
        oldValue: { currentStock },
        newValue: { currentStock: newBalance, txnType: req.body.type, quantity },
      });

      notifyAllHeads(requireProjectId(req), {
        entityType: 'INVENTORY_TRANSACTION',
        entityId: txn.id,
        title: `Stock ${req.body.type === InventoryTxnType.IN ? 'In' : 'Out'}`,
        body: `${item.name}: ${Math.abs(quantity)} units — Balance: ${newBalance}`,
        url: '/inventory',
      }).catch((err) => console.error('[Push] Inventory txn notification error:', err));

      res.status(201).json(txn);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
