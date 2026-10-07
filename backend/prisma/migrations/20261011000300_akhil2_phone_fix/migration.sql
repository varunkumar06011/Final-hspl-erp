-- Akhil2's row was recreated by the dev login path with phone 9999999999, so the
-- phone-format migration (which matched on the pin-superadmin UID) changed nothing.
-- Store the phone the login page sends (+91XXXXXXXXXX). Only touches the Akhil2 row,
-- and skips when that phone is already taken.
UPDATE "users"
SET "phone" = '+919999999999', "updatedAt" = now()
WHERE "name" = 'Akhil2'
  AND "phone" = '9999999999'
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "phone" = '+919999999999');
