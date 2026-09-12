-- Rename MPR columns from snake_case to camelCase to match Prisma model conventions
-- Only renames columns in MPR tables — does NOT touch any other tables.

-- ── material_purchase_requests ──
ALTER TABLE material_purchase_requests RENAME COLUMN project_id TO projectId;
ALTER TABLE material_purchase_requests RENAME COLUMN mpr_number TO mprNumber;
ALTER TABLE material_purchase_requests RENAME COLUMN required_by TO requiredBy;
ALTER TABLE material_purchase_requests RENAME COLUMN delivery_address TO deliveryAddress;
ALTER TABLE material_purchase_requests RENAME COLUMN estimated_subtotal TO estimatedSubtotal;
ALTER TABLE material_purchase_requests RENAME COLUMN estimated_gst_rate TO estimatedGstRate;
ALTER TABLE material_purchase_requests RENAME COLUMN estimated_gst_amount TO estimatedGstAmount;
ALTER TABLE material_purchase_requests RENAME COLUMN estimated_total TO estimatedTotal;
ALTER TABLE material_purchase_requests RENAME COLUMN technical_requirements TO technicalRequirements;
ALTER TABLE material_purchase_requests RENAME COLUMN created_by TO createdBy;
ALTER TABLE material_purchase_requests RENAME COLUMN created_at TO createdAt;
ALTER TABLE material_purchase_requests RENAME COLUMN updated_at TO updatedAt;
ALTER TABLE material_purchase_requests RENAME COLUMN deleted_at TO deletedAt;

-- Drop old snake_case unique constraint and indexes, recreate with camelCase
ALTER TABLE material_purchase_requests DROP CONSTRAINT IF EXISTS material_purchase_requests_project_id_mpr_number_key;
ALTER TABLE material_purchase_requests ADD CONSTRAINT material_purchase_requests_projectId_mprNumber_key UNIQUE (projectId, mprNumber);

DROP INDEX IF EXISTS idx_mpr_project_deleted;
CREATE INDEX idx_mpr_project_deleted ON material_purchase_requests (projectId, deletedAt);

DROP INDEX IF EXISTS idx_mpr_project_status_date;
CREATE INDEX idx_mpr_project_status_date ON material_purchase_requests (projectId, status, date);

-- ── material_purchase_request_items ──
ALTER TABLE material_purchase_request_items RENAME COLUMN mpr_id TO mprId;
ALTER TABLE material_purchase_request_items RENAME COLUMN material_name TO materialName;
ALTER TABLE material_purchase_request_items RENAME COLUMN estimated_rate TO estimatedRate;
ALTER TABLE material_purchase_request_items RENAME COLUMN estimated_amount TO estimatedAmount;
ALTER TABLE material_purchase_request_items RENAME COLUMN created_at TO createdAt;

DROP INDEX IF EXISTS idx_mpr_items_mpr_id;
CREATE INDEX idx_mpr_items_mpr_id ON material_purchase_request_items (mprId);
