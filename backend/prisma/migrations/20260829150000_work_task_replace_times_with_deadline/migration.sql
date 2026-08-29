-- Work tasks: replace start/end time with optional deadline date
ALTER TABLE "work_tasks" ADD COLUMN IF NOT EXISTS "deadlineDate" TIMESTAMP(3);
ALTER TABLE "work_tasks" DROP COLUMN IF EXISTS "startTime";
ALTER TABLE "work_tasks" DROP COLUMN IF EXISTS "endTime";
