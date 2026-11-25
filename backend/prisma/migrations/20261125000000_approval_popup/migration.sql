-- Per-user switch for the approval pop-up. Off by default; on for Project Heads.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvalPopup" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "approvalPopup" = true WHERE "role" = 'PROJECT_HEAD';
