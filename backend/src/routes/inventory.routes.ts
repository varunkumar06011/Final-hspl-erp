import { Router, Response, NextFunction } from 'express';
import { findDuplicateGroups, mergeInventoryItems } from '../services/inventory-match.service';
import { canOverrideApprovals, Permission, AuditAction, InventoryTxnType, InventoryItemType, AssetStatus, AssetMovementType, isAdminRole } from '@hospital-erp/shared';
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
import { applyOutbound, applyReturn, applyAdjustment } from '../services/inventory-valuation.service';

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

// GET /duplicates — groups of items that look like the same material
router.get(
  '/duplicates',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ data: await findDuplicateGroups(requireProjectId(req)) });
    } catch (error) {
      next(error);
    }
  },
);

// POST /merge — fold a duplicate item into the one to keep (admins and supervisors)
router.post(
  '/merge',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!(isAdminRole(req.user!.role) || req.user!.role === 'SUPERVISOR' || canOverrideApprovals(req.user!.role, req.user!.extraPermissions))) {
        res.status(403).json({ error: 'Only Admins and Supervisors can merge inventory items' });
        return;
      }
      const { sourceId, targetId } = req.body as { sourceId?: string; targetId?: string };
      if (!sourceId || !targetId) {
        res.status(400).json({ error: 'sourceId and targetId are required' });
        return;
      }
      let result;
      try {
        result = await mergeInventoryItems(projectId, sourceId, targetId);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Merge failed' });
        return;
      }
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'INVENTORY_ITEM',
        entityId: targetId,
        projectId,
        newValue: { action: 'MERGE', mergedFrom: sourceId, ...result.summary },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

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
          const assetId = await generateAssetId(tx, projectId);
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
      const { page = 1, pageSize = 20, itemId, type, phaseId, budgetHeadId } = req.query as Record<string, unknown>;
      const where: Record<string, unknown> = {
        inventoryItem: { projectId: requireProjectId(req) },
        ...(itemId ? { itemId } : {}),
        ...(type ? { type } : {}),
        ...(phaseId ? { phaseId } : {}),
        ...(budgetHeadId ? { budgetHeadId } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.inventoryTransaction.findMany({
          where,
          include: {
            inventoryItem: { select: { id: true, name: true, unit: true } },
            user: { select: { id: true, name: true } },
            gatePass: { select: { id: true, passNumber: true } },
            goodsReceipt: { select: { id: true, receiptNumber: true } },
            stockEntry: { select: { id: true, entryNumber: true, sourceType: true } },
            phase: { select: { id: true, name: true } },
            budgetHead: { select: { id: true, particulars: true } },
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
      if (req.body.type === InventoryTxnType.ADJUST && !isAdminRole(req.user!.role)) {
        res.status(403).json({ error: 'Only inventory administrators can make stock adjustments' });
        return;
      }

      const quantity = Number(req.body.quantity);
      const absQty = Math.abs(quantity);
      const currentStock = Number(item.currentStock);

      // ── A18: Atomic stock update ──
      // The previous read→calculate→write let two concurrent issues both
      // compute from the same currentStock and overwrite each other, losing
      // one deduction. We now use Prisma's atomic increment/decrement so the
      // DB applies the delta. The read above is only for the insufficient-stock
      // check and the audit snapshot; the authoritative new balance is read
      // back after the atomic update for the transaction log's balanceAfter.
      // The stock update and the transaction-log row are written in the SAME
      // transaction so a failure rolls back both.
      if (req.body.type === InventoryTxnType.OUT && currentStock < absQty) {
        res.status(400).json({
          error: `Insufficient stock. Current: ${currentStock}, Requested: ${absQty}`,
        });
        return;
      }
      if (req.body.type === InventoryTxnType.ADJUST && quantity < 0) {
        res.status(400).json({ error: `Adjustment would set stock to a negative value (${quantity})` });
        return;
      }
      if (req.body.type === InventoryTxnType.ADJUST && !String(req.body.notes ?? '').trim()) {
        res.status(400).json({ error: 'A reason is required for a stock adjustment' });
        return;
      }
      // Consumption must say where the material went (phase / budget head / purpose).
      if (
        req.body.type === InventoryTxnType.OUT &&
        !req.body.phaseId &&
        !req.body.budgetHeadId &&
        !String(req.body.purpose ?? '').trim()
      ) {
        res.status(400).json({ error: 'Say what the material was used for: choose a phase, a budget head or enter a purpose' });
        return;
      }
      const projectId = requireProjectId(req);
      if (req.body.phaseId) {
        const phase = await prisma.phase.findFirst({ where: { id: req.body.phaseId, projectId, deletedAt: null }, select: { id: true } });
        if (!phase) {
          res.status(400).json({ error: 'Phase not found' });
          return;
        }
      }
      if (req.body.budgetHeadId) {
        const head = await prisma.budgetHead.findFirst({ where: { id: req.body.budgetHeadId, projectId, deletedAt: null }, select: { id: true } });
        if (!head) {
          res.status(400).json({ error: 'Budget head not found' });
          return;
        }
      }

      // Quantity, average cost and value change together in one atomic UPDATE
      // (inventory-valuation.service); the log row is written in the same
      // transaction so a failure rolls back both.
      const txnType = req.body.type as InventoryTxnType;
      const txn = await prisma.$transaction(async (tx) => {
        const moved =
          txnType === InventoryTxnType.OUT
            ? await applyOutbound(tx, item.id, absQty)
            : txnType === InventoryTxnType.RETURN
              ? await applyReturn(tx, item.id, absQty)
              : await applyAdjustment(tx, item.id, quantity);

        return tx.inventoryTransaction.create({
          data: {
            itemId: item.id,
            gatePassId: req.body.gatePassId ?? null,
            type: txnType,
            quantity: txnType === InventoryTxnType.ADJUST ? quantity : absQty,
            balanceAfter: moved.balance,
            unitCost: moved.unitCost,
            totalCost: moved.totalCost,
            userId: req.user!.id,
            notes: req.body.notes ?? null,
            purpose: req.body.purpose?.trim() || null,
            phaseId: req.body.phaseId ?? null,
            budgetHeadId: req.body.budgetHeadId ?? null,
            issuedTo: req.body.issuedTo?.trim() || null,
          },
        });
      });
      const newBalance = Number(txn.balanceAfter);

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
        title: `Stock ${req.body.type === InventoryTxnType.OUT ? 'Out' : req.body.type === InventoryTxnType.ADJUST ? 'Adjusted' : 'Returned'}`,
        body: `${item.name}: ${Math.abs(quantity)} units — Balance: ${newBalance}`,
        url: '/inventory',
      }).catch((err) => console.error('[Push] Inventory txn notification error:', err));

      res.status(201).json(txn);
    } catch (error) {
      next(error);
    }
  }
);

// GET /summary — headline metrics for the inventory dashboard (value, stock
// health, 30-day movement, consumption split, pending work).
router.get(
  '/summary',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const now = Date.now();
      const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const since60 = new Date(now - 60 * 24 * 60 * 60 * 1000);

      const [items, assets, recentTxns, lastOut, receiptsToProcess, entriesToApprove, gatePassesAwaiting, posAwaitingDelivery] =
        await Promise.all([
          prisma.inventoryItem.findMany({
            where: { projectId, deletedAt: null },
            select: {
              id: true, name: true, category: true, unit: true, itemType: true, createdAt: true,
              currentStock: true, minStockLevel: true, totalValue: true,
            },
          }),
          prisma.asset.findMany({
            where: { projectId, status: { not: AssetStatus.RETIRED } },
            select: { totalCost: true },
          }),
          prisma.inventoryTransaction.findMany({
            where: { inventoryItem: { projectId }, timestamp: { gte: since30 } },
            select: {
              type: true, totalCost: true, budgetHeadId: true, phaseId: true,
              budgetHead: { select: { particulars: true } },
              phase: { select: { name: true } },
            },
          }),
          prisma.inventoryTransaction.groupBy({
            by: ['itemId'],
            where: { inventoryItem: { projectId }, type: InventoryTxnType.OUT },
            _max: { timestamp: true },
          }),
          prisma.goodsReceipt.count({
            where: { projectId, deletedAt: null, status: { in: ['PENDING_INSPECTION', 'READY_TO_POST'] } },
          }),
          prisma.stockEntry.count({ where: { projectId, deletedAt: null, status: 'PENDING_APPROVAL' } }),
          prisma.gatePass.count({
            where: { projectId, deletedAt: null, status: 'APPROVED', gatePassCategory: 'MATERIAL', poId: { not: null }, goodsReceipts: { none: {} } },
          }),
          prisma.purchaseOrder.count({
            where: { projectId, deletedAt: null, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED'] } },
          }),
        ]);

      const consumables = items.filter((i) => i.itemType === InventoryItemType.CONSUMABLE);
      const consumableValue = consumables.reduce((sum, i) => sum + Number(i.totalValue), 0);
      const assetValue = assets.reduce((sum, a) => sum + Number(a.totalCost ?? 0), 0);

      const lowStock = consumables.filter((i) => Number(i.minStockLevel) > 0 && Number(i.currentStock) <= Number(i.minStockLevel));
      const outOfStock = consumables.filter((i) => Number(i.currentStock) <= 0);

      const byCategory = new Map<string, { value: number; items: number }>();
      for (const i of consumables) {
        if (Number(i.currentStock) <= 0) continue;
        const key = i.category?.trim() || 'Uncategorised';
        const cur = byCategory.get(key) ?? { value: 0, items: 0 };
        cur.value += Number(i.totalValue);
        cur.items += 1;
        byCategory.set(key, cur);
      }

      const lastOutByItem = new Map(lastOut.map((r) => [r.itemId, r._max.timestamp]));
      const dead = consumables.filter((i) => {
        if (Number(i.currentStock) <= 0) return false;
        const last = lastOutByItem.get(i.id) ?? i.createdAt;
        return last < since60;
      });

      const flow = { inValue: 0, outValue: 0, returnValue: 0, inCount: 0, outCount: 0 };
      const byHead = new Map<string, { id: string; name: string; value: number }>();
      const byPhase = new Map<string, { id: string; name: string; value: number }>();
      for (const t of recentTxns) {
        const v = Number(t.totalCost);
        if (t.type === InventoryTxnType.IN) { flow.inValue += v; flow.inCount += 1; }
        else if (t.type === InventoryTxnType.RETURN) flow.returnValue += v;
        else if (t.type === InventoryTxnType.OUT) {
          flow.outValue += v;
          flow.outCount += 1;
          if (t.budgetHeadId && t.budgetHead) {
            const cur = byHead.get(t.budgetHeadId) ?? { id: t.budgetHeadId, name: t.budgetHead.particulars, value: 0 };
            cur.value += v;
            byHead.set(t.budgetHeadId, cur);
          }
          if (t.phaseId && t.phase) {
            const cur = byPhase.get(t.phaseId) ?? { id: t.phaseId, name: t.phase.name, value: 0 };
            cur.value += v;
            byPhase.set(t.phaseId, cur);
          }
        }
      }
      const top = <T extends { value: number }>(list: T[], n = 5) => list.sort((a, b) => b.value - a.value).slice(0, n);

      res.json({
        totalValue: consumableValue + assetValue,
        consumableValue,
        assetValue,
        itemCount: items.length,
        consumableCount: consumables.length,
        assetUnits: assets.length,
        lowStockCount: lowStock.length,
        outOfStockCount: outOfStock.length,
        lowStockItems: lowStock.slice(0, 5).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: Number(i.currentStock), min: Number(i.minStockLevel) })),
        valueByCategory: top([...byCategory.entries()].map(([category, v]) => ({ category, ...v })), 6),
        topItems: top(
          consumables.filter((i) => Number(i.currentStock) > 0).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: Number(i.currentStock), value: Number(i.totalValue) })),
        ),
        last30Days: flow,
        consumptionByBudgetHead: top([...byHead.values()]),
        consumptionByPhase: top([...byPhase.values()]),
        deadStock: { count: dead.length, value: dead.reduce((sum, i) => sum + Number(i.totalValue), 0) },
        pending: {
          receiptsToProcess,
          entriesToApprove,
          gatePassesAwaiting,
          posAwaitingDelivery,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
