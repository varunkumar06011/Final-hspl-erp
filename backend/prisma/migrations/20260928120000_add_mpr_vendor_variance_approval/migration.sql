-- Vendor / Non-Vendor split, MPR → Quotation linkage, and MPR approval workflow.

-- Vendors: VENDOR (recurring, goes through Quotation → PO) vs NON_VENDOR
-- (one-time, skips Quotation entirely).
ALTER TABLE "vendors" ADD COLUMN "vendorType" TEXT NOT NULL DEFAULT 'VENDOR';
CREATE INDEX "vendors_projectId_vendorType_idx" ON "vendors"("projectId", "vendorType");

-- Quotations: link back to the MPR they were raised in response to, so the
-- requested-vs-quoted quantity/amount variance can be computed.
ALTER TABLE "quotations" ADD COLUMN "mprId" UUID;
CREATE INDEX "quotations_mprId_idx" ON "quotations"("mprId");
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_mprId_fkey"
  FOREIGN KEY ("mprId") REFERENCES "material_purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Material Purchase Requests: which vendor the request is raised against,
-- its approval workflow, and (for NON_VENDOR requests, which skip the
-- Quotation module) an uploaded receipt/bill used to close it directly.
ALTER TABLE "material_purchase_requests" ADD COLUMN "vendorId" UUID;
ALTER TABLE "material_purchase_requests" ADD COLUMN "approvalWorkflowId" UUID;
ALTER TABLE "material_purchase_requests" ADD COLUMN "receiptFilePath" TEXT;
ALTER TABLE "material_purchase_requests" ADD COLUMN "receiptFileName" TEXT;
ALTER TABLE "material_purchase_requests" ADD COLUMN "receiptFileMimeType" TEXT;

CREATE UNIQUE INDEX "material_purchase_requests_approvalWorkflowId_key" ON "material_purchase_requests"("approvalWorkflowId");
CREATE INDEX "material_purchase_requests_vendorId_idx" ON "material_purchase_requests"("vendorId");

ALTER TABLE "material_purchase_requests"
  ADD CONSTRAINT "material_purchase_requests_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_purchase_requests"
  ADD CONSTRAINT "material_purchase_requests_approvalWorkflowId_fkey"
  FOREIGN KEY ("approvalWorkflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
