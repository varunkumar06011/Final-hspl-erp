-- Author describes what an edit changed (required on every comment edit from now on).
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "editNote" TEXT;
