-- Quotations are finalized (picked) instead of approved; site bills (paid at site,
-- up to the site-bill limit) are material requests combined into one PO.
-- Additive only: new nullable/defaulted columns and indexes.
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "finalizedBy" UUID;

ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "isSiteBill" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "billDate" TIMESTAMP(3);
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "billShopName" TEXT;
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "billPaymentMode" TEXT;
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "sitePoId" UUID;
CREATE INDEX IF NOT EXISTS "material_purchase_requests_projectId_isSiteBill_idx" ON "material_purchase_requests"("projectId", "isSiteBill");
CREATE INDEX IF NOT EXISTS "material_purchase_requests_sitePoId_idx" ON "material_purchase_requests"("sitePoId");

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "isSiteBillBatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "reimburseTo" TEXT;
