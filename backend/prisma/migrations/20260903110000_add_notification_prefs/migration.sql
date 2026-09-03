-- Per-user push notification preferences (JSON map of event type → boolean)
ALTER TABLE "users" ADD COLUMN "notificationPrefs" JSONB;
