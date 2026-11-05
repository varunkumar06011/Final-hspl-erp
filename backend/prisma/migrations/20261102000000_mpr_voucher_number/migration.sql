-- Free-text voucher number on material/service requests and site bills (additive).
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "voucherNumber" TEXT;
CREATE INDEX IF NOT EXISTS "material_purchase_requests_voucherNumber_idx" ON "material_purchase_requests"("voucherNumber");
