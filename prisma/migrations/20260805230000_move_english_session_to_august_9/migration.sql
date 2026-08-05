-- Direction corrected the English event date from Tuesday 2026-08-11 to
-- Sunday 2026-08-09. Keep the mistaken row as cancelled audit history and
-- create a fresh paid session so no access or smoke state is reused.
UPDATE "scheduled_sessions"
SET
    "status" = 'CANCELLED'::"ScheduledSessionStatus",
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = '20000000-0000-4000-8000-202608110001'::uuid;

INSERT INTO "scheduled_sessions" (
    "id",
    "title",
    "description",
    "room_name",
    "language",
    "scheduled_at",
    "status",
    "is_test",
    "paid_mode",
    "attendee_cap",
    "max_publishers",
    "facilitator_id",
    "updated_at"
)
SELECT
    '20000000-0000-4000-8000-202608090001'::uuid,
    'Harmonic Myth Projection — English — August 9',
    'Virtual English session · 16:00 Costa Rica',
    'hmp-2026-08-09-en',
    'ENGLISH'::"SessionLanguage",
    '2026-08-09 22:00:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    150,
    6,
    "facilitator_id",
    CURRENT_TIMESTAMP
FROM "scheduled_sessions"
WHERE "id" = '20000000-0000-4000-8000-202608110001'::uuid;

DO $$
DECLARE
    old_count integer;
    new_count integer;
BEGIN
    SELECT count(*) INTO old_count
    FROM "scheduled_sessions"
    WHERE
        "id" = '20000000-0000-4000-8000-202608110001'::uuid
        AND "status" = 'CANCELLED'::"ScheduledSessionStatus";

    SELECT count(*) INTO new_count
    FROM "scheduled_sessions"
    WHERE
        "id" = '20000000-0000-4000-8000-202608090001'::uuid
        AND "status" = 'SCHEDULED'::"ScheduledSessionStatus"
        AND "scheduled_at" = '2026-08-09 22:00:00'::timestamp;

    IF old_count <> 1 THEN
        RAISE EXCEPTION 'Incorrect August 11 English session was not cancelled';
    END IF;
    IF new_count <> 1 THEN
        RAISE EXCEPTION 'Correct August 9 English session was not created';
    END IF;
END $$;
