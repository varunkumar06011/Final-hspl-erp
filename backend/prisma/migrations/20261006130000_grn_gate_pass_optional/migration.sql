-- A goods receipt is now raised against an approved PO; the gate pass becomes optional.
-- Relaxes one NOT NULL constraint. No row is changed. The existing unique index on
-- "gatePassId" stays (Postgres allows many NULLs), so each gate pass can still back
-- at most one receipt.

ALTER TABLE "goods_receipts" ALTER COLUMN "gatePassId" DROP NOT NULL;

-- Keep the FK in line with an optional relation (Prisma uses SET NULL for these).
ALTER TABLE "goods_receipts" DROP CONSTRAINT IF EXISTS "goods_receipts_gatePassId_fkey";
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_gatePassId_fkey" FOREIGN KEY ("gatePassId") REFERENCES "gate_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
