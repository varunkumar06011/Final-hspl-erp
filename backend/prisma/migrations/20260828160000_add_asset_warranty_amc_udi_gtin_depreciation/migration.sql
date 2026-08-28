-- Add regulatory, warranty, AMC, and depreciation fields to assets table

ALTER TABLE "assets" ADD COLUMN "udi" TEXT;
ALTER TABLE "assets" ADD COLUMN "gtin" TEXT;
ALTER TABLE "assets" ADD COLUMN "warrantyExpiry" TIMESTAMP(3);
ALTER TABLE "assets" ADD COLUMN "amcVendor" TEXT;
ALTER TABLE "assets" ADD COLUMN "amcExpiry" TIMESTAMP(3);
ALTER TABLE "assets" ADD COLUMN "usefulLifeYears" DECIMAL(5,1);
ALTER TABLE "assets" ADD COLUMN "depreciationMethod" TEXT;
ALTER TABLE "assets" ADD COLUMN "salvageValue" DECIMAL(15,2);
