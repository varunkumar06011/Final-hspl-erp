-- Per-item GST on requests and the account holder name on vendors (additive, nullable columns only).
ALTER TABLE "material_purchase_request_items" ADD COLUMN IF NOT EXISTS "gstRate" DECIMAL(5,2);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "accountHolderName" TEXT;
