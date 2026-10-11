-- Site bills can carry an optional budget head of their own.
ALTER TABLE "material_purchase_requests" ADD COLUMN "billBudgetHeadId" UUID;
CREATE INDEX "material_purchase_requests_billBudgetHeadId_idx" ON "material_purchase_requests"("billBudgetHeadId");
ALTER TABLE "material_purchase_requests" ADD CONSTRAINT "material_purchase_requests_billBudgetHeadId_fkey" FOREIGN KEY ("billBudgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
