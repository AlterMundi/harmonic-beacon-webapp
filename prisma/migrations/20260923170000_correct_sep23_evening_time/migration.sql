-- Owner clarification: event starts at 19 ART (22 UTC).
-- Cohort observation starts at 18 ART (21 UTC) and is intentionally unchanged.
-- Preserve the event ID, room name, tickets and participant relationships.
DO $$
DECLARE
    event_row record;
BEGIN
    SELECT "title", "scheduled_at", "status" INTO event_row
    FROM "scheduled_sessions"
    WHERE "id" = '50000000-0000-4000-8000-202609230002'::uuid
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN; -- Empty installation has no seeded facilitator/event.
    END IF;
    IF event_row."title" = 'Proyecciones Mito — 19:00'
       AND event_row."scheduled_at" = '2026-09-23 22:00:00'::timestamp THEN
        RETURN;
    END IF;
    IF event_row."status" <> 'SCHEDULED'::"ScheduledSessionStatus"
       OR event_row."title" <> 'Proyecciones Mito — 18:00'
       OR event_row."scheduled_at" <> '2026-09-23 21:00:00'::timestamp THEN
        RAISE EXCEPTION 'September 23 evening correction requires the unchanged scheduled event';
    END IF;
    UPDATE "scheduled_sessions"
    SET "title" = 'Proyecciones Mito — 19:00',
        "scheduled_at" = '2026-09-23 22:00:00'::timestamp,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = '50000000-0000-4000-8000-202609230002'::uuid;
END $$;
