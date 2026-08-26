CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "poId" UUID NOT NULL,
    "gatePassId" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_INSPECTION',
    "inspectedBy" UUID,
    "inspectedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "postedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "poItemId" UUID,
    "materialName" TEXT NOT NULL,
    "unit" TEXT,
    "deliveredQty" DECIMAL(10,2) NOT NULL,
    "acceptedQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_transactions" ADD COLUMN "goodsReceiptId" UUID;
ALTER TABLE "inspections" ADD COLUMN "goodsReceiptId" UUID;

CREATE UNIQUE INDEX "goods_receipts_gatePassId_key" ON "goods_receipts"("gatePassId");
CREATE UNIQUE INDEX "goods_receipts_projectId_receiptNumber_key" ON "goods_receipts"("projectId", "receiptNumber");
CREATE UNIQUE INDEX "inspections_goodsReceiptId_key" ON "inspections"("goodsReceiptId");

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_gatePassId_fkey" FOREIGN KEY ("gatePassId") REFERENCES "gate_passes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_inspectedBy_fkey" FOREIGN KEY ("inspectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "po_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
