-- AlterTable: add vendorCode and new columns to vendors
ALTER TABLE "vendors" ADD COLUMN "vendorCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "vendors" ADD COLUMN "contactPersonName" TEXT;
ALTER TABLE "vendors" ADD COLUMN "contactPersonPhone" TEXT;
ALTER TABLE "vendors" ADD COLUMN "referenceBy" TEXT;

-- AddUniqueConstraint
CREATE UNIQUE INDEX "vendors_vendorCode_key" ON "vendors"("vendorCode");

-- CreateTable: VendorMaterial
CREATE TABLE "vendor_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "pricePerUnit" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vendor_materials" ADD CONSTRAINT "vendor_materials_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE;