-- Work calendar module: scheduled/assigned work tasks (sits before quotations)
-- Idempotent: safe to re-run if partially applied.
CREATE TABLE IF NOT EXISTS "work_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "assignedTo" UUID,
    "linkedQuotationId" UUID,
    "linkedPoId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_projectId_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_createdBy_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_assignedTo_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_assignedTo_fkey"
      FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_linkedQuotationId_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_linkedQuotationId_fkey"
      FOREIGN KEY ("linkedQuotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_linkedPoId_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_linkedPoId_fkey"
      FOREIGN KEY ("linkedPoId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "work_tasks_projectId_scheduledDate_idx" ON "work_tasks"("projectId", "scheduledDate");
CREATE INDEX IF NOT EXISTS "work_tasks_status_idx" ON "work_tasks"("status");
