-- Add per-item GST rate to quotation items
ALTER TABLE "quotation_items" ADD COLUMN "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Add per-item GST rate to PO items
ALTER TABLE "po_items" ADD COLUMN "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Add CGST/SGST/IGST split to vendor invoices (invoice-level tax breakdown)
ALTER TABLE "vendor_invoices" ADD COLUMN "cgstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_invoices" ADD COLUMN "sgstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_invoices" ADD COLUMN "igstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
