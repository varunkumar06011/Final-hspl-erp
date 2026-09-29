-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN "mprId" UUID;

-- CreateIndex
CREATE INDEX "purchase_orders_mprId_idx" ON "purchase_orders"("mprId");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_mprId_fkey" FOREIGN KEY ("mprId") REFERENCES "material_purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
