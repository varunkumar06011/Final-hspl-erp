-- Locked documents: a 6-digit document PIN per user and a lock flag per document.
-- Additive only (two nullable / defaulted columns); nothing is dropped or rewritten.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentPinHash" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "isLocked" BOOLEAN NOT NULL DEFAULT false;
