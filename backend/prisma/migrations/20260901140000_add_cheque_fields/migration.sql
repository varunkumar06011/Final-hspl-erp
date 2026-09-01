-- Add cheque number and cheque date to journal vouchers (Tally-style)
ALTER TABLE "journal_vouchers" ADD COLUMN "chequeNumber" TEXT;
ALTER TABLE "journal_vouchers" ADD COLUMN "chequeDate" TIMESTAMP(3);
