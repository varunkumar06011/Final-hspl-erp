import { Router, Response, NextFunction } from 'express';
import {
  Permission,
  AuditAction,
  InventoryItemType,
  InventoryTxnType,
  StockEntryStatus,
  StockSourceType,
  AssetStatus,
  AssetMovementType,
  isApproverRole,
} from '@hospital-erp/shared';
import { createStockEntrySchema, rejectStockEntrySchema } from '@hospital-erp/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateProjectSequenceNumber } from '../services/sequence.service';
import { notifyAllHeads } from '../services/push.service';
import { applyInbound } from '../services/inventory-valuation.service';
import { generateAssetId } from './asset.routes';

/**
 * Direct (no-PO) stock receipts: opening stock, cash/petty purchases, owner
 * free-issue, transfers from another project and returns from site.
 *
 * A head/admin must approve an entry before it counts as stock. When the person
 * entering it already holds an approver role it is posted straight away.
 */
const router = Router();
router.use(authMiddleware);

const entryInclude = {
  items: true,
  createdByUser: { select: { id: true, name: true } },
  approvedByUser: { select: { id: true, name: true } },
};

const CATEGORY_PREFIX: Record<string, string> = { CONSUMABLE: 'CON', ASSET: 'AST' };

async function generateSku(tx: Prisma.TransactionClient, projectId: string, category: string): Promise<string> {
  const upper = category.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = CATEGORY_PREFIX[upper] ?? (upper.slice(0, 3) || 'GEN');
  const existing = await tx.inventoryItem.findMany({
    where: { projectId, sku: { startsWith: `${prefix}-` }, deletedAt: null },
    select: { sku: true },
  });
  const max = existing.reduce((m, i) => {
    const match = i.sku?.match(/^([A-Z]+)-(\d+)$/);
    return match ? Math.max(m, Number(match[2])) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

type EntryWithItems = Prisma.StockEntryGetPayload<{ include: { items: true } }>;

/** Turns an approved entry into stock. Runs inside the caller's transaction. */
async function postEntry(
  tx: Prisma.TransactionClient,
  entry: EntryWithItems,
  actor: { id: string; name: string },
): Promise<void> {
  for (const line of entry.items) {
    const lineType = (line.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE;
    const qty = Number(line.quantity);
    if (lineType === InventoryItemType.ASSET && qty !== Math.floor(qty)) {
      throw new Error(`Asset items need a whole-number quantity (${line.materialName}: ${qty})`);
    }

    let item = await tx.inventoryItem.findFirst({
      where: { projectId: entry.projectId, name: { equals: line.materialName, mode: 'insensitive' }, deletedAt: null },
    });
    if (item && item.itemType !== lineType) {
      throw new Error(
        `"${line.materialName}" already exists in inventory as ${item.itemType.toLowerCase()}, but this entry marks it as ${lineType.toLowerCase()}.`,
      );
    }
    if (!item) {
      const category = line.category?.trim() || (lineType === InventoryItemType.ASSET ? 'ASSET' : 'CONSUMABLE');
      item = await tx.inventoryItem.create({
        data: {
          projectId: entry.projectId,
          name: line.materialName,
          sku: await generateSku(tx, entry.projectId, category),
          category,
          unit: line.unit || 'nos',
          itemType: lineType,
          currentStock: 0,
          minStockLevel: 0,
        },
      });
    }

    const moved = await applyInbound(tx, item.id, qty, Number(line.unitCost));
    await tx.inventoryTransaction.create({
      data: {
        itemId: item.id,
        stockEntryId: entry.id,
        type: InventoryTxnType.IN,
        quantity: qty,
        balanceAfter: moved.balance,
        unitCost: moved.unitCost,
        totalCost: moved.totalCost,
        userId: actor.id,
        purpose: entry.sourceType,
        notes: `${entry.entryNumber}${entry.supplierName ? ` · ${entry.supplierName}` : ''}${entry.referenceNo ? ` · ${entry.referenceNo}` : ''}`,
      },
    });

    if (lineType === InventoryItemType.ASSET) {
      for (let i = 0; i < qty; i++) {
        const assetId = await generateAssetId(tx, entry.projectId);
        const asset = await tx.asset.create({
          data: {
            projectId: entry.projectId,
            inventoryItemId: item.id,
            assetId,
            status: AssetStatus.ACTIVE,
            location: 'Main Store',
            vendorName: entry.supplierName ?? null,
            unitPrice: Number(line.unitCost),
            totalCost: Number(line.unitCost),
            receiptNumber: entry.entryNumber,
            receiptDate: entry.entryDate,
            postedBy: actor.name,
          },
        });
        await tx.assetMovement.create({
          data: {
            assetId: asset.id,
            type: AssetMovementType.CREATED,
            toLocation: 'Main Store',
            toStatus: AssetStatus.ACTIVE,
            notes: `Created from direct stock entry ${entry.entryNumber} (${entry.sourceType})`,
            userId: actor.id,
          },
        });
      }
    }
  }
}

router.get('/', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const projectId = requireProjectId(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const data = await prisma.stockEntry.findMany({
      where: { projectId, deletedAt: null, ...(status ? { status } : {}) },
      include: entryInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', rbacMiddleware(Permission.MANAGE_INVENTORY), async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await prisma.stockEntry.findFirst({
      where: { id: req.params.id, projectId: requireProjectId(req), deletedAt: null },
      include: entryInclude,
    });
    if (!entry) {
      res.status(404).json({ error: 'Stock entry not found' });
      return;
    }
    res.json(entry);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(createStockEntrySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { sourceType, entryDate, supplierName, referenceNo, notes, items } = req.body as {
        sourceType: StockSourceType;
        entryDate?: Date;
        supplierName?: string;
        referenceNo?: string;
        notes?: string;
        items: { materialName: string; unit: string; quantity: number; unitCost: number; itemType: InventoryItemType; category?: string }[];
      };

      for (const line of items) {
        if (line.itemType === InventoryItemType.ASSET && line.quantity !== Math.floor(line.quantity)) {
          res.status(400).json({ error: `Asset items need a whole-number quantity (${line.materialName})` });
          return;
        }
      }

      const entryNumber = await generateProjectSequenceNumber('stockEntry', 'entryNumber', 'STK', 3, projectId);
      const autoPost = isApproverRole(req.user!.role);

      const created = await prisma.$transaction(async (tx) => {
        const entry = await tx.stockEntry.create({
          data: {
            projectId,
            entryNumber,
            sourceType,
            status: autoPost ? StockEntryStatus.POSTED : StockEntryStatus.PENDING_APPROVAL,
            ...(entryDate ? { entryDate } : {}),
            supplierName: supplierName || null,
            referenceNo: referenceNo || null,
            notes: notes || null,
            createdBy: req.user!.id,
            ...(autoPost ? { approvedBy: req.user!.id, approvedAt: new Date() } : {}),
            items: {
              create: items.map((line) => ({
                materialName: line.materialName.trim(),
                unit: line.unit,
                quantity: line.quantity,
                unitCost: line.unitCost ?? 0,
                itemType: line.itemType,
                category: line.category || null,
              })),
            },
          },
          include: { items: true },
        });
        if (autoPost) await postEntry(tx, entry, { id: req.user!.id, name: req.user!.name });
        return tx.stockEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude });
      }, { timeout: 30_000 });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'STOCK_ENTRY',
        entityId: created.id,
        projectId,
        newValue: { entryNumber, sourceType, status: created.status, lines: items.length },
      });
      if (!autoPost) {
        notifyAllHeads(projectId, {
          entityType: 'STOCK_ENTRY',
          entityId: created.id,
          title: 'Stock entry awaiting approval',
          body: `${entryNumber} (${sourceType.replace(/_/g, ' ').toLowerCase()}) entered by ${req.user!.name}`,
          url: '/inventory',
        }).catch((err) => console.error('[Push] Stock entry notification error:', err));
      }

      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/approve',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!isApproverRole(req.user!.role)) {
        res.status(403).json({ error: 'Only a project head or admin can approve a stock entry' });
        return;
      }
      const entry = await prisma.stockEntry.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!entry) {
        res.status(404).json({ error: 'Stock entry not found' });
        return;
      }
      if (entry.status !== StockEntryStatus.PENDING_APPROVAL) {
        res.status(400).json({ error: 'This stock entry is no longer awaiting approval' });
        return;
      }

      const posted = await prisma.$transaction(async (tx) => {
        const claimed = await tx.stockEntry.updateMany({
          where: { id: entry.id, status: StockEntryStatus.PENDING_APPROVAL },
          data: { status: StockEntryStatus.POSTED, approvedBy: req.user!.id, approvedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('Stock entry was already actioned');
        await postEntry(tx, entry, { id: req.user!.id, name: req.user!.name });
        return tx.stockEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude });
      }, { timeout: 30_000 });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'STOCK_ENTRY',
        entityId: entry.id,
        projectId,
        newValue: { status: StockEntryStatus.POSTED, approvedBy: req.user!.id },
      });
      res.json(posted);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/reject',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(rejectStockEntrySchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      if (!isApproverRole(req.user!.role)) {
        res.status(403).json({ error: 'Only a project head or admin can reject a stock entry' });
        return;
      }
      const claimed = await prisma.stockEntry.updateMany({
        where: { id: req.params.id, projectId, deletedAt: null, status: StockEntryStatus.PENDING_APPROVAL },
        data: {
          status: StockEntryStatus.REJECTED,
          approvedBy: req.user!.id,
          approvedAt: new Date(),
          rejectionReason: req.body.reason,
        },
      });
      if (claimed.count !== 1) {
        res.status(400).json({ error: 'This stock entry is not awaiting approval' });
        return;
      }
      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'STOCK_ENTRY',
        entityId: req.params.id,
        projectId,
        newValue: { status: StockEntryStatus.REJECTED, reason: req.body.reason },
      });
      const entry = await prisma.stockEntry.findUniqueOrThrow({ where: { id: req.params.id }, include: entryInclude });
      res.json(entry);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
