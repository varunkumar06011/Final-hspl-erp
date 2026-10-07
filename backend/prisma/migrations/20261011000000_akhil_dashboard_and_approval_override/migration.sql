-- Akhil (Supervisor): dashboard access + approval override.
-- Additive data change only: no schema change, no row deleted. Applied by `prisma migrate deploy`.
--
-- APPROVAL_OVERRIDE lets him approve/reject any pending approval step. Every use is
-- recorded in the audit log and the step comment as "super admin override".
UPDATE "User"
SET "extraPermissions" = ARRAY(
  SELECT DISTINCT p
  FROM unnest(COALESCE("extraPermissions", ARRAY[]::text[]) || ARRAY['VIEW_DASHBOARD', 'APPROVAL_OVERRIDE']) AS p
)
WHERE "role" = 'SUPERVISOR'
  AND "name" ILIKE '%akhil%'
  AND "name" NOT ILIKE '%akhil2%';
