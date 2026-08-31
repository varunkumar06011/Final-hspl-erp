-- Accounting ledger module: Chart of Accounts + Ledger Entries + voucher types
-- Adds Tally-style double-entry accounting layer alongside existing finance module.

-- 1. Add voucherType + sourceInvoiceId to journal_vouchers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'journal_vouchers' AND column_name = 'voucherType') THEN
    ALTER TABLE "journal_vouchers" ADD COLUMN "voucherType" TEXT NOT NULL DEFAULT 'JOURNAL';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'journal_vouchers' AND column_name = 'sourceInvoiceId') THEN
    ALTER TABLE "journal_vouchers" ADD COLUMN "sourceInvoiceId" UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "journal_vouchers_voucherType_idx" ON "journal_vouchers"("voucherType");

-- 2. Create ledgers table
CREATE TABLE IF NOT EXISTS "ledgers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "linkedEntityType" TEXT,
    "linkedEntityId" UUID,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ledgers_projectId_name_key" ON "ledgers"("projectId", "name");
CREATE INDEX IF NOT EXISTS "ledgers_projectId_group_idx" ON "ledgers"("projectId", "group");
CREATE INDEX IF NOT EXISTS "ledgers_linkedEntityType_linkedEntityId_idx" ON "ledgers"("linkedEntityType", "linkedEntityId");

ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Create ledger_entries table
CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ledgerId" UUID NOT NULL,
    "journalVoucherId" UUID NOT NULL,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "voucherType" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "voucherDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ledger_entries_ledgerId_voucherDate_idx" ON "ledger_entries"("ledgerId", "voucherDate");
CREATE INDEX IF NOT EXISTS "ledger_entries_journalVoucherId_idx" ON "ledger_entries"("journalVoucherId");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledgerId_fkey"
    FOREIGN KEY ("ledgerId") REFERENCES "ledgers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journalVoucherId_fkey"
    FOREIGN KEY ("journalVoucherId") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
