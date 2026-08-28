-- Finance Module Phase 3: Cost Tagging + Integration
-- Add budgetHeadId to payment_requests and purchase_orders

ALTER TABLE "payment_requests" ADD COLUMN "budgetHeadId" UUID;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_budgetHeadId_fkey"
  FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD COLUMN "budgetHeadId" UUID;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budgetHeadId_fkey"
  FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
