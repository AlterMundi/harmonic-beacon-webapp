CREATE INDEX IF NOT EXISTS dead_letters_open_source
    ON ingest.dead_letters (source, last_failed_at DESC)
    WHERE resolved_at IS NULL;

CREATE OR REPLACE VIEW mart.source_health AS
WITH classified AS (
    SELECT w.*,
           CASE w.source
               WHEN 'worker' THEN interval '5 minutes'
               WHEN 'listener' THEN interval '15 minutes'
               WHEN 'live' THEN interval '15 minutes'
               WHEN 'authority' THEN interval '15 minutes'
               WHEN 'meta' THEN interval '45 minutes'
               WHEN 'collector' THEN interval '90 minutes'
               ELSE interval '15 minutes'
           END AS freshness_budget
    FROM ops.source_watermarks w
)
SELECT c.source,c.status,c.last_success_at,c.lag_seconds,c.rows_read,c.rows_written,
       c.last_error_code,c.updated_at,
       CASE
           WHEN c.status='disabled' THEN 'disabled'
           WHEN c.status='error' THEN 'error'
           WHEN c.last_success_at IS NULL OR c.status='unknown' THEN 'unknown'
           WHEN c.status='stale' OR c.last_success_at < now()-c.freshness_budget THEN 'stale'
           ELSE 'ok'
       END AS display_state,
       c.last_attempt_at,
       CASE WHEN c.last_success_at IS NULL THEN NULL
            ELSE greatest(0,extract(epoch FROM (now()-c.last_success_at))::int) END AS sync_age_seconds,
       coalesce(d.open_dead_letters,0)::bigint AS open_dead_letters
FROM classified c
LEFT JOIN LATERAL (
    SELECT count(*) AS open_dead_letters
    FROM ingest.dead_letters dl
    WHERE dl.source=c.source AND dl.resolved_at IS NULL
) d ON true;
