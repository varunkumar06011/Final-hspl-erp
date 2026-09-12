-- Add new columns to MPR tables for the professional Material Request Form
-- Only ADDS nullable columns — no data loss, no existing columns modified.

ALTER TABLE material_purchase_requests
  ADD COLUMN IF NOT EXISTS priority TEXT;

ALTER TABLE material_purchase_request_items
  ADD COLUMN IF NOT EXISTS material_code TEXT,
  ADD COLUMN IF NOT EXISTS required_date TIMESTAMPTZ;
