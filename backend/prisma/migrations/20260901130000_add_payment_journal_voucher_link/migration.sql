-- Add journalVoucherId to payments table to link each payment to its double-entry voucher
ALTER TABLE "payments" ADD COLUMN "journalVoucherId" UUID;
