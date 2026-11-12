-- How a material / service request is paid: BANK_TRANSFER | CASH | CHEQUE (additive, nullable for old rows).
ALTER TABLE "material_purchase_requests" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
