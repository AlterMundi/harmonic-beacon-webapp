ALTER TABLE "scheduled_sessions" ADD COLUMN "is_published" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "scheduled_sessions" ADD COLUMN "checkout_url" TEXT;
ALTER TABLE "scheduled_sessions" ADD COLUMN "event_time_zone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
