-- Add regeneration support columns to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN "parentPoId" UUID;
ALTER TABLE "purchase_orders" ADD COLUMN "regenerationNumber" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "regenerationData" JSONB;
ALTER TABLE "purchase_orders" ADD COLUMN "editReason" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN "editedBy" UUID;

-- Self-referential FK for parent PO
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_parentPoId_fkey" FOREIGN KEY ("parentPoId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL;

-- FK for editedBy user
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "users"("id") ON DELETE SET NULL;

-- Index for finding child POs of a parent
CREATE INDEX "purchase_orders_parentPoId_idx" ON "purchase_orders"("parentPoId");
