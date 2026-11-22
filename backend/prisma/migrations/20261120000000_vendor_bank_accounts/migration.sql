-- Several bank accounts per vendor. Additive: new table + nullable column, nothing dropped.
-- The vendor's existing single account becomes its primary row (isPrimary = true), so the
-- vendor's own columns and every reader of them keep the same values.

-- CreateTable
CREATE TABLE IF NOT EXISTS "vendor_bank_accounts" (
    "id" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "bankName" TEXT,
    "accountHolderName" TEXT,
    "accountNumber" TEXT NOT NULL,
    "ifscCode" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "paymentBankAccountId" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_bank_accounts_vendorId_idx" ON "vendor_bank_accounts"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_bank_accounts_vendorId_accountNumber_ifscCode_key" ON "vendor_bank_accounts"("vendorId", "accountNumber", "ifscCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "material_purchase_requests_paymentBankAccountId_idx" ON "material_purchase_requests"("paymentBankAccountId");

-- AddForeignKey
ALTER TABLE "vendor_bank_accounts" ADD CONSTRAINT "vendor_bank_accounts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_purchase_requests" ADD CONSTRAINT "material_purchase_requests_paymentBankAccountId_fkey" FOREIGN KEY ("paymentBankAccountId") REFERENCES "vendor_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: each vendor's existing account becomes its primary row. Idempotent: skipped when
-- the vendor already has a row.
INSERT INTO "vendor_bank_accounts" ("id", "vendorId", "bankName", "accountHolderName", "accountNumber", "ifscCode", "isPrimary", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v."id", v."bankName", v."accountHolderName", v."bankAccountNumber", v."ifscCode", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "vendors" v
WHERE v."bankAccountNumber" IS NOT NULL AND btrim(v."bankAccountNumber") <> ''
  AND v."ifscCode" IS NOT NULL AND btrim(v."ifscCode") <> ''
  AND NOT EXISTS (SELECT 1 FROM "vendor_bank_accounts" a WHERE a."vendorId" = v."id");
