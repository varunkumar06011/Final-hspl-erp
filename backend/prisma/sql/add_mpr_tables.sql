-- Add Material Purchase Request (MPR) tables
-- Only adds new tables — does NOT modify any existing tables or data.

CREATE TABLE IF NOT EXISTS material_purchase_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID NOT NULL REFERENCES projects(id),
  mpr_number              TEXT NOT NULL,
  date                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  required_by             TIMESTAMPTZ,
  department              TEXT,
  status                  TEXT NOT NULL DEFAULT 'DRAFT',
  description             TEXT,
  delivery_address        TEXT,
  estimated_subtotal      DECIMAL(15, 2) NOT NULL DEFAULT 0,
  estimated_gst_rate      DECIMAL(5, 2) NOT NULL DEFAULT 0,
  estimated_gst_amount    DECIMAL(15, 2) NOT NULL DEFAULT 0,
  estimated_total         DECIMAL(15, 2) NOT NULL DEFAULT 0,
  technical_requirements  TEXT,
  created_by              UUID NOT NULL REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,
  UNIQUE (project_id, mpr_number)
);

CREATE INDEX IF NOT EXISTS idx_mpr_project_deleted ON material_purchase_requests (project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_mpr_project_status_date ON material_purchase_requests (project_id, status, date);

CREATE TABLE IF NOT EXISTS material_purchase_request_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mpr_id              UUID NOT NULL REFERENCES material_purchase_requests(id) ON DELETE CASCADE,
  material_name       TEXT NOT NULL,
  specification       TEXT,
  quantity            DECIMAL(10, 2) NOT NULL,
  unit                TEXT,
  estimated_rate      DECIMAL(15, 2) NOT NULL DEFAULT 0,
  estimated_amount    DECIMAL(15, 2) NOT NULL DEFAULT 0,
  remarks             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mpr_items_mpr_id ON material_purchase_request_items (mpr_id);
