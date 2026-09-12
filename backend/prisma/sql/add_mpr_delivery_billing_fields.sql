-- Add Delivery & Billing Information columns to MPR table
-- Only ADDS nullable columns — no data loss, no existing columns modified.

ALTER TABLE material_purchase_requests
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS contact_number TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS state_code TEXT;
