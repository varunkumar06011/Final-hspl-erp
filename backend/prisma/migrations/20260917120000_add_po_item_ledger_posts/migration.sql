-- POItemLedgerPost: item-wise ledger posting for PO items.
-- Each row links a PO item to the journal voucher that posted it to a chosen
-- ledger, so an item's remaining unposted amount is always derivable.
CREATE TABLE "po_item_ledger_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poItemId" UUID NOT NULL,
    "journalVoucherId" UUID NOT NULL,
    "ledgerId" UUID NOT NULL,
    "taxableAmount" DECIMAL(15,2) NOT NULL,
    "gstAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_item_ledger_posts_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "po_item_ledger_posts_poItemId_idx" ON "po_item_ledger_posts"("poItemId");
CREATE INDEX "po_item_ledger_posts_journalVoucherId_idx" ON "po_item_ledger_posts"("journalVoucherId");
CREATE INDEX "po_item_ledger_posts_ledgerId_idx" ON "po_item_ledger_posts"("ledgerId");

-- Foreign keys
ALTER TABLE "po_item_ledger_posts"
  ADD CONSTRAINT "po_item_ledger_posts_poItemId_fkey"
  FOREIGN KEY ("poItemId") REFERENCES "po_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_item_ledger_posts"
  ADD CONSTRAINT "po_item_ledger_posts_journalVoucherId_fkey"
  FOREIGN KEY ("journalVoucherId") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_item_ledger_posts"
  ADD CONSTRAINT "po_item_ledger_posts_ledgerId_fkey"
  FOREIGN KEY ("ledgerId") REFERENCES "ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "po_item_ledger_posts"
  ADD CONSTRAINT "po_item_ledger_posts_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
