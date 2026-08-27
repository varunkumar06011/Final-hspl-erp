-- Add payment type to purchase orders (ADVANCE | AFTER_DELIVERY | FULL_PAYMENT)
ALTER TABLE "purchase_orders" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'AFTER_DELIVERY';

-- Add optional PO link to payment requests (for advance payments against a PO)
ALTER TABLE "payment_requests" ADD COLUMN "poId" UUID REFERENCES "purchase_orders"("id") ON DELETE SET NULL;
