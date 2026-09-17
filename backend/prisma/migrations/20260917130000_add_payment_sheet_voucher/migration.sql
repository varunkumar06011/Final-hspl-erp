-- PaymentSheet entries can now reference a journal voucher instead of a PO.
-- Exactly one of poId / voucherId is set per row (enforced at the API layer).
ALTER TABLE "payment_sheets" ALTER COLUMN "poId" DROP NOT NULL;
ALTER TABLE "payment_sheets" ADD COLUMN "voucherId" UUID;

CREATE INDEX "payment_sheets_projectId_voucherId_idx" ON "payment_sheets"("projectId", "voucherId");

ALTER TABLE "payment_sheets"
  ADD CONSTRAINT "payment_sheets_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "journal_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
