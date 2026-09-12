-- Add requestRaisedBy column to MPR table (references users)
-- Only ADDS a nullable column — no data loss, no existing columns modified.

ALTER TABLE material_purchase_requests
  ADD COLUMN IF NOT EXISTS "requestRaisedById" UUID REFERENCES users(id);
