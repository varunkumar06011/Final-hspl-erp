-- AlterTable
ALTER TABLE "journal_vouchers" ADD COLUMN "updatedBy" UUID;

-- AddForeignKey
ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
