-- Akhil (Supervisor): dashboard access + approval override.
-- Additive data change only: no schema change, no row deleted. Applied by `prisma migrate deploy`.
--
-- APPROVAL_OVERRIDE lets him approve/reject any pending approval step. Every use is
-- recorded in the audit log and the step comment as "super admin override".
UPDATE "users"
SET "extraPermissions" = array_cat(
  array_remove(array_remove("extraPermissions", 'VIEW_DASHBOARD'), 'APPROVAL_OVERRIDE'),
  ARRAY['VIEW_DASHBOARD', 'APPROVAL_OVERRIDE']::text[]
)
WHERE "role" = 'SUPERVISOR'
  AND "name" ILIKE '%akhil%'
  AND "name" NOT ILIKE '%akhil2%';
