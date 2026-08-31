-- Cost centers in ledger entries + bill-wise accounting + inventory valuation

-- 1. Add budgetHeadId to ledger_entries (cost center allocation)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ledger_entries' AND column_name = 'budgetHeadId') THEN
    ALTER TABLE "ledger_entries" ADD COLUMN "budgetHeadId" UUID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ledger_entries_budgetHeadId_idx" ON "ledger_entries"("budgetHeadId");
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_budgetHeadId_fkey"
    FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Create bill_settlements table (bill-wise accounting)
CREATE TABLE IF NOT EXISTS "bill_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "journalVoucherId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bill_settlements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bill_settlements_journalVoucherId_idx" ON "bill_settlements"("journalVoucherId");
CREATE INDEX IF NOT EXISTS "bill_settlements_invoiceId_idx" ON "bill_settlements"("invoiceId");
CREATE INDEX IF NOT EXISTS "bill_settlements_vendorId_idx" ON "bill_settlements"("vendorId");
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_journalVoucherId_fkey"
    FOREIGN KEY ("journalVoucherId") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_settlements" ADD CONSTRAINT "bill_settlements_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Add inventory valuation fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'inventory_items' AND column_name = 'valuationMethod') THEN
    ALTER TABLE "inventory_items" ADD COLUMN "valuationMethod" TEXT NOT NULL DEFAULT 'FIFO';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'inventory_items' AND column_name = 'weightedAvgCost') THEN
    ALTER TABLE "inventory_items" ADD COLUMN "weightedAvgCost" DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'inventory_items' AND column_name = 'totalValue') THEN
    ALTER TABLE "inventory_items" ADD COLUMN "totalValue" DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 4. Add cost tracking to inventory_transactions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'inventory_transactions' AND column_name = 'unitCost') THEN
    ALTER TABLE "inventory_transactions" ADD COLUMN "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'inventory_transactions' AND column_name = 'totalCost') THEN
    ALTER TABLE "inventory_transactions" ADD COLUMN "totalCost" DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_transactions_itemId_timestamp_idx" ON "inventory_transactions"("itemId", "timestamp");
