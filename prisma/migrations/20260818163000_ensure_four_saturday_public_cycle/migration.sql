-- Ensure the public cycle exists even when the deterministic fixture has no
-- prior production session to use as its facilitator source. A completely
-- empty schema remains migratable; any initialized installation must resolve
-- one active facilitator and finish with all four reviewed sessions.
WITH facilitator_source AS (
    SELECT candidate."id"
    FROM (
        SELECT
            "facilitator_id" AS "id",
            0 AS "priority",
            "scheduled_at" AS "sort_at"
        FROM "scheduled_sessions"
        WHERE "is_test" = false
          AND "id" NOT IN (
              '50000000-0000-4000-8000-202608220001'::uuid,
              '50000000-0000-4000-8000-202608290001'::uuid,
              '50000000-0000-4000-8000-202609050001'::uuid,
              '50000000-0000-4000-8000-202609120001'::uuid
          )
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
), cycle_sessions (
    "id", "title", "room_name", "scheduled_at"
) AS (
    VALUES
        ('50000000-0000-4000-8000-202608220001'::uuid, 'Del otro lado del umbral — Encuentro 1 de 4', 'umbral-2026-08-22-es', '2026-08-22 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202608290001'::uuid, 'Del otro lado del umbral — Encuentro 2 de 4', 'umbral-2026-08-29-es', '2026-08-29 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609050001'::uuid, 'Del otro lado del umbral — Encuentro 3 de 4', 'umbral-2026-09-05-es', '2026-09-05 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, 'Del otro lado del umbral — Encuentro 4 de 4', 'umbral-2026-09-12-es', '2026-09-12 14:00:00'::timestamp)
)
INSERT INTO "scheduled_sessions" (
    "id", "title", "description", "room_name", "language", "scheduled_at",
    "status", "is_test", "paid_mode", "public_access", "attendee_cap",
    "max_publishers", "facilitator_id", "updated_at"
)
SELECT
    cycle_sessions."id",
    cycle_sessions."title",
    'Ciclo gratuito en castellano · cuerpo, sonido y símbolo · virtual y sincrónico · 3–4 horas',
    cycle_sessions."room_name",
    'SPANISH'::"SessionLanguage",
    cycle_sessions."scheduled_at",
    'SCHEDULED'::"ScheduledSessionStatus",
    false,
    true,
    true,
    150,
    6,
    facilitator_source."id",
    CURRENT_TIMESTAMP
FROM cycle_sessions
CROSS JOIN facilitator_source
ON CONFLICT ("id") DO UPDATE SET
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "room_name" = EXCLUDED."room_name",
    "language" = EXCLUDED."language",
    "scheduled_at" = EXCLUDED."scheduled_at",
    "status" = EXCLUDED."status",
    "started_at" = NULL,
    "ended_at" = NULL,
    "is_test" = EXCLUDED."is_test",
    "paid_mode" = EXCLUDED."paid_mode",
    "public_access" = EXCLUDED."public_access",
    "attendee_cap" = EXCLUDED."attendee_cap",
    "max_publishers" = EXCLUDED."max_publishers",
    "facilitator_id" = EXCLUDED."facilitator_id",
    "updated_at" = CURRENT_TIMESTAMP;

DO $$
DECLARE
    initialized_count integer;
    facilitator_count integer;
    target_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO facilitator_count
    FROM "users"
    WHERE "disabled_at" IS NULL
      AND "role" IN ('FACILITATOR'::"StaffRole", 'FACILITATOR_OP'::"StaffRole");

    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE ("id", "title", "room_name", "scheduled_at") IN (
        ('50000000-0000-4000-8000-202608220001'::uuid, 'Del otro lado del umbral — Encuentro 1 de 4', 'umbral-2026-08-22-es', '2026-08-22 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202608290001'::uuid, 'Del otro lado del umbral — Encuentro 2 de 4', 'umbral-2026-08-29-es', '2026-08-29 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609050001'::uuid, 'Del otro lado del umbral — Encuentro 3 de 4', 'umbral-2026-09-05-es', '2026-09-05 14:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, 'Del otro lado del umbral — Encuentro 4 de 4', 'umbral-2026-09-12-es', '2026-09-12 14:00:00'::timestamp)
    )
      AND "language" = 'SPANISH'::"SessionLanguage"
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus"
      AND "is_test" = false
      AND "paid_mode" = true
      AND "public_access" = true
      AND "attendee_cap" = 150
      AND "max_publishers" = 6;

    IF initialized_count = 0 THEN
        IF target_count <> 0 THEN
            RAISE EXCEPTION 'Empty installation contains a partial four-Saturday public cycle';
        END IF;
    ELSIF facilitator_count = 0 THEN
        RAISE EXCEPTION 'Four-Saturday public cycle requires an active facilitator';
    ELSIF target_count <> 4 THEN
        RAISE EXCEPTION 'Four-Saturday public cycle must contain exactly four reviewed sessions';
    END IF;
END $$;
