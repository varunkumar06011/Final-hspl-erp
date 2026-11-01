-- Item catalog (one list of materials and services shared by every project), item +
-- specification links on every line that names a material, and a separate number
-- series for service requests.
--
-- Additive only. The catalog itself is filled from the existing lines by the server at
-- start-up (services/catalog-backfill.service.ts), which is idempotent.

-- AlterTable
ALTER TABLE "quotation_items" ADD COLUMN     "itemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "po_items" ADD COLUMN     "itemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "gate_pass_items" ADD COLUMN     "itemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "itemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "catalogItemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "stock_entry_items" ADD COLUMN     "itemId" UUID,
ADD COLUMN     "specification" TEXT;

-- AlterTable
ALTER TABLE "material_purchase_requests" ADD COLUMN     "legacyNumber" TEXT;

-- AlterTable
ALTER TABLE "material_purchase_request_items" ADD COLUMN     "itemId" UUID;

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MATERIAL',
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "unit" TEXT,
    "category" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" UUID,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_item_specs" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "valueKey" TEXT NOT NULL,
    "isPredefined" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_item_specs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");

-- CreateIndex
CREATE INDEX "catalog_items_isActive_idx" ON "catalog_items"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_kind_nameKey_key" ON "catalog_items"("kind", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_item_specs_itemId_valueKey_key" ON "catalog_item_specs"("itemId", "valueKey");

-- CreateIndex
CREATE INDEX "quotation_items_itemId_idx" ON "quotation_items"("itemId");

-- CreateIndex
CREATE INDEX "po_items_itemId_idx" ON "po_items"("itemId");

-- CreateIndex
CREATE INDEX "inventory_items_projectId_catalogItemId_idx" ON "inventory_items"("projectId", "catalogItemId");

-- CreateIndex
CREATE INDEX "material_purchase_request_items_itemId_idx" ON "material_purchase_request_items"("itemId");

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_pass_items" ADD CONSTRAINT "gate_pass_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_request_items" ADD CONSTRAINT "material_purchase_request_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item_specs" ADD CONSTRAINT "catalog_item_specs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Service requests get their own series (<code>-SR001). Existing ones are renumbered in
-- the order they were created; the old MPR number is kept in "legacyNumber" so search and
-- old references still find them. Deleted rows are included so the unique
-- (projectId, mprNumber) index can never collide later.
WITH ranked AS (
  SELECT m.id,
         p.code,
         ROW_NUMBER() OVER (PARTITION BY m."projectId" ORDER BY m."createdAt", m.id) AS n
  FROM "material_purchase_requests" m
  JOIN "projects" p ON p.id = m."projectId"
  WHERE m."requestType" = 'SERVICE'
)
UPDATE "material_purchase_requests" m
SET "legacyNumber" = m."mprNumber",
    "mprNumber" = r.code || '-SR' || LPAD(r.n::text, 3, '0')
FROM ranked r
WHERE r.id = m.id;

CREATE INDEX "material_purchase_requests_legacyNumber_idx" ON "material_purchase_requests"("legacyNumber");
