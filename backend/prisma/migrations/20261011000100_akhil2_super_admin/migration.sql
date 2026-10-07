-- Super admin login "Akhil2" (phone + PIN login). Additive: inserts one user, deletes nothing.
-- Role ADMIN gives every admin gate; '*' in extraPermissions grants every permission,
-- including APPROVAL_OVERRIDE (every override is audit-logged as a super admin override).
-- The PIN is stored only as a bcrypt hash. Applied by `prisma migrate deploy`.
INSERT INTO "User" (
  "id", "firebaseUid", "phone", "name", "role", "projectId", "isActive",
  "pinHash", "termsAcceptedAt", "extraPermissions", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  'pin-superadmin-akhil2',
  '9999999999',
  'Akhil2',
  'ADMIN',
  (SELECT "projectId" FROM "User" WHERE "role" = 'SUPERVISOR' AND "name" ILIKE '%akhil%' AND "name" NOT ILIKE '%akhil2%' LIMIT 1),
  true,
  '$2b$10$EAC3LuwIBhOwQrNZiDj49eWasoKIsxcoJ.VKKpaa/jR7z3bWRtXQe',
  now(),
  ARRAY['*']::text[],
  now(),
  now()
)
ON CONFLICT ("phone") DO UPDATE SET
  "name" = 'Akhil2',
  "role" = 'ADMIN',
  "isActive" = true,
  "pinHash" = EXCLUDED."pinHash",
  "extraPermissions" = ARRAY['*']::text[],
  "updatedAt" = now();
