import { Router, Response, NextFunction } from 'express';
import { GoodsReceiptStatus, Permission, AuditAction, InspectionStatus, InventoryItemType, AssetStatus, AssetMovementType, GatePassStatus } from '@hospital-erp/shared';
import {
  createGoodsReceiptSchema,
  inspectGoodsReceiptSchema,
  postGoodsReceiptSchema,
} from '@hospital-erp/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { notifyAllHeads } from '../services/push.service';
import { generateAssetId } from './asset.routes';

const router = Router();
router.use(authMiddleware);

const receiptInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { id: true, name: true, vendorCode: true } }, budgetHead: { select: { id: true, particulars: true } } } },
  gatePass: { select: { id: true, passNumber: true, status: true, createdBy: true } },
  items: { include: { poItem: { select: { unitPrice: true } } } },
  inspection: { select: { id: true, status: true, inspectorId: true, completedDate: true } },
  createdByUser: { select: { id: true, name: true } },
  inspectedByUser: { select: { id: true, name: true } },
  postedByUser: { select: { id: true, name: true } },
};

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

async function generateInventorySku(tx: Prisma.TransactionClient, projectId: string, category: string | null): Promise<string> {
  const prefix = categoryPrefix(category);
  const existing = await tx.inventoryItem.findMany({
    where: { projectId, sku: { startsWith: `${prefix}-` }, deletedAt: null },
    select: { sku: true },
  });
  const maxNumber = existing.reduce((max, item) => {
    const match = item.sku?.match(/^([A-Z]+)-(\d+)$/);
    return match ? Math.max(max, Number(match[2])) : max;
  }, 0);
  return `${prefix}-${String(maxNumber + 1).padStart(4, '0')}`;
}

async function generateReceiptNumber(projectId: string): Promise<string> {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { projectId },
    select: { receiptNumber: true },
  });
  const maxNumber = receipts.reduce((max, receipt) => {
    const match = receipt.receiptNumber.match(/^VGH-GRN(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `VGH-GRN${String(maxNumber + 1).padStart(3, '0')}`;
}

router.get(
  '/available-gatepasses',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const gatepasses = await prisma.gatePass.findMany({
        where: { projectId, status: 'APPROVED', deletedAt: null },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              vendor: { select: { id: true, name: true, vendorCode: true } },
              items: { select: { id: true, materialName: true, quantity: true, unit: true } },
            },
          },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ data: gatepasses });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const data = await prisma.goodsReceipt.findMany({
        where: { projectId, deletedAt: null },
        include: receiptInclude,
        orderBy: { createdAt: 'desc' },
      });
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(createGoodsReceiptSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const gatePass = await prisma.gatePass.findFirst({
        where: { id: req.body.gatePassId, projectId, status: 'APPROVED', deletedAt: null },
        include: { items: true, purchaseOrder: { include: { items: true } } },
      });
      if (!gatePass || !gatePass.purchaseOrder) {
        res.status(400).json({ error: 'Only an approved material gatepass can create a goods receipt' });
        return;
      }

      // Delivered quantities come from the request — the user enters what actually arrived
      const deliveredItems = req.body.items as { materialName: string; deliveredQty: number; unit?: string | null }[];

      // ── E10: Validate delivered items against gate pass items, not PO items ──
      // The gate pass is the source of truth for what was physically dispatched.
      // Matching against PO items by materialName breaks when the PO has
      // duplicate material names (e.g. same material at different prices).
      const gatePassItems = new Map(gatePass.items.map((item) => [item.materialName.toLowerCase(), item]));
      for (const item of deliveredItems) {
        const gpItem = gatePassItems.get(item.materialName.toLowerCase());
        if (!gpItem) {
          res.status(400).json({ error: `Item ${item.materialName} was not on gate pass ${gatePass.passNumber}` });
          return;
        }
        if (Number(item.deliveredQty) > Number(gpItem.quantity) + 0.01) {
          res.status(400).json({
            error: `Delivered quantity (${item.deliveredQty}) for ${item.materialName} exceeds gate pass quantity (${gpItem.quantity})`,
          });
          return;
        }
      }

      // Still need PO items for poItemId linkage and unit fallback
      const poItems = new Map(gatePass.purchaseOrder.items.map((item) => [item.materialName.toLowerCase(), item]));

      // Validate each delivered item is part of the PO
      for (const item of deliveredItems) {
        if (!poItems.has(item.materialName.toLowerCase())) {
          res.status(400).json({ error: `Item ${item.materialName} is not part of the purchase order` });
          return;
        }
      }

      // Enforce that cumulative delivered quantity does not exceed the PO ordered
      // quantity. Already-accepted quantities from posted GRNs are counted so that
      // a second delivery cannot push the total past the ordered amount.
      const postedReceipts = await prisma.goodsReceipt.findMany({
        where: { poId: gatePass.poId!, deletedAt: null, status: GoodsReceiptStatus.POSTED },
        select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
      });
      const acceptedByPoItemId = new Map<string, number>();
      const acceptedByName = new Map<string, number>();
      for (const r of postedReceipts) {
        for (const line of r.items) {
          const qty = Number(line.acceptedQty);
          if (line.poItemId) acceptedByPoItemId.set(line.poItemId, (acceptedByPoItemId.get(line.poItemId) ?? 0) + qty);
          const name = line.materialName.toLowerCase();
          acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + qty);
        }
      }
      for (const item of deliveredItems) {
        const poItem = poItems.get(item.materialName.toLowerCase())!;
        const alreadyAccepted =
          (poItem.id && acceptedByPoItemId.has(poItem.id)
            ? acceptedByPoItemId.get(poItem.id)!
            : acceptedByName.get(item.materialName.toLowerCase()) ?? 0);
        const ordered = Number(poItem.quantity);
        if (alreadyAccepted + Number(item.deliveredQty) > ordered + 0.01) {
          res.status(400).json({
            error: `Cannot deliver ${item.deliveredQty} ${item.materialName}: ${alreadyAccepted} already accepted, only ${ordered} ordered`,
          });
          return;
        }
      }

      const receiptNumber = await generateReceiptNumber(projectId);
      const receipt = await prisma.goodsReceipt.create({
        data: {
          projectId,
          poId: gatePass.poId!,
          gatePassId: gatePass.id,
          receiptNumber,
          status: GoodsReceiptStatus.PENDING_INSPECTION,
          createdBy: req.user!.id,
          items: {
            create: deliveredItems.map((item) => ({
              poItemId: poItems.get(item.materialName.toLowerCase())?.id ?? undefined,
              materialName: item.materialName,
              unit: item.unit || poItems.get(item.materialName.toLowerCase())?.unit || null,
              deliveredQty: item.deliveredQty,
              itemType: InventoryItemType.CONSUMABLE,
            })),
          },
        },
        include: receiptInclude,
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        entityType: 'GOODS_RECEIPT',
        entityId: receipt.id,
        projectId,
        newValue: { receiptNumber, gatePassId: gatePass.id, poId: gatePass.poId },
      });
      notifyAllHeads(projectId, {
        entityType: 'GOODS_RECEIPT',
        entityId: receipt.id,
        title: 'Goods Receipt Created',
        body: `${receiptNumber} created from gatepass ${gatePass.passNumber}`,
        url: '/inventory',
      }).catch((error) => console.error('[Push] Goods receipt notification error:', error));

      res.status(201).json(receipt);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/inspect',
  rbacMiddleware(Permission.MANAGE_INSPECTIONS),
  validateMiddleware(inspectGoodsReceiptSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const receipt = await prisma.goodsReceipt.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: { items: true, gatePass: { select: { createdBy: true } }, inspection: true },
      });
      if (!receipt) {
        res.status(404).json({ error: 'Goods receipt not found' });
        return;
      }
      if (receipt.status !== GoodsReceiptStatus.PENDING_INSPECTION && receipt.status !== GoodsReceiptStatus.READY_TO_POST) {
        res.status(400).json({ error: 'This goods receipt has already been posted' });
        return;
      }
      if (receipt.createdBy === req.user!.id || receipt.gatePass.createdBy === req.user!.id) {
        res.status(403).json({ error: 'The person who created the receipt or gatepass cannot inspect it' });
        return;
      }

      const submitted = new Map((req.body.items as { id: string; acceptedQty: number; rejectedQty: number; rejectionReason?: string; itemType?: string }[]).map((item) => [item.id, item]));
      if (submitted.size !== receipt.items.length || receipt.items.some((item) => !submitted.has(item.id))) {
        res.status(400).json({ error: 'A disposition is required for every receipt item' });
        return;
      }
      for (const item of receipt.items) {
        const disposition = submitted.get(item.id)!;
        const acceptedQty = Number(disposition.acceptedQty);
        const rejectedQty = Number(disposition.rejectedQty);
        if (acceptedQty < 0 || rejectedQty < 0 || Math.abs(acceptedQty + rejectedQty - Number(item.deliveredQty)) > 0.01) {
          res.status(400).json({ error: `Accepted plus rejected quantity must equal delivered quantity for ${item.materialName}` });
          return;
        }
        if (rejectedQty > 0 && !disposition.rejectionReason?.trim()) {
          res.status(400).json({ error: `A rejection reason is required for ${item.materialName}` });
          return;
        }
        const lineItemType = (disposition.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE;
        if (lineItemType === InventoryItemType.ASSET && acceptedQty > 0 && acceptedQty !== Math.floor(acceptedQty)) {
          res.status(400).json({ error: `Asset items must have whole-number quantities. ${item.materialName} has ${acceptedQty} accepted.` });
          return;
        }
      }

      const rejected = (req.body.items as { rejectedQty: number }[]).some((item) => Number(item.rejectedQty) > 0);
      const isReinspection = receipt.status === GoodsReceiptStatus.READY_TO_POST;
      const result = await prisma.$transaction(async (tx) => {
        for (const item of receipt.items) {
          const disposition = submitted.get(item.id)!;
          await tx.goodsReceiptItem.update({
            where: { id: item.id },
            data: {
              acceptedQty: Number(disposition.acceptedQty),
              rejectedQty: Number(disposition.rejectedQty),
              rejectionReason: disposition.rejectionReason?.trim() || null,
              itemType: disposition.itemType ?? InventoryItemType.CONSUMABLE,
            },
          });
        }
        if (isReinspection && receipt.inspection) {
          await tx.inspection.update({
            where: { id: receipt.inspection.id },
            data: {
              status: rejected ? InspectionStatus.DEFECTS_FOUND : InspectionStatus.PASSED,
              inspectorId: req.user!.id,
              completedDate: new Date(),
            },
          });
        } else {
          await tx.inspection.create({
            data: {
              projectId,
              name: `Goods receipt inspection ${receipt.receiptNumber}`,
              status: rejected ? InspectionStatus.DEFECTS_FOUND : InspectionStatus.PASSED,
              inspectorId: req.user!.id,
              createdBy: req.user!.id,
              completedDate: new Date(),
              goodsReceiptId: receipt.id,
            },
          });
        }
        return tx.goodsReceipt.update({
          where: { id: receipt.id },
          data: { status: GoodsReceiptStatus.READY_TO_POST, inspectedBy: req.user!.id, inspectedAt: new Date() },
          include: receiptInclude,
        });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'GOODS_RECEIPT',
        entityId: receipt.id,
        projectId,
        newValue: { status: GoodsReceiptStatus.READY_TO_POST, rejected, inspectedBy: req.user!.id },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/post',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  validateMiddleware(postGoodsReceiptSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const receipt = await prisma.goodsReceipt.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        include: {
          items: { include: { poItem: true } },
          gatePass: { include: { invoice: true } },
          purchaseOrder: {
            include: {
              vendor: { select: { id: true, name: true, vendorCode: true } },
              quotation: { select: { quotationNumber: true, date: true } },
              createdByUser: { select: { id: true, name: true } },
              items: true,
            },
          },
          createdByUser: { select: { id: true, name: true } },
          inspectedByUser: { select: { id: true, name: true } },
        },
      });
      if (!receipt) {
        res.status(404).json({ error: 'Goods receipt not found' });
        return;
      }
      if (receipt.status !== GoodsReceiptStatus.READY_TO_POST) {
        res.status(400).json({ error: 'Only an inspected goods receipt can be posted to inventory' });
        return;
      }
      if (receipt.createdBy === req.user!.id || receipt.inspectedBy === req.user!.id || receipt.gatePass.createdBy === req.user!.id) {
        res.status(403).json({ error: 'The receipt creator, gatepass creator, and inspector cannot post inventory for this receipt' });
        return;
      }

      const posted = await prisma.$transaction(async (tx) => {
        const claimed = await tx.goodsReceipt.updateMany({
          where: { id: receipt.id, status: GoodsReceiptStatus.READY_TO_POST },
          data: { status: GoodsReceiptStatus.POSTED, postedBy: req.user!.id, postedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('Goods receipt is already being posted or has changed');

        for (const line of receipt.items) {
          if (Number(line.acceptedQty) <= 0) continue;
          const lineItemType = (line.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE;
          let inventoryItem = await tx.inventoryItem.findFirst({
            where: { projectId, name: { equals: line.materialName, mode: 'insensitive' }, deletedAt: null },
          });
          if (inventoryItem && inventoryItem.itemType !== lineItemType) {
            throw new Error(`Item "${line.materialName}" already exists in inventory as ${inventoryItem.itemType.toLowerCase()}, but this receipt marks it as ${lineItemType.toLowerCase()}. Change the item type on this receipt to match, or rename the material.`);
          }
          if (!inventoryItem) {
            inventoryItem = await tx.inventoryItem.create({
              data: {
                projectId,
                name: line.materialName,
                sku: await generateInventorySku(tx, projectId, 'MATERIAL'),
                category: 'MATERIAL',
                unit: line.unit || 'nos',
                itemType: lineItemType,
                currentStock: 0,
                minStockLevel: 0,
              },
            });
          }
          const newBalance = Number(inventoryItem.currentStock) + Number(line.acceptedQty);
          await tx.inventoryTransaction.create({
            data: {
              itemId: inventoryItem.id,
              gatePassId: receipt.gatePassId,
              goodsReceiptId: receipt.id,
              type: 'IN',
              quantity: line.acceptedQty,
              balanceAfter: newBalance,
              userId: req.user!.id,
              notes: `Accepted from ${receipt.receiptNumber}`,
            },
          });
          await tx.inventoryItem.update({ where: { id: inventoryItem.id }, data: { currentStock: newBalance } });

          // If this is an ASSET-type item, generate individual asset records
          if (inventoryItem.itemType === InventoryItemType.ASSET) {
            const acceptedCount = Math.floor(Number(line.acceptedQty));
            const poItem = line.poItem;
            const po = receipt.purchaseOrder;
            const invoice = receipt.gatePass.invoice;
            const unitPrice = poItem ? Number(poItem.unitPrice) : null;
            const gstRate = poItem ? Number(poItem.gstRate) : null;
            const gstAmount = unitPrice && gstRate ? unitPrice * gstRate / 100 : null;
            const totalCost = unitPrice && gstAmount ? unitPrice + gstAmount : unitPrice;

            for (let i = 0; i < acceptedCount; i++) {
              const assetId = await generateAssetId(tx);
              await tx.asset.create({
                data: {
                  projectId,
                  inventoryItemId: inventoryItem.id,
                  assetId,
                  status: AssetStatus.ACTIVE,
                  location: 'Main Store',
                  // Frozen purchase chain
                  vendorName: po?.vendor?.name ?? null,
                  vendorCode: po?.vendor?.vendorCode ?? null,
                  quotationNumber: po?.quotation?.quotationNumber ?? null,
                  quotationDate: po?.quotation?.date ?? null,
                  poNumber: po?.poNumber ?? null,
                  poDate: po?.date ?? null,
                  poPaymentType: po?.paymentType ?? null,
                  invoiceNumber: invoice?.invoiceNumber ?? null,
                  invoiceDate: invoice?.date ?? null,
                  unitPrice: unitPrice ?? null,
                  gstRate: gstRate ?? null,
                  gstAmount: gstAmount ?? null,
                  totalCost: totalCost ?? null,
                  poCreatedBy: po?.createdByUser?.name ?? null,
                  receiptNumber: receipt.receiptNumber,
                  receiptDate: receipt.createdAt,
                  gatePassNumber: receipt.gatePass.passNumber,
                  receivedBy: receipt.inspectedByUser?.name ?? null,
                  postedBy: req.user!.name,
                },
              });
              await tx.assetMovement.create({
                data: {
                  assetId: (await tx.asset.findUnique({ where: { assetId }, select: { id: true } }))!.id,
                  type: AssetMovementType.CREATED,
                  toLocation: 'Main Store',
                  toStatus: AssetStatus.ACTIVE,
                  notes: `Created from ${receipt.receiptNumber} (PO: ${po?.poNumber ?? 'N/A'})`,
                  userId: req.user!.id,
                },
              });
            }
          }
        }
        if (receipt.gatePass.invoiceId) {
          await tx.vendorInvoice.update({
            where: { id: receipt.gatePass.invoiceId },
            data: { stockStatus: 'RECEIVED' },
          });
        }

        // ── Mark the gate pass as DELIVERED so it is no longer counted as in-transit ──
        // Once a goods receipt is posted, the authorized shipment has been received;
        // keeping it APPROVED would cause the in-transit calculation to double-count
        // already-delivered quantities against the PO remaining quantity.
        await tx.gatePass.update({
          where: { id: receipt.gatePassId },
          data: { status: GatePassStatus.DELIVERED },
        });

        // ── Finance integration: convert commitment to actual on budget head ──
        if (receipt.purchaseOrder?.budgetHeadId) {
          const head = await tx.budgetHead.findFirst({
            where: { id: receipt.purchaseOrder.budgetHeadId, projectId, deletedAt: null },
          });
          if (head) {
            // Calculate accepted value: sum of acceptedQty * unitPrice (+ GST) per line
            let grnValue = 0;
            for (const line of receipt.items) {
              if (Number(line.acceptedQty) <= 0) continue;
              const poItem = line.poItem;
              if (poItem) {
                const lineAmount = Number(poItem.unitPrice) * Number(line.acceptedQty);
                const lineGst = lineAmount * Number(poItem.gstRate) / 100;
                grnValue += lineAmount + lineGst;
              }
            }
            if (grnValue > 0) {
              // ── A22: Do not silently cap committed at 0 ──
              // If grnValue > committedAmount (due to PO edits, tax rounding, or
              // multiple returns), silently capping at 0 makes committed + actual
              // diverge from the true budget picture. Instead, throw so the
              // discrepancy is surfaced and investigated.
              const currentCommitted = Number(head.committedAmount);
              if (grnValue > currentCommitted + 0.01) {
                throw new Error(
                  `GRN value (₹${grnValue.toFixed(2)}) exceeds committed budget (₹${currentCommitted.toFixed(2)}) ` +
                  `on head "${head.particulars}". This may indicate a PO edit or tax rounding issue. ` +
                  `Please run budget recompute or adjust the PO before posting.`
                );
              }
              const newCommitted = currentCommitted - grnValue;
              const newActual = Number(head.actualAmount) + grnValue;
              await tx.budgetHead.update({
                where: { id: receipt.purchaseOrder.budgetHeadId },
                data: { committedAmount: newCommitted, actualAmount: newActual },
              });
            }
          }
        }

        return tx.goodsReceipt.findUnique({ where: { id: receipt.id }, include: receiptInclude });
      });

      await logAudit({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        entityType: 'GOODS_RECEIPT',
        entityId: receipt.id,
        projectId,
        newValue: { status: GoodsReceiptStatus.POSTED, postedBy: req.user!.id },
      });

      // Update PO status based on accepted quantities from all posted receipts
      const allReceipts = await prisma.goodsReceipt.findMany({
        where: { poId: receipt.poId, deletedAt: null, status: GoodsReceiptStatus.POSTED },
        select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
      });
      const poItems = await prisma.pOItem.findMany({
        where: { poId: receipt.poId },
        select: { id: true, materialName: true, quantity: true },
      });
      const acceptedByPoItemId = new Map<string, number>();
      const acceptedByName = new Map<string, number>();
      for (const r of allReceipts) {
        for (const item of r.items) {
          const qty = Number(item.acceptedQty);
          if (item.poItemId) {
            acceptedByPoItemId.set(item.poItemId, (acceptedByPoItemId.get(item.poItemId) ?? 0) + qty);
          }
          const name = item.materialName.toLowerCase();
          acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + qty);
        }
      }
      const fullyReceived = poItems.every(
        (item) =>
          (item.id && acceptedByPoItemId.has(item.id)
            ? acceptedByPoItemId.get(item.id)!
            : acceptedByName.get(item.materialName.toLowerCase()) ?? 0) >= Number(item.quantity),
      );
      await prisma.purchaseOrder.update({
        where: { id: receipt.poId },
        data: { status: fullyReceived ? 'DELIVERED' : 'PARTIALLY_DELIVERED' },
      });

      res.json(posted);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
