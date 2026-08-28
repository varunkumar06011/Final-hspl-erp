-- Finance Module Phase 3: Cost Tagging + Integration
-- Add budgetHeadId to payment_requests and purchase_orders
-- Idempotent: safe to re-run if partially applied.

ALTER TABLE "payment_requests" ADD COLUMN IF NOT EXISTS "budgetHeadId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_budgetHeadId_fkey') THEN
    ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_budgetHeadId_fkey"
      FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "budgetHeadId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_budgetHeadId_fkey') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budgetHeadId_fkey"
      FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
