-- Per-user module access overrides (Module Access page, Admin 1 / Admin 2 only).
-- Additive: one nullable column, no data changed. NULL = every module on its role default.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moduleAccess" JSONB;
