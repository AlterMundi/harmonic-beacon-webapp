-- New paid sessions for 2026-08-08. The August 2 production rows retain
-- participants, grants and web sessions, so they must remain historical.
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
    '20000000-0000-4000-8000-202608080001'::uuid,
    'Harmonic Myth Projection — Español — 8 de agosto',
    'Sesión virtual en español · 08:30 Costa Rica',
    'hmp-2026-08-08-es',
    'SPANISH'::"SessionLanguage",
    '2026-08-08 14:30:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    150,
    6,
    COALESCE(
        (
            SELECT "facilitator_id"
            FROM "scheduled_sessions"
            WHERE "id" = '10000000-0000-4000-8000-000000000001'::uuid
        ),
        (
            SELECT "facilitator_id"
            FROM "scheduled_sessions"
            WHERE "language" = 'SPANISH'::"SessionLanguage"
            ORDER BY "is_test" ASC, "scheduled_at" DESC
            LIMIT 1
        ),
        (
            SELECT "id"
            FROM "users"
            WHERE "role" = 'FACILITATOR'::"StaffRole" AND "disabled_at" IS NULL
            ORDER BY "created_at" ASC
            LIMIT 1
        )
    ),
    CURRENT_TIMESTAMP;

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
    '20000000-0000-4000-8000-202608080002'::uuid,
    'Harmonic Myth Projection — English — August 8',
    'Virtual English session · 14:00 Costa Rica',
    'hmp-2026-08-08-en',
    'ENGLISH'::"SessionLanguage",
    '2026-08-08 20:00:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    150,
    6,
    COALESCE(
        (
            SELECT "facilitator_id"
            FROM "scheduled_sessions"
            WHERE "id" = '10000000-0000-4000-8000-000000000002'::uuid
        ),
        (
            SELECT "facilitator_id"
            FROM "scheduled_sessions"
            WHERE "language" = 'ENGLISH'::"SessionLanguage"
            ORDER BY "is_test" ASC, "scheduled_at" DESC
            LIMIT 1
        ),
        (
            SELECT "id"
            FROM "users"
            WHERE "role" = 'FACILITATOR'::"StaffRole" AND "disabled_at" IS NULL
            ORDER BY "created_at" ASC
            LIMIT 1
        )
    ),
    CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF (
        SELECT count(*)
        FROM "scheduled_sessions"
        WHERE "id" IN (
            '20000000-0000-4000-8000-202608080001'::uuid,
            '20000000-0000-4000-8000-202608080002'::uuid
        )
    ) <> 2 THEN
        RAISE EXCEPTION 'August 8 production sessions could not be created';
    END IF;
END $$;
