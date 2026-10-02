-- Direct (no-PO) stock receipts + consumption tracking on inventory transactions.
-- Additive only: two new tables and five nullable columns on inventory_transactions.
-- No existing row is changed.

CREATE TABLE "stock_entries" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierName" TEXT,
    "referenceNo" TEXT,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_entry_items" (
    "id" UUID NOT NULL,
    "stockEntryId" UUID NOT NULL,
    "materialName" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "itemType" TEXT NOT NULL DEFAULT 'CONSUMABLE',
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_entry_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_transactions"
  ADD COLUMN "stockEntryId" UUID,
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "phaseId" UUID,
  ADD COLUMN "budgetHeadId" UUID,
  ADD COLUMN "issuedTo" TEXT;

CREATE UNIQUE INDEX "stock_entries_projectId_entryNumber_key" ON "stock_entries"("projectId", "entryNumber");
CREATE INDEX "stock_entries_projectId_deletedAt_idx" ON "stock_entries"("projectId", "deletedAt");
CREATE INDEX "stock_entries_projectId_status_idx" ON "stock_entries"("projectId", "status");
CREATE INDEX "inventory_transactions_stockEntryId_idx" ON "inventory_transactions"("stockEntryId");

ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_entry_items" ADD CONSTRAINT "stock_entry_items_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "stock_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "stock_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_budgetHeadId_fkey" FOREIGN KEY ("budgetHeadId") REFERENCES "budget_heads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
