-- Rename MPR columns to quoted camelCase to match Prisma model conventions
-- PostgreSQL folds unquoted identifiers to lowercase, so we MUST use quotes.

-- ── material_purchase_requests ──
ALTER TABLE material_purchase_requests RENAME COLUMN projectid TO "projectId";
ALTER TABLE material_purchase_requests RENAME COLUMN mprnumber TO "mprNumber";
ALTER TABLE material_purchase_requests RENAME COLUMN requiredby TO "requiredBy";
ALTER TABLE material_purchase_requests RENAME COLUMN deliveryaddress TO "deliveryAddress";
ALTER TABLE material_purchase_requests RENAME COLUMN estimatedsubtotal TO "estimatedSubtotal";
ALTER TABLE material_purchase_requests RENAME COLUMN estimatedgstrate TO "estimatedGstRate";
ALTER TABLE material_purchase_requests RENAME COLUMN estimatedgstamount TO "estimatedGstAmount";
ALTER TABLE material_purchase_requests RENAME COLUMN estimatedtotal TO "estimatedTotal";
ALTER TABLE material_purchase_requests RENAME COLUMN technicalrequirements TO "technicalRequirements";
ALTER TABLE material_purchase_requests RENAME COLUMN createdby TO "createdBy";
ALTER TABLE material_purchase_requests RENAME COLUMN createdat TO "createdAt";
ALTER TABLE material_purchase_requests RENAME COLUMN updatedat TO "updatedAt";
ALTER TABLE material_purchase_requests RENAME COLUMN deletedat TO "deletedAt";
ALTER TABLE material_purchase_requests RENAME COLUMN contactperson TO "contactPerson";
ALTER TABLE material_purchase_requests RENAME COLUMN contactnumber TO "contactNumber";
ALTER TABLE material_purchase_requests RENAME COLUMN billingaddress TO "billingAddress";
ALTER TABLE material_purchase_requests RENAME COLUMN statecode TO "stateCode";

-- Drop old lowercase unique constraint and indexes, recreate with camelCase
ALTER TABLE material_purchase_requests DROP CONSTRAINT IF EXISTS material_purchase_requests_projectid_mprnumber_key;
ALTER TABLE material_purchase_requests DROP CONSTRAINT IF EXISTS material_purchase_requests_project_id_mpr_number_key;
ALTER TABLE material_purchase_requests ADD CONSTRAINT material_purchase_requests_projectId_mprNumber_key UNIQUE ("projectId", "mprNumber");

DROP INDEX IF EXISTS idx_mpr_project_deleted;
CREATE INDEX idx_mpr_project_deleted ON material_purchase_requests ("projectId", "deletedAt");

DROP INDEX IF EXISTS idx_mpr_project_status_date;
CREATE INDEX idx_mpr_project_status_date ON material_purchase_requests ("projectId", status, date);

-- ── material_purchase_request_items ──
ALTER TABLE material_purchase_request_items RENAME COLUMN mprid TO "mprId";
ALTER TABLE material_purchase_request_items RENAME COLUMN materialname TO "materialName";
ALTER TABLE material_purchase_request_items RENAME COLUMN estimatedrate TO "estimatedRate";
ALTER TABLE material_purchase_request_items RENAME COLUMN estimatedamount TO "estimatedAmount";
ALTER TABLE material_purchase_request_items RENAME COLUMN createdat TO "createdAt";
ALTER TABLE material_purchase_request_items RENAME COLUMN materialcode TO "materialCode";
ALTER TABLE material_purchase_request_items RENAME COLUMN requireddate TO "requiredDate";

DROP INDEX IF EXISTS idx_mpr_items_mpr_id;
CREATE INDEX idx_mpr_items_mpr_id ON material_purchase_request_items ("mprId");
