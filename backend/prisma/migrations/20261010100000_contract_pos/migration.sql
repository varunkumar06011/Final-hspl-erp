-- Contract POs (rate contracts / work orders) with sub-POs per billing period.
-- Purely additive: every new column is nullable or has a default, so existing POs are untouched.
ALTER TABLE "purchase_orders"
  ADD COLUMN "isContract" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contractPoId" UUID,
  ADD COLUMN "contractTitle" TEXT,
  ADD COLUMN "contractType" TEXT,
  ADD COLUMN "estimatedValue" DECIMAL(15,2),
  ADD COLUMN "contractStart" TIMESTAMP(3),
  ADD COLUMN "contractEnd" TIMESTAMP(3),
  ADD COLUMN "contractClosedAt" TIMESTAMP(3),
  ADD COLUMN "periodLabel" TEXT,
  ADD COLUMN "periodFrom" TIMESTAMP(3),
  ADD COLUMN "periodTo" TIMESTAMP(3);

CREATE INDEX "purchase_orders_contractPoId_idx" ON "purchase_orders"("contractPoId");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_contractPoId_fkey"
  FOREIGN KEY ("contractPoId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
