-- Inventory items carry the project material code and the aliases of merged duplicates.
-- Additive only: two new columns and an index.
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "materialCode" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "inventory_items_projectId_materialCode_idx" ON "inventory_items"("projectId", "materialCode");
