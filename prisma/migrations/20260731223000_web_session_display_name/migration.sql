-- A participant-chosen room label belongs to the browser session, not to the
-- ticket entitlement or email identity. Existing sessions keep the safe
-- "Attendee" fallback until their holder signs in again.
ALTER TABLE "web_sessions" ADD COLUMN "display_name" TEXT;

ALTER TABLE "web_sessions"
ADD CONSTRAINT "web_sessions_display_name_length"
CHECK (
    "display_name" IS NULL
    OR char_length("display_name") BETWEEN 1 AND 60
);
