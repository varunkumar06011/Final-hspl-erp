-- Records when each user accepted the Terms & Conditions / Privacy Policy.
-- NULL for existing users forces them to re-authenticate and consent.
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
