-- Fresh paid English session for 2026-08-11. The August 8 row remains
-- historical and supplies only the already-reviewed facilitator assignment.
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
    '20000000-0000-4000-8000-202608110001'::uuid,
    'Harmonic Myth Projection — English — August 11',
    'Virtual English session · 16:00 Costa Rica',
    'hmp-2026-08-11-en',
    'ENGLISH'::"SessionLanguage",
    '2026-08-11 22:00:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    150,
    6,
    "facilitator_id",
    CURRENT_TIMESTAMP
FROM "scheduled_sessions"
WHERE "id" = '20000000-0000-4000-8000-202608080002'::uuid;

DO $$
DECLARE
    source_count integer;
    target_count integer;
BEGIN
    SELECT count(*) INTO source_count
    FROM "scheduled_sessions"
    WHERE "id" = '20000000-0000-4000-8000-202608080002'::uuid;

    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE "id" = '20000000-0000-4000-8000-202608110001'::uuid;

    IF source_count NOT IN (0, 1) THEN
        RAISE EXCEPTION 'August 11 English session source is ambiguous';
    END IF;
    IF target_count <> source_count THEN
        RAISE EXCEPTION 'August 11 English production session could not be created';
    END IF;
END $$;
