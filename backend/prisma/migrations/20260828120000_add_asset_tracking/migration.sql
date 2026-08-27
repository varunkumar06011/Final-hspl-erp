-- Add itemType column to inventory_items
ALTER TABLE "inventory_items" ADD COLUMN "itemType" TEXT NOT NULL DEFAULT 'CONSUMABLE';

-- Create assets table
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "assetId" TEXT NOT NULL,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT NOT NULL DEFAULT 'Main Store',
    "issuedToDept" TEXT,
    "issuedToPerson" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedBy" UUID,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastScannedAt" TIMESTAMP(3),
    "lastScannedBy" UUID,
    "lastScanLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorName" TEXT,
    "vendorCode" TEXT,
    "quotationNumber" TEXT,
    "quotationDate" TIMESTAMP(3),
    "poNumber" TEXT,
    "poDate" TIMESTAMP(3),
    "poPaymentType" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "unitPrice" DECIMAL(15,2),
    "gstRate" DECIMAL(5,2),
    "gstAmount" DECIMAL(15,2),
    "totalCost" DECIMAL(15,2),
    "poCreatedBy" TEXT,
    "receiptNumber" TEXT,
    "receiptDate" TIMESTAMP(3),
    "gatePassNumber" TEXT,
    "receivedBy" TEXT,
    "postedBy" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assets_assetId_key" ON "assets"("assetId");
CREATE UNIQUE INDEX "assets_serialNumber_key" ON "assets"("serialNumber");
CREATE INDEX "assets_projectId_status_idx" ON "assets"("projectId", "status");
CREATE INDEX "assets_inventoryItemId_idx" ON "assets"("inventoryItemId");

-- Create asset_movements table
CREATE TABLE "asset_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromLocation" TEXT,
    "toLocation" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "issuedToDept" TEXT,
    "issuedToPerson" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "userId" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_movements_assetId_timestamp_idx" ON "asset_movements"("assetId", "timestamp");

-- Create asset_scans table
CREATE TABLE "asset_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL,
    "userId" UUID,
    "userAgent" TEXT,
    "location" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_scans_assetId_timestamp_idx" ON "asset_scans"("assetId", "timestamp");

-- Create asset_maintenances table
CREATE TABLE "asset_maintenances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "maintenanceVendor" TEXT,
    "technician" TEXT,
    "notes" TEXT,
    "cost" DECIMAL(15,2),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" UUID NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedBy" UUID,
    "completionNotes" TEXT,
    "finalCost" DECIMAL(15,2),

    CONSTRAINT "asset_maintenances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_maintenances_assetId_sentAt_idx" ON "asset_maintenances"("assetId", "sentAt");

-- Add foreign key constraints
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT;
ALTER TABLE "assets" ADD CONSTRAINT "assets_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT;
ALTER TABLE "assets" ADD CONSTRAINT "assets_issuedBy_fkey" FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "assets" ADD CONSTRAINT "assets_lastScannedBy_fkey" FOREIGN KEY ("lastScannedBy") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "asset_scans" ADD CONSTRAINT "asset_scans_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_scans" ADD CONSTRAINT "asset_scans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "asset_maintenances" ADD CONSTRAINT "asset_maintenances_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "users"("id") ON DELETE SET NULL;
