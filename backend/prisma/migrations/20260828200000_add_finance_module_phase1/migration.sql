-- Finance Module Phase 1: Budget Heads, Bank Accounts, Cash Accounts
-- Additive only — does not touch existing tables (except adding nullable columns to payments)

-- ═══ Budget Heads ═══
CREATE TABLE "budget_heads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "slNo" INTEGER NOT NULL,
  "particulars" TEXT NOT NULL,
  "allocatedAmount" DECIMAL(15,2) NOT NULL,
  "committedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "actualAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "budget_heads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "budget_heads_projectId_slNo_key" ON "budget_heads"("projectId", "slNo");
CREATE INDEX "budget_heads_projectId_idx" ON "budget_heads"("projectId");
ALTER TABLE "budget_heads" ADD CONSTRAINT "budget_heads_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ Bank Accounts ═══
CREATE TABLE "bank_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "accountName" TEXT NOT NULL,
  "bankName" TEXT,
  "accountNumber" TEXT,
  "ifscCode" TEXT,
  "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_accounts_projectId_idx" ON "bank_accounts"("projectId");
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ Bank Transactions ═══
CREATE TABLE "bank_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bankAccountId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "balanceAfter" DECIMAL(15,2) NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "referenceType" TEXT NOT NULL,
  "referenceId" UUID,
  "transferPairId" UUID,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "reversalOfId" UUID,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_transactions_bankAccountId_date_idx" ON "bank_transactions"("bankAccountId", "date");
CREATE INDEX "bank_transactions_referenceType_referenceId_idx" ON "bank_transactions"("referenceType", "referenceId");
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ Cash Accounts ═══
CREATE TABLE "cash_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_accounts_projectId_idx" ON "cash_accounts"("projectId");
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ Cash Transactions ═══
CREATE TABLE "cash_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cashAccountId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "balanceAfter" DECIMAL(15,2) NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "description" TEXT,
  "referenceType" TEXT NOT NULL,
  "referenceId" UUID,
  "transferPairId" UUID,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "reversalOfId" UUID,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_transactions_cashAccountId_date_idx" ON "cash_transactions"("cashAccountId", "date");
CREATE INDEX "cash_transactions_referenceType_referenceId_idx" ON "cash_transactions"("referenceType", "referenceId");
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══ Add finance link columns to payments table (all nullable, additive) ═══
ALTER TABLE "payments" ADD COLUMN "bankAccountId" UUID;
ALTER TABLE "payments" ADD COLUMN "cashAccountId" UUID;
ALTER TABLE "payments" ADD COLUMN "budgetHeadId" UUID;
ALTER TABLE "payments" ADD COLUMN "postedAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "reversalOfId" UUID;

ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_budgetHeadId_fkey"
  FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
