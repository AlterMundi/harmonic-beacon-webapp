-- ON CONFLICT and RETURNING require read access to the conflict/returned key,
-- but the collector must not be able to read event payloads.
GRANT SELECT (event_id) ON ingest.raw_events TO analytics_collector;
