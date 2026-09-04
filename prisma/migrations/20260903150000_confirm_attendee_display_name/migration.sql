-- A room alias is explicitly confirmed before an attendee mounts LiveKit.
-- Existing sessions remain unconfirmed so their next entry repairs any
-- historical generic alias instead of silently carrying it forward.
ALTER TABLE "web_sessions"
ADD COLUMN "display_name_confirmed_at" TIMESTAMP(3);
