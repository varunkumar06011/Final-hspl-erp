import { Router, Response, NextFunction } from 'express';
import { GoodsReceiptStatus, Permission, AuditAction, InspectionStatus, InventoryItemType, AssetStatus, AssetMovementType, GatePassStatus, VoucherType, LedgerGroup, GST_LEDGER_NAMES } from '@hospital-erp/shared';
import {
  createGoodsReceiptSchema,
  inspectGoodsReceiptSchema,
  postGoodsReceiptSchema,
} from '@hospital-erp/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { findInventoryItemForMaterial, materialCodeForName } from '../services/inventory-match.service';
import { authMiddleware, AuthenticatedRequest, requireProjectId } from '../middleware/auth';
import { rbacMiddleware } from '../middleware/rbac';
import { validateMiddleware } from '../middleware/validate';
import { logAudit } from '../services/audit.service';
import { generateProjectSequenceNumber } from '../services/sequence.service';
import { notifyAllHeads } from '../services/push.service';
import { generateAssetId } from './asset.routes';
import { ensureVendorLedger, findLedgerByName } from './ledger.routes';
import { postVoucher, generateVoucherNumber } from './voucher.routes';
import { hasPoAccrual } from '../services/po-accrual.service';
import { applyInbound } from '../services/inventory-valuation.service';

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
  ASSET: 'AST',
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
  return generateProjectSequenceNumber('goodsReceipt', 'receiptNumber', 'GRN', 3, projectId);
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

// GET /:id — single goods receipt with full traceability (PO, vendor, gate
// pass, inspection, users, and every individual asset generated from it).
router.get(
  '/:id',
  rbacMiddleware(Permission.VIEW_FINANCIALS),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const receipt = await prisma.goodsReceipt.findFirst({
        where: { id: req.params.id, projectId, deletedAt: null },
        select: {
          id: true,
          receiptNumber: true,
          status: true,
          createdAt: true,
          inspectedAt: true,
          postedAt: true,
          items: {
            select: {
              id: true, materialName: true, unit: true, deliveredQty: true, acceptedQty: true,
              rejectedQty: true, rejectionReason: true, itemType: true,
              poItem: { select: { unitPrice: true, gstRate: true, quantity: true } },
            },
          },
          inspection: { select: { id: true, status: true, completedDate: true } },
          purchaseOrder: {
            select: {
              id: true, poNumber: true, date: true, status: true, paymentType: true, grandTotal: true,
              vendor: { select: { id: true, name: true, vendorCode: true, referenceBy: true, contactPersonName: true, phone: true } },
              quotation: { select: { id: true, quotationNumber: true, date: true } },
              budgetHead: { select: { id: true, particulars: true } },
              createdByUser: { select: { id: true, name: true } },
            },
          },
          gatePass: {
            select: {
              id: true, passNumber: true, date: true, status: true, gatePassType: true,
              vehicleNumber: true, driverName: true, driverMobile: true,
              items: { select: { id: true, materialName: true, quantity: true, unit: true } },
              createdByUser: { select: { id: true, name: true } },
            },
          },
          assets: {
            orderBy: { assetId: 'asc' },
            select: {
              id: true, assetId: true, status: true, location: true, serialNumber: true,
              totalCost: true, warrantyExpiry: true,
              inventoryItem: { select: { id: true, name: true } },
            },
          },
          createdByUser: { select: { id: true, name: true } },
          inspectedByUser: { select: { id: true, name: true } },
          postedByUser: { select: { id: true, name: true } },
        },
      });
      if (!receipt) {
        res.status(404).json({ error: 'Goods receipt not found' });
        return;
      }
      res.json(receipt);
    } catch (error) {
      next(error);
    }
  },
);

/** Quantity already accepted (posted receipts) and still sitting in open receipts, per PO line. */
async function receivedByPo(poId: string) {
  const receipts = await prisma.goodsReceipt.findMany({
    where: {
      poId,
      deletedAt: null,
      status: { in: [GoodsReceiptStatus.POSTED, GoodsReceiptStatus.PENDING_INSPECTION, GoodsReceiptStatus.READY_TO_POST] },
    },
    select: { status: true, items: { select: { poItemId: true, materialName: true, acceptedQty: true, deliveredQty: true } } },
  });
  const accepted = new Map<string, number>();
  const pending = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string, qty: number) => m.set(key, (m.get(key) ?? 0) + qty);
  for (const r of receipts) {
    for (const line of r.items) {
      const key = line.poItemId ?? line.materialName.toLowerCase();
      if (r.status === GoodsReceiptStatus.POSTED) bump(accepted, key, Number(line.acceptedQty));
      else bump(pending, key, Number(line.deliveredQty));
    }
  }
  return { accepted, pending };
}

// POs goods can be received against: approved (or part-delivered) POs with what
// is still outstanding per line, plus any open gate passes that could be linked.
router.get(
  '/available-pos',
  rbacMiddleware(Permission.MANAGE_INVENTORY),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const projectId = requireProjectId(req);
      const pos = await prisma.purchaseOrder.findMany({
        where: { projectId, deletedAt: null, isContract: false, status: { in: ['APPROVED', 'PARTIALLY_DELIVERED'] } },
        include: {
          vendor: { select: { id: true, name: true, vendorCode: true } },
          items: true,
          gatePasses: {
            where: { deletedAt: null, status: 'APPROVED', goodsReceipts: { none: {} } },
            select: { id: true, passNumber: true, date: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const data = await Promise.all(
        pos.map(async (po) => {
          const { accepted, pending } = await receivedByPo(po.id);
          return {
            id: po.id,
            poNumber: po.poNumber,
            paymentType: po.paymentType,
            vendor: po.vendor,
            gatePasses: po.gatePasses,
            items: po.items.map((item) => {
              const ordered = Number(item.quantity);
              const key = item.id;
              const nameKey = item.materialName.toLowerCase();
              const receivedQty = accepted.get(key) ?? accepted.get(nameKey) ?? 0;
              const pendingQty = pending.get(key) ?? pending.get(nameKey) ?? 0;
              return {
                id: item.id,
                materialName: item.materialName,
                unit: item.unit,
                orderedQuantity: ordered,
                receivedQuantity: receivedQty,
                pendingQuantity: pendingQty,
                remainingQuantity: Math.max(0, ordered - receivedQty - pendingQty),
              };
            }),
          };
        }),
      );
      res.json({ data: data.filter((po) => po.items.some((i) => i.remainingQuantity > 0)) });
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

      // The approved PO is what authorises receiving goods. A gate pass is optional.
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.body.poId, projectId, deletedAt: null },
        include: { items: true },
      });
      if (!po) {
        res.status(400).json({ error: 'Purchase order not found' });
        return;
      }
      if (po.isContract) {
        res.status(400).json({ error: 'This is a contract PO. Receive against one of its sub-POs' });
        return;
      }
      if (!['APPROVED', 'PARTIALLY_DELIVERED'].includes(po.status)) {
        res.status(400).json({ error: 'Goods can only be received against an approved purchase order' });
        return;
      }

      const gatePass = req.body.gatePassId
        ? await prisma.gatePass.findFirst({
            where: { id: req.body.gatePassId, projectId, poId: po.id, status: 'APPROVED', deletedAt: null },
            include: { items: true },
          })
        : null;
      if (req.body.gatePassId) {
        if (!gatePass) {
          res.status(400).json({ error: 'The gate pass must be an approved gate pass of this purchase order' });
          return;
        }
        const existing = await prisma.goodsReceipt.findFirst({ where: { gatePassId: gatePass.id, deletedAt: null }, select: { receiptNumber: true } });
        if (existing) {
          res.status(409).json({ error: `Gate pass ${gatePass.passNumber} already has goods receipt ${existing.receiptNumber}` });
          return;
        }
      }

      // Delivered quantities come from the request — the user enters what actually arrived
      const deliveredItems = req.body.items as { materialName: string; deliveredQty: number; unit?: string | null }[];
      const poItems = new Map(po.items.map((item) => [item.materialName.toLowerCase(), item]));
      const gatePassItems = gatePass ? new Map(gatePass.items.map((item) => [item.materialName.toLowerCase(), item])) : null;

      // Cumulative received (accepted + still in open receipts) must not pass the ordered quantity.
      const { accepted, pending } = await receivedByPo(po.id);
      for (const item of deliveredItems) {
        const name = item.materialName.toLowerCase();
        const poItem = poItems.get(name);
        if (!poItem) {
          res.status(400).json({ error: `Item ${item.materialName} is not part of the purchase order` });
          return;
        }
        if (gatePassItems) {
          const gpItem = gatePassItems.get(name);
          if (!gpItem) {
            res.status(400).json({ error: `Item ${item.materialName} was not on gate pass ${gatePass!.passNumber}` });
            return;
          }
          if (Number(item.deliveredQty) > Number(gpItem.quantity) + 0.01) {
            res.status(400).json({
              error: `Delivered quantity (${item.deliveredQty}) for ${item.materialName} exceeds gate pass quantity (${gpItem.quantity})`,
            });
            return;
          }
        }
        const already = (accepted.get(poItem.id) ?? accepted.get(name) ?? 0) + (pending.get(poItem.id) ?? pending.get(name) ?? 0);
        const ordered = Number(poItem.quantity);
        if (already + Number(item.deliveredQty) > ordered + 0.01) {
          res.status(400).json({
            error: `Cannot receive ${item.deliveredQty} ${item.materialName}: ${already} already received or awaiting inspection, only ${ordered} ordered`,
          });
          return;
        }
      }

      const receiptNumber = await generateReceiptNumber(projectId);
      const receipt = await prisma.goodsReceipt.create({
        data: {
          projectId,
          poId: po.id,
          gatePassId: gatePass?.id ?? null,
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
        newValue: { receiptNumber, poId: po.id, gatePassId: gatePass?.id ?? null },
      });
      notifyAllHeads(projectId, {
        entityType: 'GOODS_RECEIPT',
        entityId: receipt.id,
        title: 'Goods Receipt Created',
        body: `${receiptNumber} created for ${po.poNumber}${gatePass ? ` (gate pass ${gatePass.passNumber})` : ''}`,
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
        include: { items: true, inspection: true },
      });
      if (!receipt) {
        res.status(404).json({ error: 'Goods receipt not found' });
        return;
      }
      if (receipt.status !== GoodsReceiptStatus.PENDING_INSPECTION && receipt.status !== GoodsReceiptStatus.READY_TO_POST) {
        res.status(400).json({ error: 'This goods receipt has already been posted' });
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

      const posted = await prisma.$transaction(async (tx) => {
        const claimed = await tx.goodsReceipt.updateMany({
          where: { id: receipt.id, status: GoodsReceiptStatus.READY_TO_POST },
          data: { status: GoodsReceiptStatus.POSTED, postedBy: req.user!.id, postedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error('Goods receipt is already being posted or has changed');

        for (const line of receipt.items) {
          if (Number(line.acceptedQty) <= 0) continue;
          const lineItemType = (line.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE;
          // Matched by material code first (then merged-duplicate aliases, then name), so a
          // misspelt line still lands on the right stock item.
          let inventoryItem = await findInventoryItemForMaterial(tx, projectId, line.materialName);
          if (inventoryItem && inventoryItem.itemType !== lineItemType) {
            throw new Error(`Item "${line.materialName}" already exists in inventory as ${inventoryItem.itemType.toLowerCase()}, but this receipt marks it as ${lineItemType.toLowerCase()}. Change the item type on this receipt to match, or rename the material.`);
          }
          if (!inventoryItem) {
            // ── B23: Use item-type-appropriate category, not hard-coded MATERIAL ──
            // Assets should get ASSET category (AST- prefix), consumables get
            // CONSUMABLE (CNS-), etc. This prevents all auto-created items from
            // getting MAT- SKUs regardless of their actual type.
            const autoCategory = lineItemType === InventoryItemType.ASSET ? 'ASSET' : 'CONSUMABLE';
            inventoryItem = await tx.inventoryItem.create({
              data: {
                projectId,
                name: line.materialName,
                sku: await generateInventorySku(tx, projectId, autoCategory),
                materialCode: await materialCodeForName(tx, projectId, line.materialName),
                category: autoCategory,
                unit: line.unit || 'nos',
                itemType: lineItemType,
                currentStock: 0,
                minStockLevel: 0,
              },
            });
          }
          // ── A18: Atomic stock increment ──
          // DB applies the delta, preventing lost updates when a stock issue
          // (or another GRN) touches this item concurrently. The resulting
          // balance is read back for the transaction log's balanceAfter.
          // Valued at the PO unit price (ex-GST: input GST is claimed, not stock cost).
          const moved = await applyInbound(
            tx,
            inventoryItem.id,
            Number(line.acceptedQty),
            line.poItem ? Number(line.poItem.unitPrice) : 0,
          );
          await tx.inventoryTransaction.create({
            data: {
              itemId: inventoryItem.id,
              gatePassId: receipt.gatePassId,
              goodsReceiptId: receipt.id,
              type: 'IN',
              quantity: line.acceptedQty,
              balanceAfter: moved.balance,
              unitCost: moved.unitCost,
              totalCost: moved.totalCost,
              userId: req.user!.id,
              notes: `Accepted from ${receipt.receiptNumber}`,
            },
          });

          // If this is an ASSET-type item, generate individual asset records
          if (inventoryItem.itemType === InventoryItemType.ASSET) {
            const acceptedCount = Math.floor(Number(line.acceptedQty));
            const poItem = line.poItem;
            const po = receipt.purchaseOrder;
            const invoice = receipt.gatePass?.invoice ?? null;
            const unitPrice = poItem ? Number(poItem.unitPrice) : null;
            const gstRate = poItem ? Number(poItem.gstRate) : null;
            const gstAmount = unitPrice && gstRate ? unitPrice * gstRate / 100 : null;
            const totalCost = unitPrice && gstAmount ? unitPrice + gstAmount : unitPrice;

            for (let i = 0; i < acceptedCount; i++) {
              const assetId = await generateAssetId(tx, projectId);
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
                  gatePassNumber: receipt.gatePass?.passNumber ?? null,
                  receivedBy: receipt.inspectedByUser?.name ?? null,
                  postedBy: req.user!.name,
                  // Live traceability links
                  poId: po?.id ?? null,
                  grnId: receipt.id,
                  vendorId: po?.vendor?.id ?? null,
                  quotationId: po?.quotationId ?? null,
                  gatePassId: receipt.gatePassId,
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
        if (receipt.gatePass?.invoiceId) {
          await tx.vendorInvoice.update({
            where: { id: receipt.gatePass.invoiceId },
            data: { stockStatus: 'RECEIVED' },
          });
        }

        // ── Mark the gate pass as DELIVERED so it is no longer counted as in-transit ──
        // Once a goods receipt is posted, the authorized shipment has been received;
        // keeping it APPROVED would cause the in-transit calculation to double-count
        // already-delivered quantities against the PO remaining quantity.
        if (receipt.gatePassId) {
          await tx.gatePass.update({
            where: { id: receipt.gatePassId },
            data: { status: GatePassStatus.DELIVERED },
          });
        }

        // ── A24: Update PO status inside the same transaction ──
        // Previously this was done after the transaction committed, so a
        // failure left the GRN POSTED but the PO in the wrong state.
        const allReceipts = await tx.goodsReceipt.findMany({
          where: { poId: receipt.poId, deletedAt: null, status: GoodsReceiptStatus.POSTED },
          select: { items: { select: { poItemId: true, materialName: true, acceptedQty: true } } },
        });
        const poItems = await tx.pOItem.findMany({
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
        await tx.purchaseOrder.update({
          where: { id: receipt.poId },
          data: { status: fullyReceived ? 'DELIVERED' : 'PARTIALLY_DELIVERED' },
        });
        // No gate pass to carry an invoice link: once the PO is fully received, its
        // pending invoices are marked as received too.
        if (fullyReceived && !receipt.gatePass?.invoiceId) {
          await tx.vendorInvoice.updateMany({
            where: { poId: receipt.poId, projectId, deletedAt: null, stockStatus: 'PENDING' },
            data: { stockStatus: 'RECEIVED' },
          });
        }

        // ── Accounting: create a PURCHASE voucher for the goods received ──
        // Dr Purchase (consumables) / Dr Fixed Assets (asset items) + Dr Input GST, Cr Sundry Creditor
        // This posts the GRN to the general ledger so the books reflect the
        // inventory increase and the corresponding liability to the vendor.
        // Skipped when this PO's items were already posted to ledgers
        // individually via the PO "Post to Ledger" action — the payable and
        // expense are already booked, so an auto voucher would double-book.
        const itemLedgerPost = await tx.pOItemLedgerPost.findFirst({
          where: { poItem: { poId: receipt.poId } },
          select: { id: true },
        });
        const vendor = receipt.purchaseOrder?.vendor;
        if (vendor && itemLedgerPost) {
          console.warn(`[GRN] Skipping auto purchase voucher for GRN ${receipt.receiptNumber}: PO items were already posted to ledgers individually`);
        }

        // The vendor payable (Dr Purchase / Cr Vendor) is booked when the PO is
        // approved, so a GRN must not credit the vendor again. It only moves the
        // cost of received ASSET items from Purchase to Fixed Assets.
        const poAccrued = await hasPoAccrual(receipt.poId, tx);
        if (vendor && poAccrued && !itemLedgerPost) {
          const assetCost = receipt.items.reduce((sum, line) => {
            if ((line.itemType as InventoryItemType) !== InventoryItemType.ASSET) return sum;
            if (!line.poItem || Number(line.acceptedQty) <= 0) return sum;
            return sum + Number(line.poItem.unitPrice) * Number(line.acceptedQty);
          }, 0);
          const reclassAmount = Math.round(assetCost * 100) / 100;
          if (reclassAmount > 0) {
            let purchaseLedgerId = await findLedgerByName('Purchase', projectId);
            if (!purchaseLedgerId) {
              purchaseLedgerId = (
                await prisma.ledger.create({
                  data: { projectId, name: 'Purchase', group: LedgerGroup.PURCHASE, linkedEntityType: 'NONE', openingBalance: 0, currentBalance: 0, isActive: true },
                })
              ).id;
            }
            let fixedAssetLedgerId = await findLedgerByName('Fixed Assets', projectId);
            if (!fixedAssetLedgerId) {
              fixedAssetLedgerId = (
                await prisma.ledger.create({
                  data: { projectId, name: 'Fixed Assets', group: LedgerGroup.FIXED_ASSET, linkedEntityType: 'NONE', openingBalance: 0, currentBalance: 0, isActive: true },
                })
              ).id;
            }
            const ledgers = await prisma.ledger.findMany({ where: { id: { in: [purchaseLedgerId, fixedAssetLedgerId] }, projectId } });
            const ledgerMap = new Map(ledgers.map((l) => [l.id, { id: l.id, name: l.name, group: l.group, linkedEntityType: l.linkedEntityType, linkedEntityId: l.linkedEntityId }]));
            await postVoucher({
              projectId,
              jvNumber: await generateVoucherNumber(VoucherType.PURCHASE, projectId),
              voucherType: VoucherType.PURCHASE,
              voucherDate: new Date(),
              description: `GRN ${receipt.receiptNumber} - asset items moved to Fixed Assets`,
              totalDebit: reclassAmount,
              totalCredit: reclassAmount,
              entries: [
                { ledgerId: fixedAssetLedgerId, debit: reclassAmount, credit: 0, description: `Fixed Asset - GRN ${receipt.receiptNumber}` },
                { ledgerId: purchaseLedgerId, debit: 0, credit: reclassAmount, description: `Reclassify to Fixed Assets - GRN ${receipt.receiptNumber}` },
              ],
              ledgerMap,
              budgetHeadMap: new Map(),
              sourceInvoiceId: null,
              billSettlements: [],
              userId: req.user!.id,
              tx,
            });
          }
        }

        if (vendor && !itemLedgerPost && !poAccrued) {
          const vendorLedgerId = await ensureVendorLedger(vendor.id, projectId);

          // Find or create Purchase ledger
          let purchaseLedgerId = await findLedgerByName('Purchase', projectId);
          if (!purchaseLedgerId) {
            const ledger = await prisma.ledger.create({
              data: {
                projectId,
                name: 'Purchase',
                group: LedgerGroup.PURCHASE,
                linkedEntityType: 'NONE',
                openingBalance: 0,
                currentBalance: 0,
                isActive: true,
              },
            });
            purchaseLedgerId = ledger.id;
          }

          // Find or create Fixed Assets ledger
          let fixedAssetLedgerId = await findLedgerByName('Fixed Assets', projectId);
          if (!fixedAssetLedgerId) {
            const ledger = await prisma.ledger.create({
              data: {
                projectId,
                name: 'Fixed Assets',
                group: LedgerGroup.FIXED_ASSET,
                linkedEntityType: 'NONE',
                openingBalance: 0,
                currentBalance: 0,
                isActive: true,
              },
            });
            fixedAssetLedgerId = ledger.id;
          }

          // Find GST ledgers (use IGST as fallback for all GST at GRN time)
          const igstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_IGST, projectId);
          const cgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_CGST, projectId);
          const sgstLedgerId = await findLedgerByName(GST_LEDGER_NAMES.INPUT_SGST, projectId);

          // Build entries from GRN line items
          const voucherEntries: Array<{ ledgerId: string; debit: number; credit: number; description?: string }> = [];
          let totalTaxable = 0;
          let totalGst = 0;

          for (const line of receipt.items) {
            if (Number(line.acceptedQty) <= 0) continue;
            const poItem = line.poItem;
            if (!poItem) continue;

            const lineAmount = Number(poItem.unitPrice) * Number(line.acceptedQty);
            const lineGst = lineAmount * Number(poItem.gstRate) / 100;
            totalTaxable += lineAmount;
            totalGst += lineGst;

            const lineItemType = (line.itemType as InventoryItemType) || InventoryItemType.CONSUMABLE;
            const debitLedgerId = lineItemType === InventoryItemType.ASSET ? fixedAssetLedgerId : purchaseLedgerId;

            voucherEntries.push({
              ledgerId: debitLedgerId,
              debit: lineAmount,
              credit: 0,
              description: `${lineItemType === InventoryItemType.ASSET ? 'Fixed Asset' : 'Purchase'} - ${line.materialName}`,
            });
          }

          // Add GST entries — use CGST+SGST if both ledgers exist, otherwise IGST
          if (totalGst > 0) {
            if (cgstLedgerId && sgstLedgerId) {
              const halfGst = Math.round(totalGst / 2 * 100) / 100;
              const otherHalf = Math.round((totalGst - halfGst) * 100) / 100;
              voucherEntries.push({ ledgerId: cgstLedgerId, debit: halfGst, credit: 0, description: 'Input CGST' });
              voucherEntries.push({ ledgerId: sgstLedgerId, debit: otherHalf, credit: 0, description: 'Input SGST' });
            } else if (igstLedgerId) {
              voucherEntries.push({ ledgerId: igstLedgerId, debit: totalGst, credit: 0, description: 'Input IGST' });
            }
          }

          // Credit Vendor (total payable)
          const totalPayable = totalTaxable + totalGst;
          if (totalPayable > 0) {
            voucherEntries.push({
              ledgerId: vendorLedgerId,
              debit: 0,
              credit: totalPayable,
              description: `Payable to ${vendor.name} - GRN ${receipt.receiptNumber}`,
            });

            // Validate totals balance
            const totalDebit = voucherEntries.reduce((s, e) => s + e.debit, 0);
            const totalCredit = voucherEntries.reduce((s, e) => s + e.credit, 0);
            if (Math.abs(totalDebit - totalCredit) > 0.01) {
              // Adjust vendor credit to match debits (rounding safety)
              voucherEntries[voucherEntries.length - 1].credit = totalDebit;
            }

            // Fetch all ledgers for the ledgerMap
            const ledgerIds = voucherEntries.map((e) => e.ledgerId);
            const ledgers = await prisma.ledger.findMany({ where: { id: { in: ledgerIds }, projectId, deletedAt: null, isActive: true } });
            if (ledgers.length === ledgerIds.length) {
              const ledgerMap = new Map(ledgers.map((l) => [l.id, { id: l.id, name: l.name, group: l.group, linkedEntityType: l.linkedEntityType, linkedEntityId: l.linkedEntityId }]));

              const jvNumber = await generateVoucherNumber(VoucherType.PURCHASE, projectId);
              await postVoucher({
                projectId,
                jvNumber,
                voucherType: VoucherType.PURCHASE,
                voucherDate: new Date(),
                description: `GRN ${receipt.receiptNumber} - ${vendor.name}`,
                totalDebit,
                totalCredit,
                entries: voucherEntries,
                ledgerMap,
                budgetHeadMap: new Map(),
                sourceInvoiceId: receipt.gatePass?.invoiceId ?? null,
                billSettlements: [],
                userId: req.user!.id,
                tx,
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

      res.json(posted);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
