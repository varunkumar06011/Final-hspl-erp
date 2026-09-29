-- Split Material Purchase Requests into MATERIAL and SERVICE requests.
-- Additive-only: existing rows default to MATERIAL, so no backfill needed.
ALTER TABLE "material_purchase_requests" ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'MATERIAL';
ALTER TABLE "material_purchase_requests" ADD COLUMN "serviceCategory" TEXT;
ALTER TABLE "material_purchase_requests" ADD COLUMN "servicePeriodStart" TIMESTAMP(3);
ALTER TABLE "material_purchase_requests" ADD COLUMN "servicePeriodEnd" TIMESTAMP(3);

CREATE INDEX "material_purchase_requests_projectId_requestType_idx" ON "material_purchase_requests"("projectId", "requestType");
