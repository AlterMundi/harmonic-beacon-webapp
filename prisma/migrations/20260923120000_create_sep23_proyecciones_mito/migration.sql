WITH facilitator_source AS (
    SELECT candidate."id"
    FROM (
        SELECT
            session_facilitator."id",
            0 AS "priority",
            scheduled_session."scheduled_at" AS "sort_at"
        FROM "scheduled_sessions" AS scheduled_session
        JOIN "users" AS session_facilitator
          ON session_facilitator."id" = scheduled_session."facilitator_id"
        WHERE scheduled_session."is_test" = false
          AND scheduled_session."public_access" = true
          AND session_facilitator."disabled_at" IS NULL
          AND session_facilitator."role" IN ('FACILITATOR'::"StaffRole", 'FACILITATOR_OP'::"StaffRole")
        UNION ALL
        SELECT
            "id",
            1 AS "priority",
            "created_at" AS "sort_at"
        FROM "users"
        WHERE "disabled_at" IS NULL
          AND "role" IN ('FACILITATOR'::"StaffRole", 'FACILITATOR_OP'::"StaffRole")
    ) AS candidate
    ORDER BY candidate."priority", candidate."sort_at" DESC
    LIMIT 1
), event_sessions (
    "id", "title", "room_name", "scheduled_at"
) AS (
    VALUES
        ('50000000-0000-4000-8000-202609230001'::uuid, 'Proyecciones Mito — 10:00', 'proyecciones-mito-2026-09-23-1000-art', '2026-09-23 13:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609230002'::uuid, 'Proyecciones Mito — 18:00', 'proyecciones-mito-2026-09-23-1800-art', '2026-09-23 21:00:00'::timestamp)
)
INSERT INTO "scheduled_sessions" (
    "id", "title", "description", "room_name", "language", "scheduled_at",
    "status", "is_test", "paid_mode", "public_access", "attendee_cap",
    "max_publishers", "scene_capacity", "facilitator_id", "updated_at"
)
SELECT
    event_sessions."id",
    event_sessions."title",
    'Encuentro gratuito en castellano · cuerpo, sonido y símbolo · virtual y sincrónico',
    event_sessions."room_name",
    'SPANISH'::"SessionLanguage",
    event_sessions."scheduled_at",
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    true,
    150,
    6,
    6,
    facilitator_source."id",
    CURRENT_TIMESTAMP
FROM event_sessions
CROSS JOIN facilitator_source
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE
    initialized_count integer;
    facilitator_count integer;
    target_count integer;
    related_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO facilitator_count
    FROM "users"
    WHERE "disabled_at" IS NULL
      AND "role" IN ('FACILITATOR'::"StaffRole", 'FACILITATOR_OP'::"StaffRole");

    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE ("id", "title", "room_name", "scheduled_at") IN (
        ('50000000-0000-4000-8000-202609230001'::uuid, 'Proyecciones Mito — 10:00', 'proyecciones-mito-2026-09-23-1000-art', '2026-09-23 13:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609230002'::uuid, 'Proyecciones Mito — 18:00', 'proyecciones-mito-2026-09-23-1800-art', '2026-09-23 21:00:00'::timestamp)
    )
      AND "language" = 'SPANISH'::"SessionLanguage"
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus"
      AND "is_test" = false
      AND "paid_mode" = true
      AND "public_access" = true
      AND "attendee_cap" = 150
      AND "max_publishers" = 6
      AND "scene_capacity" = 6;

    SELECT
        (SELECT count(*) FROM "ticket_entitlements" WHERE "scheduled_session_id" IN (
            '50000000-0000-4000-8000-202609230001'::uuid,
            '50000000-0000-4000-8000-202609230002'::uuid
        ))
        + (SELECT count(*) FROM "session_participants" WHERE "scheduled_session_id" IN (
            '50000000-0000-4000-8000-202609230001'::uuid,
            '50000000-0000-4000-8000-202609230002'::uuid
        ))
        + (SELECT count(*) FROM "session_contributions" WHERE "scheduled_session_id" IN (
            '50000000-0000-4000-8000-202609230001'::uuid,
            '50000000-0000-4000-8000-202609230002'::uuid
        ))
    INTO related_count;

    IF initialized_count = 0 THEN
        IF target_count <> 0 THEN
            RAISE EXCEPTION 'Empty installation contains partial September 23 Proyecciones Mito sessions';
        END IF;
    ELSIF facilitator_count = 0 THEN
        RAISE EXCEPTION 'September 23 Proyecciones Mito sessions require an active facilitator';
    ELSIF target_count <> 2 THEN
        RAISE EXCEPTION 'September 23 Proyecciones Mito sessions could not be created safely';
    ELSIF related_count <> 0 THEN
        RAISE EXCEPTION 'September 23 Proyecciones Mito sessions must start without inherited attendee state';
    END IF;
END $$;
