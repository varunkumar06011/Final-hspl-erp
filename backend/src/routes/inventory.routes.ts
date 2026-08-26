import { Router, Response, NextFunction } from 'express';
import { Permission, AuditAction, InventoryTxnType, UserRole } from '@hospital-erp/shared';
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

const router = Router();
router.use(authMiddleware);

// GET /items — list inventory items
router.get(
  '/items',
  validateMiddleware(listInventorySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, pageSize = 20, search, category } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        projectId: req.user!.projectId,
        deletedAt: null,
        ...(category ? { category } : {}),
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

      const record = await prisma.inventoryItem.create({
        data: { ...req.body, currentStock: 0, projectId },
      });

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

      const updated = await prisma.inventoryItem.update({
        where: { id: req.params.id },
        data: req.body,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'INVENTORY_ITEM',
        entityId: req.params.id,
        projectId: req.user!.projectId,
        newValue: req.body,
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
        newBalance = quantity;
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
