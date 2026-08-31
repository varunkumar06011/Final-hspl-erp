-- Add followUpBy to work_tasks for free-text follow-up person/notes. Idempotent: safe to re-run.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'work_tasks' AND column_name = 'followUpBy') THEN
    ALTER TABLE "work_tasks" ADD COLUMN "followUpBy" TEXT;
  END IF;
END $$;
