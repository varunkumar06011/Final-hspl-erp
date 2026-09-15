-- PaymentSheet: daily printable register of payments made against a PO.
-- Standalone log only — does not move bank/cash balances or create vouchers.
CREATE TABLE "payment_sheets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "poId" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(15,2) NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "filePath" TEXT,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payment_sheets_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "payment_sheets_projectId_date_idx" ON "payment_sheets"("projectId", "date");
CREATE INDEX "payment_sheets_projectId_deletedAt_idx" ON "payment_sheets"("projectId", "deletedAt");

-- Foreign keys
ALTER TABLE "payment_sheets"
  ADD CONSTRAINT "payment_sheets_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_sheets"
  ADD CONSTRAINT "payment_sheets_poId_fkey"
  FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_sheets"
  ADD CONSTRAINT "payment_sheets_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
