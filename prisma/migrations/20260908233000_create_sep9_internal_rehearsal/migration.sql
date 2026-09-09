-- Dirección requested a private rehearsal session for Wednesday 2026-09-09
-- at 15:00 Argentina (America/Argentina/Cordoba, UTC-3), which is 18:00 UTC.
-- The dedicated row inherits only the reviewed Umbral facilitator; it does
-- not reuse the public room, tickets, participants, grants, or session state.
WITH facilitator_source AS (
    SELECT "facilitator_id"
    FROM "scheduled_sessions"
    WHERE "id" = '50000000-0000-4000-8000-202609120001'::uuid
      AND "is_test" = false
    LIMIT 1
)
INSERT INTO "scheduled_sessions" (
    "id", "title", "description", "room_name", "language", "scheduled_at",
    "status", "is_test", "paid_mode", "public_access", "attendee_cap",
    "max_publishers", "facilitator_id", "updated_at"
)
SELECT
    '60000000-0000-4000-8000-202609090001'::uuid,
    'Prueba interna — Sala Umbral · 09/09 15:00 ART',
    'Ensayo interno del recorrido de sala. No es un evento público ni habilita entradas reales.',
    'rehearsal-2026-09-09-1500-art',
    'SPANISH'::"SessionLanguage",
    '2026-09-09 18:00:00'::timestamp,
    'SCHEDULED'::"ScheduledSessionStatus",
    true,
    false,
    false,
    150,
    6,
    facilitator_source."facilitator_id",
    CURRENT_TIMESTAMP
FROM facilitator_source
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE
    initialized_count integer;
    source_count integer;
    rehearsal_count integer;
    related_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO source_count
    FROM "scheduled_sessions"
    WHERE "id" = '50000000-0000-4000-8000-202609120001'::uuid
      AND "is_test" = false;

    SELECT count(*) INTO rehearsal_count
    FROM "scheduled_sessions"
    WHERE "id" = '60000000-0000-4000-8000-202609090001'::uuid
      AND "title" = 'Prueba interna — Sala Umbral · 09/09 15:00 ART'
      AND "room_name" = 'rehearsal-2026-09-09-1500-art'
      AND "language" = 'SPANISH'::"SessionLanguage"
      AND "scheduled_at" = '2026-09-09 18:00:00'::timestamp
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus"
      AND "is_test" = true
      AND "paid_mode" = false
      AND "public_access" = false
      AND "attendee_cap" = 150
      AND "max_publishers" = 6;

    SELECT
        (SELECT count(*) FROM "ticket_entitlements"
         WHERE "scheduled_session_id" = '60000000-0000-4000-8000-202609090001'::uuid)
      + (SELECT count(*) FROM "session_participants"
         WHERE "scheduled_session_id" = '60000000-0000-4000-8000-202609090001'::uuid)
      + (SELECT count(*) FROM "session_contributions"
         WHERE "scheduled_session_id" = '60000000-0000-4000-8000-202609090001'::uuid)
    INTO related_count;

    IF initialized_count = 0 AND rehearsal_count <> 0 THEN
        RAISE EXCEPTION 'Empty installation contains the September 9 rehearsal';
    ELSIF initialized_count > 0 AND (source_count <> 1 OR rehearsal_count <> 1) THEN
        RAISE EXCEPTION 'September 9 rehearsal could not be created safely';
    ELSIF related_count <> 0 THEN
        RAISE EXCEPTION 'September 9 rehearsal must start without inherited attendee state';
    END IF;
END $$;
