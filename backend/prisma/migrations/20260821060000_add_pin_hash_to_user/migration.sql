-- Add pinHash column to users for PIN-based authentication
ALTER TABLE "users" ADD COLUMN "pinHash" TEXT;
