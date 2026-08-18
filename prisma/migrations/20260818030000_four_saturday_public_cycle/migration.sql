-- Four free, synchronous Spanish-language gatherings. These are new rooms;
-- historical events are never repurposed.
WITH facilitator_source AS (
    SELECT "id" AS "facilitator_id"
    FROM "users"
    WHERE "disabled_at" IS NULL
      AND "role" IN (
          'FACILITATOR'::"StaffRole",
          'FACILITATOR_OP'::"StaffRole"
      )
    ORDER BY
        CASE WHEN "role" = 'FACILITATOR'::"StaffRole" THEN 0 ELSE 1 END,
        "created_at" ASC
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
    "status", "is_test", "paid_mode", "attendee_cap", "max_publishers",
    "facilitator_id", "updated_at"
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
    150,
    6,
    facilitator_source."facilitator_id",
    CURRENT_TIMESTAMP
FROM cycle_sessions
CROSS JOIN facilitator_source;

DO $$
DECLARE
    target_count integer;
BEGIN
    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE "id" IN (
        '50000000-0000-4000-8000-202608220001'::uuid,
        '50000000-0000-4000-8000-202608290001'::uuid,
        '50000000-0000-4000-8000-202609050001'::uuid,
        '50000000-0000-4000-8000-202609120001'::uuid
    )
      AND "is_test" = false
      AND "language" = 'SPANISH'::"SessionLanguage"
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus";

    IF target_count <> 4 THEN
        RAISE EXCEPTION 'Four-Saturday public cycle could not be created safely';
    END IF;
END $$;
