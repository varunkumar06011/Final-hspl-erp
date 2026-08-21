-- Make invoiceId nullable on gate_passes (gate pass can be created from PO alone, invoice is optional)
ALTER TABLE "gate_passes" ALTER COLUMN "invoiceId" DROP NOT NULL;
