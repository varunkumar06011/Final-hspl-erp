import { Router, Response, NextFunction } from 'express';
import { GoodsReceiptStatus, Permission, AuditAction, InspectionStatus } from '@hospital-erp/shared';
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

const router = Router();
router.use(authMiddleware);

const receiptInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { id: true, name: true, vendorCode: true } } } },
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
        where: { projectId, status: 'APPROVED', deletedAt: null, goodsReceipt: null },
        include: {
          purchaseOrder: { select: { id: true, poNumber: true, vendor: { select: { id: true, name: true, vendorCode: true } } } },
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
        include: { items: true, purchaseOrder: { include: { items: true } }, goodsReceipt: true },
      });
      if (!gatePass || !gatePass.purchaseOrder) {
        res.status(400).json({ error: 'Only an approved material gatepass can create a goods receipt' });
        return;
      }
      if (gatePass.goodsReceipt) {
        res.status(409).json({ error: 'A goods receipt already exists for this gatepass' });
        return;
      }
      if (gatePass.items.length === 0) {
        res.status(400).json({ error: 'The gatepass has no received items' });
        return;
      }

      const receiptNumber = await generateReceiptNumber(projectId);
      const poItems = new Map(gatePass.purchaseOrder.items.map((item) => [item.materialName.toLowerCase(), item]));
      const receipt = await prisma.goodsReceipt.create({
        data: {
          projectId,
          poId: gatePass.poId!,
          gatePassId: gatePass.id,
          receiptNumber,
          status: GoodsReceiptStatus.PENDING_INSPECTION,
          createdBy: req.user!.id,
          items: {
            create: gatePass.items.map((item) => ({
              poItemId: poItems.get(item.materialName.toLowerCase())?.id ?? undefined,
              materialName: item.materialName,
              unit: item.unit,
              deliveredQty: item.quantity,
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
      if (receipt.status !== GoodsReceiptStatus.PENDING_INSPECTION) {
        res.status(400).json({ error: 'This goods receipt has already been inspected or posted' });
        return;
      }
      if (receipt.createdBy === req.user!.id || receipt.gatePass.createdBy === req.user!.id) {
        res.status(403).json({ error: 'The person who created the receipt or gatepass cannot inspect it' });
        return;
      }

      const submitted = new Map((req.body.items as { id: string; acceptedQty: number; rejectedQty: number; rejectionReason?: string }[]).map((item) => [item.id, item]));
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
      }

      const rejected = (req.body.items as { rejectedQty: number }[]).some((item) => Number(item.rejectedQty) > 0);
      const result = await prisma.$transaction(async (tx) => {
        for (const item of receipt.items) {
          const disposition = submitted.get(item.id)!;
          await tx.goodsReceiptItem.update({
            where: { id: item.id },
            data: {
              acceptedQty: Number(disposition.acceptedQty),
              rejectedQty: Number(disposition.rejectedQty),
              rejectionReason: disposition.rejectionReason?.trim() || null,
            },
          });
        }
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
        include: { items: true, gatePass: true },
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
          let inventoryItem = await tx.inventoryItem.findFirst({
            where: { projectId, name: { equals: line.materialName, mode: 'insensitive' }, deletedAt: null },
          });
          if (!inventoryItem) {
            inventoryItem = await tx.inventoryItem.create({
              data: {
                projectId,
                name: line.materialName,
                sku: await generateInventorySku(tx, projectId, 'MATERIAL'),
                category: 'MATERIAL',
                unit: line.unit || 'nos',
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
        }
        if (receipt.gatePass.invoiceId) {
          await tx.vendorInvoice.update({
            where: { id: receipt.gatePass.invoiceId },
            data: { stockStatus: 'RECEIVED' },
          });
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
        select: { items: { select: { materialName: true, acceptedQty: true } } },
      });
      const poItems = await prisma.pOItem.findMany({
        where: { poId: receipt.poId },
        select: { materialName: true, quantity: true },
      });
      const acceptedByName = new Map<string, number>();
      for (const r of allReceipts) {
        for (const item of r.items) {
          const name = item.materialName.toLowerCase();
          acceptedByName.set(name, (acceptedByName.get(name) ?? 0) + Number(item.acceptedQty));
        }
      }
      const fullyReceived = poItems.every(
        (item) => (acceptedByName.get(item.materialName.toLowerCase()) ?? 0) >= Number(item.quantity),
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
