CREATE TABLE IF NOT EXISTS mart.acquisition_daily (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    metric_date date NOT NULL,
    environment text NOT NULL,
    traffic_class text NOT NULL,
    source text NOT NULL,
    medium text NOT NULL,
    campaign text NOT NULL,
    first_source text NOT NULL,
    first_medium text NOT NULL,
    first_campaign text NOT NULL,
    first_referrer text NOT NULL,
    last_referrer text NOT NULL,
    first_landing text NOT NULL,
    last_landing text NOT NULL,
    visitors bigint NOT NULL,
    sessions bigint NOT NULL,
    pageviews bigint NOT NULL,
    refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acquisition_daily_scope
    ON mart.acquisition_daily (metric_date,environment,traffic_class);

INSERT INTO mart.acquisition_daily
    (metric_date,environment,traffic_class,source,medium,campaign,first_source,first_medium,first_campaign,
     first_referrer,last_referrer,first_landing,last_landing,visitors,sessions,pageviews)
SELECT occurred_at::date,environment,traffic_class,
  coalesce(nullif(last_attribution->>'utm_source',''),nullif(page->>'referrer',''),'direct'),
  coalesce(nullif(last_attribution->>'utm_medium',''),'unknown'),
  coalesce(nullif(last_attribution->>'utm_campaign',''),'unattributed'),
  coalesce(nullif(first_attribution->>'utm_source',''),nullif(page->>'referrer',''),'direct'),
  coalesce(nullif(first_attribution->>'utm_medium',''),'unknown'),
  coalesce(nullif(first_attribution->>'utm_campaign',''),'unattributed'),
  coalesce(nullif(first_attribution->>'referrer',''),'direct'),
  coalesce(nullif(last_attribution->>'referrer',''),'direct'),
  coalesce(nullif(first_attribution->>'landing',''),'unknown'),
  coalesce(nullif(last_attribution->>'landing',''),'unknown'),
  count(distinct visitor_id),count(distinct session_id),count(*) filter(where event_name='page.viewed')
FROM ingest.raw_events
WHERE source='browser'
GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13;

CREATE OR REPLACE VIEW mart.acquisition AS
SELECT metric_date,environment,traffic_class,source,medium,campaign,
       first_source,first_medium,first_campaign,visitors,sessions,pageviews,
       first_referrer,last_referrer,first_landing,last_landing
FROM mart.acquisition_daily;
