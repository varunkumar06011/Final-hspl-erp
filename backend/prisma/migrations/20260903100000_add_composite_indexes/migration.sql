-- Composite indexes on hot list-query paths.
-- crudFactory always filters by (projectId, deletedAt) and frequently by status/date.
-- These indexes prevent sequential scans as data grows.

-- Vendors
CREATE INDEX IF NOT EXISTS "vendors_projectId_deletedAt_idx" ON "vendors"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "vendors_projectId_status_idx" ON "vendors"("projectId", "status");

-- Quotations
CREATE INDEX IF NOT EXISTS "quotations_projectId_deletedAt_idx" ON "quotations"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "quotations_projectId_status_date_idx" ON "quotations"("projectId", "status", "date");

-- Purchase Orders
CREATE INDEX IF NOT EXISTS "purchase_orders_projectId_deletedAt_idx" ON "purchase_orders"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "purchase_orders_projectId_status_date_idx" ON "purchase_orders"("projectId", "status", "date");

-- Vendor Invoices
CREATE INDEX IF NOT EXISTS "vendor_invoices_projectId_deletedAt_idx" ON "vendor_invoices"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "vendor_invoices_projectId_paymentStatus_idx" ON "vendor_invoices"("projectId", "paymentStatus");
CREATE INDEX IF NOT EXISTS "vendor_invoices_projectId_date_idx" ON "vendor_invoices"("projectId", "date");

-- Payment Requests
CREATE INDEX IF NOT EXISTS "payment_requests_projectId_deletedAt_idx" ON "payment_requests"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "payment_requests_projectId_status_idx" ON "payment_requests"("projectId", "status");

-- Gate Passes
CREATE INDEX IF NOT EXISTS "gate_passes_projectId_deletedAt_idx" ON "gate_passes"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "gate_passes_projectId_status_date_idx" ON "gate_passes"("projectId", "status", "date");

-- Goods Receipts
CREATE INDEX IF NOT EXISTS "goods_receipts_projectId_deletedAt_idx" ON "goods_receipts"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "goods_receipts_projectId_status_idx" ON "goods_receipts"("projectId", "status");

-- Inventory Items
CREATE INDEX IF NOT EXISTS "inventory_items_projectId_deletedAt_idx" ON "inventory_items"("projectId", "deletedAt");

-- Issues
CREATE INDEX IF NOT EXISTS "issues_projectId_deletedAt_idx" ON "issues"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "issues_projectId_status_projectId_idx" ON "issues"("projectId", "status");

-- Work Tasks
CREATE INDEX IF NOT EXISTS "work_tasks_projectId_deletedAt_idx" ON "work_tasks"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "work_tasks_projectId_status_idx" ON "work_tasks"("projectId", "status");

-- Inspections
CREATE INDEX IF NOT EXISTS "inspections_projectId_deletedAt_idx" ON "inspections"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "inspections_projectId_status_idx" ON "inspections"("projectId", "status");

-- Documents
CREATE INDEX IF NOT EXISTS "documents_projectId_deletedAt_idx" ON "documents"("projectId", "deletedAt");

-- Contracts
CREATE INDEX IF NOT EXISTS "contracts_projectId_deletedAt_idx" ON "contracts"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "contracts_projectId_status_idx" ON "contracts"("projectId", "status");

-- Budget Heads
CREATE INDEX IF NOT EXISTS "budget_heads_projectId_deletedAt_idx" ON "budget_heads"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "budget_heads_projectId_status_idx" ON "budget_heads"("projectId", "status");

-- Journal Vouchers
CREATE INDEX IF NOT EXISTS "journal_vouchers_projectId_deletedAt_idx" ON "journal_vouchers"("projectId", "deletedAt");
CREATE INDEX IF NOT EXISTS "journal_vouchers_projectId_status_idx" ON "journal_vouchers"("projectId", "status");
