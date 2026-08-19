-- Four free, synchronous Spanish-language gatherings. Access is granted by
-- Beacon Account inside the app; there is no registration or commerce step.
ALTER TABLE "scheduled_sessions"
    ADD COLUMN "public_access" BOOLEAN NOT NULL DEFAULT false;

WITH facilitator_source AS (
    SELECT "facilitator_id"
    FROM "scheduled_sessions"
    WHERE "is_test" = false
    ORDER BY "scheduled_at" DESC
    LIMIT 1
), cycle_sessions (
    "id", "title", "room_name", "scheduled_at"
) AS (
    VALUES
        ('50000000-0000-4000-8000-202608220001'::uuid, 'Del otro lado del umbral — Encuentro 1 de 4', 'umbral-2026-08-22-es', '2026-08-22 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202608290001'::uuid, 'Del otro lado del umbral — Encuentro 2 de 4', 'umbral-2026-08-29-es', '2026-08-29 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609050001'::uuid, 'Del otro lado del umbral — Encuentro 3 de 4', 'umbral-2026-09-05-es', '2026-09-05 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, 'Del otro lado del umbral — Encuentro 4 de 4', 'umbral-2026-09-12-es', '2026-09-12 16:00:00'::timestamp)
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
    facilitator_source."facilitator_id",
    CURRENT_TIMESTAMP
FROM cycle_sessions
CROSS JOIN facilitator_source;

DO $$
DECLARE
    source_count integer;
    target_count integer;
BEGIN
    SELECT count(*) INTO source_count
    FROM (
        SELECT "facilitator_id"
        FROM "scheduled_sessions"
        WHERE "is_test" = false
          AND "id" NOT IN (
              '50000000-0000-4000-8000-202608220001'::uuid,
              '50000000-0000-4000-8000-202608290001'::uuid,
              '50000000-0000-4000-8000-202609050001'::uuid,
              '50000000-0000-4000-8000-202609120001'::uuid
          )
        LIMIT 1
    ) AS source;

    SELECT count(*) INTO target_count
    FROM "scheduled_sessions"
    WHERE "id" IN (
        '50000000-0000-4000-8000-202608220001'::uuid,
        '50000000-0000-4000-8000-202608290001'::uuid,
        '50000000-0000-4000-8000-202609050001'::uuid,
        '50000000-0000-4000-8000-202609120001'::uuid
    )
      AND "public_access" = true
      AND "is_test" = false
      AND "language" = 'SPANISH'::"SessionLanguage";

    IF target_count <> source_count * 4 THEN
        RAISE EXCEPTION 'Four-Saturday public cycle could not be created safely';
    END IF;
END $$;
