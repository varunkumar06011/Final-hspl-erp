-- PO approval now books the vendor payable (Dr Purchase / Cr Vendor). Additive-only.
ALTER TABLE "journal_vouchers" ADD COLUMN "sourcePoId" UUID;
CREATE INDEX "journal_vouchers_sourcePoId_idx" ON "journal_vouchers"("sourcePoId");

ALTER TABLE "purchase_orders" ADD COLUMN "accrualExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_orders" ADD COLUMN "accrualLedgerId" UUID;

-- Every PO that exists today predates auto-booking; the accountant already
-- handled (or is handling) their books, so exempt them. Only POs still awaiting
-- their first approval get the automatic vendor credit.
UPDATE "purchase_orders" SET "accrualExempt" = true
WHERE NOT ("status" IN ('PENDING_APPROVAL', 'PENDING') AND "editedAt" IS NULL);
