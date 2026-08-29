CREATE OR REPLACE VIEW mart.listening_intervals_unioned AS
WITH ordered AS (
    SELECT *, max(ended_at) OVER (
        PARTITION BY account_subject, environment, traffic_class
        ORDER BY started_at, ended_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_max_end
    FROM mart.listening_intervals
), grouped AS (
    SELECT *, sum(CASE WHEN prior_max_end IS NULL OR started_at > prior_max_end THEN 1 ELSE 0 END)
        OVER (PARTITION BY account_subject, environment, traffic_class ORDER BY started_at, ended_at) AS island
    FROM ordered
)
SELECT account_subject, environment, traffic_class, island,
       min(started_at) AS started_at, max(ended_at) AS ended_at,
       extract(epoch FROM max(ended_at) - min(started_at))::bigint AS duration_seconds
FROM grouped
GROUP BY account_subject, environment, traffic_class, island;

CREATE OR REPLACE VIEW mart.live_presence_intervals_unioned AS
WITH ordered AS (
    SELECT *, max(ended_at) OVER (
        PARTITION BY event_subject, person_subject, environment, traffic_class, is_staff, is_test
        ORDER BY started_at, ended_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_max_end
    FROM mart.live_presence_intervals
), grouped AS (
    SELECT *, sum(CASE WHEN prior_max_end IS NULL OR started_at > prior_max_end THEN 1 ELSE 0 END)
        OVER (PARTITION BY event_subject, person_subject, environment, traffic_class, is_staff, is_test ORDER BY started_at, ended_at) AS island
    FROM ordered
)
SELECT event_subject, person_subject, environment, traffic_class, is_staff, is_test, island,
       min(started_at) AS started_at, max(ended_at) AS ended_at,
       extract(epoch FROM max(ended_at) - min(started_at))::bigint AS duration_seconds
FROM grouped
GROUP BY event_subject, person_subject, environment, traffic_class, is_staff, is_test, island;

CREATE OR REPLACE VIEW mart.current_memberships AS
SELECT DISTINCT ON (account_subject) *
FROM mart.membership_snapshots
ORDER BY account_subject, revision DESC, effective_at DESC;

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
    count(*) FILTER (WHERE event_name='page.viewed') AS pageviews
FROM ingest.raw_events
WHERE source='browser'
GROUP BY 1,2,3,4,5,6,7,8,9;

CREATE OR REPLACE VIEW mart.source_health AS
SELECT source, status, last_success_at, lag_seconds, rows_read, rows_written, last_error_code, updated_at,
       CASE
           WHEN status='error' THEN 'error'
           WHEN last_success_at IS NULL THEN 'unknown'
           WHEN status='stale' THEN 'stale'
           ELSE 'ok'
       END AS display_state
FROM ops.source_watermarks;

CREATE OR REPLACE VIEW mart.commerce_summary AS
SELECT occurred_at::date AS metric_date, environment, traffic_class, currency,
       count(*) FILTER (WHERE state='confirmed') AS confirmed_payments,
       count(*) FILTER (WHERE state='refunded') AS refunds,
       coalesce(sum(CASE WHEN state='confirmed' THEN amount_minor WHEN state='refunded' THEN -amount_minor ELSE 0 END),0) AS net_revenue_minor
FROM mart.payment_facts
GROUP BY 1,2,3,4;

CREATE OR REPLACE VIEW mart.campaign_delivery AS
SELECT e.*,
       coalesce(i.spend_minor,0) AS spend_minor,
       coalesce(i.impressions,0) AS impressions,
       coalesce(i.clicks,0) AS clicks,
       i.reach, i.frequency, i.ctr, i.cpc_minor, i.cpm_minor, i.actions,
       CASE WHEN coalesce(i.spend_minor,0) > 0 OR coalesce(i.impressions,0) > 0 THEN true ELSE false END AS delivering,
       i.date_start, i.date_stop, i.attribution_window, i.observed_at AS insight_observed_at
FROM mart.campaign_entities e
LEFT JOIN mart.campaign_insights i
  ON i.provider=e.provider AND i.entity_type=e.entity_type AND i.entity_id=e.entity_id;
