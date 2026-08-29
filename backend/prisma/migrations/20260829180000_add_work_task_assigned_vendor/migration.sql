-- Add assignedVendorId to work_tasks so a vendor can be assigned to a work
-- item before a quotation is raised. Idempotent: safe to re-run.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'work_tasks' AND column_name = 'assignedVendorId') THEN
    ALTER TABLE "work_tasks" ADD COLUMN "assignedVendorId" UUID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_tasks_assignedVendorId_fkey') THEN
    ALTER TABLE "work_tasks"
      ADD CONSTRAINT "work_tasks_assignedVendorId_fkey"
      FOREIGN KEY ("assignedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
