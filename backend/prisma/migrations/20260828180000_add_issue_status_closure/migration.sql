-- Add issue closure fields to issues table.
-- Note: the "status" column already exists from the init migration
-- (default 'OPEN', NOT NULL) and was retained through schema syncs,
-- so we only add the closure tracking columns here.

ALTER TABLE "issues" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "issues" ADD COLUMN "closedBy" UUID;
ALTER TABLE "issues" ADD COLUMN "closurePhotoUrl" TEXT;
ALTER TABLE "issues" ADD COLUMN "closureNotes" TEXT;

-- Add foreign key for closedBy -> users.id
ALTER TABLE "issues" ADD CONSTRAINT "issues_closedBy_fkey"
  FOREIGN KEY ("closedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "issues_status_idx" ON "issues"("status");
