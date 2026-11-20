-- Daily site material slips: taken in the morning, used / returned in the evening.
-- Additive only: two new tables. No existing row or column is changed.
CREATE TABLE IF NOT EXISTS "site_material_slips" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "slipNumber" TEXT NOT NULL,
    "slipDate" DATE NOT NULL,
    "takenById" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "work" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_material_slips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "site_material_slip_lines" (
    "id" UUID NOT NULL,
    "slipId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "takenQty" DECIMAL(10,2) NOT NULL,
    "usedQty" DECIMAL(10,2),
    "returnedQty" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_material_slip_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "site_material_slips_projectId_slipNumber_key" ON "site_material_slips"("projectId", "slipNumber");
CREATE INDEX IF NOT EXISTS "site_material_slips_projectId_slipDate_idx" ON "site_material_slips"("projectId", "slipDate");
CREATE INDEX IF NOT EXISTS "site_material_slips_projectId_takenById_status_idx" ON "site_material_slips"("projectId", "takenById", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "site_material_slip_lines_slipId_inventoryItemId_key" ON "site_material_slip_lines"("slipId", "inventoryItemId");

ALTER TABLE "site_material_slips" ADD CONSTRAINT "site_material_slips_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "site_material_slips" ADD CONSTRAINT "site_material_slips_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "site_material_slip_lines" ADD CONSTRAINT "site_material_slip_lines_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "site_material_slips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_material_slip_lines" ADD CONSTRAINT "site_material_slip_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One open slip per person per day, enforced by the database (a double-tap cannot create two).
-- Partial index: closed slips of the same day are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "site_material_slips_one_open_per_person_day" ON "site_material_slips"("projectId", "takenById", "slipDate") WHERE "status" = 'OPEN';
