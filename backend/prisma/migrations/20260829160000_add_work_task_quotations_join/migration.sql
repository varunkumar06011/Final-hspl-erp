-- Work tab: allow a single work task to generate multiple quotations over time
-- (e.g. re-quote with a different vendor). Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS "work_task_quotations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workTaskId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_task_quotations_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_task_quotations_workTaskId_fkey') THEN
    ALTER TABLE "work_task_quotations"
      ADD CONSTRAINT "work_task_quotations_workTaskId_fkey"
      FOREIGN KEY ("workTaskId") REFERENCES "work_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_task_quotations_quotationId_fkey') THEN
    ALTER TABLE "work_task_quotations"
      ADD CONSTRAINT "work_task_quotations_quotationId_fkey"
      FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_task_quotations_createdBy_fkey') THEN
    ALTER TABLE "work_task_quotations"
      ADD CONSTRAINT "work_task_quotations_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Unique constraint — one quotation linked to a work task at most once
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_task_quotations_workTaskId_quotationId_key') THEN
    ALTER TABLE "work_task_quotations"
      ADD CONSTRAINT "work_task_quotations_workTaskId_quotationId_key" UNIQUE ("workTaskId", "quotationId");
  END IF;
END $$;

-- Index for reverse lookups (quotation -> work tasks)
CREATE INDEX IF NOT EXISTS "work_task_quotations_quotationId_idx" ON "work_task_quotations"("quotationId");
