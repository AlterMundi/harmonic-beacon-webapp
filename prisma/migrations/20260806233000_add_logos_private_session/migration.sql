-- LOGOS is a private, free Ticket Tailor event whose attendees still require
-- a normal Beacon entitlement. Create a fresh production session; do not
-- reuse the historical internal Testing row or any public-event access.
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
    '40000000-0000-4000-8000-202608070001'::uuid,
    'Harmonic Myth Projection — LOGOS — 7 de agosto',
    'Sesión virtual privada en español · 16:00 Costa Rica',
    'hmp-logos-2026-08-07-es',
    'SPANISH'::"SessionLanguage",
    '2026-08-07 22:00:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    150,
    6,
    "facilitator_id",
    CURRENT_TIMESTAMP
FROM "scheduled_sessions"
WHERE "id" = '20000000-0000-4000-8000-202608080001'::uuid;

DO $$
DECLARE
    source_count integer;
    target_count integer;
BEGIN
    SELECT count(*) INTO source_count
    FROM "scheduled_sessions"
    WHERE "id" = '20000000-0000-4000-8000-202608080001'::uuid;

    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE
        "id" = '40000000-0000-4000-8000-202608070001'::uuid
        AND "status" = 'SCHEDULED'::"ScheduledSessionStatus"
        AND "scheduled_at" = '2026-08-07 22:00:00'::timestamp
        AND "is_test" = false
        AND "paid_mode" = true
        AND "attendee_cap" = 150;

    IF source_count NOT IN (0, 1) THEN
        RAISE EXCEPTION 'LOGOS facilitator source is ambiguous';
    END IF;
    IF target_count <> source_count THEN
        RAISE EXCEPTION 'LOGOS private session could not be created';
    END IF;
END $$;
