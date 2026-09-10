-- Add agreed advance amount to purchase orders (captured at PO creation for ADVANCE / FULL_PAYMENT type POs)
ALTER TABLE "purchase_orders" ADD COLUMN "advanceAmount" DECIMAL(15,2);
