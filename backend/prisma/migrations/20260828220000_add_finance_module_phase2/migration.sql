-- Finance Module Phase 2: Journal Vouchers & Owner Account
-- Additive only
-- Idempotent: safe to re-run if partially applied.

-- ═══ Owner Accounts ═══
CREATE TABLE IF NOT EXISTS "owner_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "ownerName" TEXT NOT NULL,
  "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "owner_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "owner_accounts_projectId_idx" ON "owner_accounts"("projectId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_accounts_projectId_fkey') THEN
    ALTER TABLE "owner_accounts" ADD CONSTRAINT "owner_accounts_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══ Journal Vouchers ═══
CREATE TABLE IF NOT EXISTS "journal_vouchers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "jvNumber" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "totalDebit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "totalCredit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "postedAt" TIMESTAMP(3),
  "postedBy" UUID,
  "approvalWorkflowId" UUID,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "journal_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "journal_vouchers_jvNumber_key" ON "journal_vouchers"("jvNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "journal_vouchers_approvalWorkflowId_key" ON "journal_vouchers"("approvalWorkflowId");
CREATE INDEX IF NOT EXISTS "journal_vouchers_projectId_idx" ON "journal_vouchers"("projectId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_vouchers_projectId_fkey') THEN
    ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_vouchers_approvalWorkflowId_fkey') THEN
    ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_approvalWorkflowId_fkey"
      FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_vouchers_createdBy_fkey') THEN
    ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_vouchers_postedBy_fkey') THEN
    ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_postedBy_fkey"
      FOREIGN KEY ("postedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══ Journal Entries ═══
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "journalVoucherId" UUID NOT NULL,
  "accountType" TEXT NOT NULL,
  "accountId" UUID,
  "budgetHeadId" UUID,
  "ownerAccountId" UUID,
  "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "description" TEXT,
  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "journal_entries_journalVoucherId_idx" ON "journal_entries"("journalVoucherId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_journalVoucherId_fkey') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journalVoucherId_fkey"
      FOREIGN KEY ("journalVoucherId") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_budgetHeadId_fkey') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_budgetHeadId_fkey"
      FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_ownerAccountId_fkey') THEN
    ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_ownerAccountId_fkey"
      FOREIGN KEY ("ownerAccountId") REFERENCES "owner_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
