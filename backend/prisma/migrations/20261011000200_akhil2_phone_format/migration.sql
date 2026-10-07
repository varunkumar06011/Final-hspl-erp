-- The login page sends phone numbers as +91XXXXXXXXXX; store Akhil2's the same way.
-- Only touches the one row created by 20261011000100_akhil2_super_admin.
UPDATE "users"
SET "phone" = '+919999999999', "updatedAt" = now()
WHERE "phone" = '9999999999'
  AND "firebaseUid" = 'pin-superadmin-akhil2'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "phone" = '+919999999999');
