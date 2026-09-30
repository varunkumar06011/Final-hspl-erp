-- Threaded replies + approval decisions recorded as comments. Additive-only.
ALTER TABLE "comments" ADD COLUMN "parentId" UUID;
ALTER TABLE "comments" ADD COLUMN "approvalStepId" UUID;
ALTER TABLE "comments" ADD COLUMN "decision" TEXT;

CREATE UNIQUE INDEX "comments_approvalStepId_key" ON "comments"("approvalStepId");
CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing approve/reject comments become regular comments.
INSERT INTO "comments" ("id","projectId","entityType","entityId","entityLabel","url","authorId","body","mentions","createdAt","approvalStepId","decision")
SELECT gen_random_uuid(), w."projectId",
  CASE w."entityType" WHEN 'VENDOR_INVOICE' THEN 'INVOICE' ELSE w."entityType" END,
  w."entityId",
  COALESCE(po."poNumber", q."quotationNumber", vi."invoiceCode", pr."requestNumber", jv."jvNumber", m."mprNumber"),
  CASE w."entityType"
    WHEN 'QUOTATION' THEN '/quotations' WHEN 'PURCHASE_ORDER' THEN '/pos'
    WHEN 'VENDOR_INVOICE' THEN '/invoices' WHEN 'PAYMENT_REQUEST' THEN '/payments'
    WHEN 'JOURNAL_VOUCHER' THEN '/vouchers' WHEN 'MATERIAL_PURCHASE_REQUEST' THEN '/material-purchase-requests'
  END,
  s."approverUserId", s."comments", '[]', COALESCE(s."decidedAt", s."createdAt"), s."id", s."status"
FROM "approval_steps" s
JOIN "approval_workflows" w ON w."id" = s."workflowId"
LEFT JOIN "purchase_orders" po ON po."id" = w."entityId" AND w."entityType" = 'PURCHASE_ORDER'
LEFT JOIN "quotations" q ON q."id" = w."entityId" AND w."entityType" = 'QUOTATION'
LEFT JOIN "vendor_invoices" vi ON vi."id" = w."entityId" AND w."entityType" = 'VENDOR_INVOICE'
LEFT JOIN "payment_requests" pr ON pr."id" = w."entityId" AND w."entityType" = 'PAYMENT_REQUEST'
LEFT JOIN "journal_vouchers" jv ON jv."id" = w."entityId" AND w."entityType" = 'JOURNAL_VOUCHER'
LEFT JOIN "material_purchase_requests" m ON m."id" = w."entityId" AND w."entityType" = 'MATERIAL_PURCHASE_REQUEST'
WHERE s."approverUserId" IS NOT NULL
  AND s."status" IN ('APPROVED','REJECTED')
  AND s."comments" IS NOT NULL AND btrim(s."comments") <> '';
