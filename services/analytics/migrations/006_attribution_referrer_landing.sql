CREATE OR REPLACE VIEW mart.acquisition AS
SELECT
    occurred_at::date AS metric_date,
    environment,
    traffic_class,
    coalesce(nullif(last_attribution->>'utm_source',''), nullif(page->>'referrer',''), 'direct') AS source,
    coalesce(nullif(last_attribution->>'utm_medium',''), 'unknown') AS medium,
    coalesce(nullif(last_attribution->>'utm_campaign',''), 'unattributed') AS campaign,
    coalesce(nullif(first_attribution->>'utm_source',''), nullif(page->>'referrer',''), 'direct') AS first_source,
    coalesce(nullif(first_attribution->>'utm_medium',''), 'unknown') AS first_medium,
    coalesce(nullif(first_attribution->>'utm_campaign',''), 'unattributed') AS first_campaign,
    count(DISTINCT visitor_id) AS visitors,
    count(DISTINCT session_id) AS sessions,
    count(*) FILTER (WHERE event_name='page.viewed') AS pageviews,
    coalesce(nullif(first_attribution->>'referrer',''), 'direct') AS first_referrer,
    coalesce(nullif(last_attribution->>'referrer',''), 'direct') AS last_referrer,
    coalesce(nullif(first_attribution->>'landing',''), 'unknown') AS first_landing,
    coalesce(nullif(last_attribution->>'landing',''), 'unknown') AS last_landing
FROM ingest.raw_events
WHERE source='browser'
GROUP BY 1,2,3,4,5,6,7,8,9,13,14,15,16;
