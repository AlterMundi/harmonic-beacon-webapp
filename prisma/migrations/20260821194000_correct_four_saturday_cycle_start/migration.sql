-- Correct the reviewed public cycle to its confirmed 16:00 UTC start.
-- The four stable ids are already public, so this migration changes only
-- their scheduled time and leaves access, facilitator and room state intact.
WITH corrected_sessions ("id", "scheduled_at") AS (
    VALUES
        ('50000000-0000-4000-8000-202608220001'::uuid, '2026-08-22 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202608290001'::uuid, '2026-08-29 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609050001'::uuid, '2026-09-05 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, '2026-09-12 16:00:00'::timestamp)
)
UPDATE "scheduled_sessions" AS session
SET
    "scheduled_at" = corrected_sessions."scheduled_at",
    "updated_at" = CURRENT_TIMESTAMP
FROM corrected_sessions
WHERE session."id" = corrected_sessions."id";

DO $$
DECLARE
    initialized_count integer;
    corrected_count integer;
BEGIN
    SELECT count(*) INTO initialized_count FROM "users";

    SELECT count(*) INTO corrected_count
    FROM "scheduled_sessions"
    WHERE ("id", "scheduled_at") IN (
        ('50000000-0000-4000-8000-202608220001'::uuid, '2026-08-22 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202608290001'::uuid, '2026-08-29 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609050001'::uuid, '2026-09-05 16:00:00'::timestamp),
        ('50000000-0000-4000-8000-202609120001'::uuid, '2026-09-12 16:00:00'::timestamp)
    );

    IF initialized_count = 0 AND corrected_count <> 0 THEN
        RAISE EXCEPTION 'Empty installation contains a partial four-Saturday public cycle';
    ELSIF initialized_count > 0 AND corrected_count <> 4 THEN
        RAISE EXCEPTION 'Four-Saturday public cycle must contain four sessions at 16:00 UTC';
    END IF;
END $$;
