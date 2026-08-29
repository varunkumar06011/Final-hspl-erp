-- Asset traceability: add live FK links from assets to their source records
-- (purchase order, goods receipt, vendor, quotation, gate pass). The frozen
-- snapshot string columns (vendorName, poNumber, receiptNumber, etc.) are kept
-- for historical record; these FKs enable forward + reverse traceability.
-- Idempotent: safe to re-run.

-- Add nullable FK columns to assets
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "poId" UUID;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "grnId" UUID;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "vendorId" UUID;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "quotationId" UUID;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "gatePassId" UUID;

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_poId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_poId_fkey"
      FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_grnId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_grnId_fkey"
      FOREIGN KEY ("grnId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_vendorId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_quotationId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_quotationId_fkey"
      FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_gatePassId_fkey') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_gatePassId_fkey"
      FOREIGN KEY ("gatePassId") REFERENCES "gate_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for reverse lookups
CREATE INDEX IF NOT EXISTS "assets_poId_idx" ON "assets"("poId");
CREATE INDEX IF NOT EXISTS "assets_grnId_idx" ON "assets"("grnId");
CREATE INDEX IF NOT EXISTS "assets_vendorId_idx" ON "assets"("vendorId");
