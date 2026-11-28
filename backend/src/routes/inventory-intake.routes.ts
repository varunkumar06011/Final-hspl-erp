/**
 * /api/inventory-intake — "Add Inventory": type in material that physically arrived.
 *
 * Entry only. The person needs no inventory access and learns nothing about stock: there is
 * no read endpoint here and the reply carries just the entry number and its status. The
 * entry is an ordinary stock entry posted straight into stock (no approval), so it shows on
 * the Inventory page at once.
 */
import { Router, Response, NextFunction } from 'express';
import { InventoryItemType, Permission, StockSourceType, createInventoryIntakeSchema } from '@hospital-erp/shared';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { catalogLinesMiddleware } from '../middleware/catalogLines';
import { findInventoryItemForMaterial } from '../services/inventory-match.service';
import { createStockEntry } from './stock-entry.routes';

const router = Router();
router.use(authMiddleware);

/** "Bags", "bag" and "bag." are the same unit. */
const unitKey = (u: string) => u.trim().toLowerCase().replace(/\./g, '').replace(/s$/, '');

interface IntakeLine {
  materialName: string;
  itemId?: string;
  specification?: string | null;
  unit: string;
  quantity: number;
  unitCost?: number;
}

router.post(
  '/',
  rbacMiddleware(Permission.ADD_INVENTORY),
  validateMiddleware(createInventoryIntakeSchema),
  catalogLinesMiddleware(),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const { sourceType, entryDate, supplierName, referenceNo, notes, items } = req.body as {
        sourceType: StockSourceType;
        entryDate?: Date;
        supplierName?: string;
        referenceNo?: string;
        notes?: string;
        items: IntakeLine[];
      };

      const lines = [];
      for (const line of items) {
        const existing = await findInventoryItemForMaterial(prisma, projectId, line.materialName, {
          itemId: line.itemId,
          specification: line.specification,
        });
        // Quantities are added as typed, so a different unit would silently corrupt the stock.
        if (existing && unitKey(existing.unit) !== unitKey(line.unit)) {
          res.status(400).json({
            error: `${line.materialName} is counted in "${existing.unit}". Enter the quantity in ${existing.unit}`,
            code: 'UNIT_MISMATCH',
          });
          return;
        }
        const itemType = (existing?.itemType as InventoryItemType | undefined) ?? InventoryItemType.CONSUMABLE;
        if (itemType === InventoryItemType.ASSET && line.quantity !== Math.floor(line.quantity)) {
          res.status(400).json({ error: `${line.materialName} needs a whole-number quantity` });
          return;
        }
        lines.push({
          ...line,
          itemType,
          // No rate typed: value it at the item's current average, so a blank rate does not drag the stock value down.
          unitCost: line.unitCost ?? Number(existing?.weightedAvgCost ?? 0),
        });
      }

      const entry = await createStockEntry(
        projectId,
        req.user!,
        { sourceType, entryDate, supplierName, referenceNo, notes, items: lines },
        { postNow: true },
      );
      // Deliberately nothing about stock or values in the reply.
      res.status(201).json({ id: entry.id, entryNumber: entry.entryNumber, status: entry.status });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
