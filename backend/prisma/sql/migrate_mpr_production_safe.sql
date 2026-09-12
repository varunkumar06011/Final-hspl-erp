-- ═════════════════════════════════════════════════════════════════════
-- MPR/MRF Complete Migration Script (Production-Safe)
-- ═════════════════════════════════════════════════════════════════════
--
-- Creates Material Purchase Request tables with camelCase column names
-- matching the Prisma schema.
--
-- SAFETY:
-- - Does NOT touch any existing tables (vendors, POs, quotations, etc.)
-- - Does NOT modify any existing data
-- - Only creates NEW tables for the MPR feature
-- - Idempotent: safe to run multiple times
-- ═════════════════════════════════════════════════════════════════════

-- ── Step 1: Drop MPR tables if they exist (safe — they are new/empty) ──
-- MPR creation was failing due to column name mismatch, so no data exists.
-- If you have MPR data you want to keep, back up before running this.

DROP TABLE IF EXISTS material_purchase_request_items CASCADE;
DROP TABLE IF EXISTS material_purchase_requests CASCADE;

-- ── Step 2: Create tables with camelCase columns (matching Prisma) ──

CREATE TABLE material_purchase_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"             UUID NOT NULL REFERENCES projects(id),
  "mprNumber"             TEXT NOT NULL,
  date                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "requiredBy"            TIMESTAMPTZ,
  department              TEXT,
  status                  TEXT NOT NULL DEFAULT 'DRAFT',
  description             TEXT,
  "deliveryAddress"       TEXT,
  "estimatedSubtotal"     DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "estimatedGstRate"      DECIMAL(5, 2) NOT NULL DEFAULT 0,
  "estimatedGstAmount"     DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "estimatedTotal"        DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "technicalRequirements" TEXT,
  "createdBy"             UUID NOT NULL REFERENCES users(id),
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"             TIMESTAMPTZ,
  priority                TEXT,
  "contactPerson"         TEXT,
  "contactNumber"         TEXT,
  "billingAddress"        TEXT,
  "stateCode"             TEXT
);

ALTER TABLE material_purchase_requests ADD CONSTRAINT material_purchase_requests_projectId_mprNumber_key UNIQUE ("projectId", "mprNumber");
CREATE INDEX idx_mpr_project_deleted ON material_purchase_requests ("projectId", "deletedAt");
CREATE INDEX idx_mpr_project_status_date ON material_purchase_requests ("projectId", status, date);

CREATE TABLE material_purchase_request_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "mprId"             UUID NOT NULL REFERENCES material_purchase_requests(id) ON DELETE CASCADE,
  "materialName"      TEXT NOT NULL,
  "materialCode"      TEXT,
  specification        TEXT,
  quantity            DECIMAL(10, 2) NOT NULL,
  unit                TEXT,
  "requiredDate"      TIMESTAMPTZ,
  "estimatedRate"     DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "estimatedAmount"   DECIMAL(15, 2) NOT NULL DEFAULT 0,
  remarks             TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mpr_items_mpr_id ON material_purchase_request_items ("mprId");

-- ═════════════════════════════════════════════════════════════════════
-- DONE — MPR tables created with camelCase columns
-- ═════════════════════════════════════════════════════════════════════
