-- Add issue closure fields to issues table.
-- Note: the "status" column already exists from the init migration
-- (default 'OPEN', NOT NULL) and was retained through schema syncs,
-- so we only add the closure tracking columns here.
-- Idempotent: safe to re-run if partially applied.

ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closedBy" UUID;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closurePhotoUrl" TEXT;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "closureNotes" TEXT;

-- Add foreign key for closedBy -> users.id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_closedBy_fkey') THEN
    ALTER TABLE "issues" ADD CONSTRAINT "issues_closedBy_fkey"
      FOREIGN KEY ("closedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "issues_status_idx" ON "issues"("status");
