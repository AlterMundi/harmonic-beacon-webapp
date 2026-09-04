-- Sai moved the two remaining public-cycle sessions to 14:00 Argentina
-- (America/Argentina/Cordoba, UTC-3), which is 17:00 UTC. Historical sessions
-- keep their actual times. Access, facilitator and room state remain intact.
BEGIN;

WITH corrected_sessions ("id", "scheduled_at") AS (
    VALUES
        ('50000000-0000-4000-8000-202609050001'::uuid, '2026-09-05 17:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, '2026-09-12 17:00:00'::timestamp)
)
UPDATE "scheduled_sessions" AS session
SET
    "scheduled_at" = corrected_sessions."scheduled_at",
    "updated_at" = CURRENT_TIMESTAMP
FROM corrected_sessions
WHERE session."id" = corrected_sessions."id"
  AND session."status" = 'SCHEDULED'::"ScheduledSessionStatus";

DO $$
DECLARE
    initialized_count integer;
    corrected_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO corrected_count
    FROM "scheduled_sessions"
    WHERE ("id", "scheduled_at") IN (
        ('50000000-0000-4000-8000-202609050001'::uuid, '2026-09-05 17:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, '2026-09-12 17:00:00'::timestamp)
    )
      AND "status" = 'SCHEDULED'::"ScheduledSessionStatus";

    IF initialized_count = 0 AND corrected_count <> 0 THEN
        RAISE EXCEPTION 'Empty installation contains a partial remaining Umbral cycle';
    ELSIF initialized_count > 0 AND corrected_count <> 2 THEN
        RAISE EXCEPTION 'Remaining Umbral sessions must both start at 17:00 UTC';
    END IF;
END $$;

COMMIT;
