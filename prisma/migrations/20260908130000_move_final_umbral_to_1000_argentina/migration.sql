-- Dirección moved the final public Umbral session to 10:00 Argentina
-- (America/Argentina/Cordoba, UTC-3), which is 13:00 UTC. Historical
-- sessions and migrations keep their actual times.
UPDATE "scheduled_sessions"
SET
    "scheduled_at" = '2026-09-12 13:00:00'::timestamp,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = '50000000-0000-4000-8000-202609120001'::uuid
  AND "status" = 'SCHEDULED'::"ScheduledSessionStatus";

DO $$
DECLARE
    initialized_count integer;
    corrected_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO corrected_count
    FROM "scheduled_sessions"
    WHERE "id" = '50000000-0000-4000-8000-202609120001'::uuid
      AND "scheduled_at" = '2026-09-12 13:00:00'::timestamp
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus";

    IF initialized_count = 0 AND corrected_count <> 0 THEN
        RAISE EXCEPTION 'Empty installation contains the final Umbral session';
    ELSIF initialized_count > 0 AND corrected_count <> 1 THEN
        RAISE EXCEPTION 'Final Umbral session must start at 13:00 UTC';
    END IF;
END $$;
