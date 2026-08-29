CREATE SCHEMA IF NOT EXISTS ingest;
CREATE SCHEMA IF NOT EXISTS identity_map;
CREATE SCHEMA IF NOT EXISTS mart;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE ingest.raw_events (
    event_id uuid PRIMARY KEY,
    schema_version text NOT NULL CHECK (schema_version = 'hb.analytics.event.v1'),
    event_name text NOT NULL CHECK (event_name ~ '^[a-z][a-z0-9_.]{2,63}$'),
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL,
    surface text NOT NULL,
    environment text NOT NULL,
    visitor_id uuid,
    session_id uuid,
    account_subject char(64),
    page jsonb,
    attribution jsonb,
    first_attribution jsonb,
    last_attribution jsonb,
    device jsonb,
    traffic_class text NOT NULL DEFAULT 'unknown',
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    country_code varchar(2),
    region_code varchar(16),
    network_digest char(64),
    CHECK (jsonb_typeof(properties) = 'object'),
    CHECK (traffic_class IN ('real','internal','synthetic','test','unknown')),
    CHECK (environment IN ('production','staging','development','test'))
);
CREATE INDEX raw_events_occurred_brin ON ingest.raw_events USING brin (occurred_at);
CREATE INDEX raw_events_received_brin ON ingest.raw_events USING brin (received_at);
CREATE INDEX raw_events_name_time ON ingest.raw_events (event_name, occurred_at DESC);
CREATE INDEX raw_events_visitor_time ON ingest.raw_events (visitor_id, occurred_at) WHERE visitor_id IS NOT NULL;
CREATE INDEX raw_events_session_time ON ingest.raw_events (session_id, occurred_at) WHERE session_id IS NOT NULL;
CREATE INDEX raw_events_account_time ON ingest.raw_events (account_subject, occurred_at) WHERE account_subject IS NOT NULL;
CREATE INDEX raw_events_attribution_gin ON ingest.raw_events USING gin (attribution jsonb_path_ops) WHERE attribution IS NOT NULL;
CREATE INDEX raw_events_first_attribution_gin ON ingest.raw_events USING gin (first_attribution jsonb_path_ops) WHERE first_attribution IS NOT NULL;
CREATE INDEX raw_events_last_attribution_gin ON ingest.raw_events USING gin (last_attribution jsonb_path_ops) WHERE last_attribution IS NOT NULL;

CREATE TABLE ingest.dead_letters (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source text NOT NULL,
    source_key_digest char(64) NOT NULL,
    error_code varchar(64) NOT NULL,
    first_failed_at timestamptz NOT NULL DEFAULT now(),
    last_failed_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 1,
    retry_after timestamptz,
    resolved_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (source, source_key_digest, error_code)
);

CREATE TABLE ingest.projection_receipts (
    event_id uuid NOT NULL REFERENCES ingest.raw_events(event_id) ON DELETE CASCADE,
    projector varchar(64) NOT NULL,
    projected_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, projector)
);

CREATE TABLE ops.source_watermarks (
    source text PRIMARY KEY,
    watermark jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    lag_seconds integer,
    status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('ok','stale','error','unknown','disabled')),
    rows_read bigint NOT NULL DEFAULT 0,
    rows_written bigint NOT NULL DEFAULT 0,
    last_error_code varchar(64),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.quality_results (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    check_name varchar(96) NOT NULL,
    source text NOT NULL,
    status text NOT NULL CHECK (status IN ('ok','warning','error','unknown')),
    observed_value numeric,
    expected_value numeric,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quality_results_recent ON ops.quality_results (checked_at DESC, status);

CREATE TABLE identity_map.account_links (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_subject char(64) NOT NULL,
    visitor_id uuid NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    link_reason varchar(32) NOT NULL CHECK (link_reason IN ('login','signup','handoff','backfill','account_switch')),
    source_event_id uuid REFERENCES ingest.raw_events(event_id),
    traffic_class text NOT NULL DEFAULT 'unknown',
    UNIQUE (account_subject, visitor_id, valid_from)
);
CREATE INDEX account_links_visitor_time ON identity_map.account_links (visitor_id, valid_from, valid_to);
CREATE INDEX account_links_subject_time ON identity_map.account_links (account_subject, valid_from, valid_to);

CREATE TABLE identity_map.subject_aliases (
    alias_subject char(64) PRIMARY KEY,
    account_subject char(64) NOT NULL,
    issuer_digest char(64) NOT NULL,
    linked_at timestamptz NOT NULL,
    source text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subject_aliases_account ON identity_map.subject_aliases (account_subject);

CREATE TABLE mart.account_facts (
    source_system text NOT NULL,
    source_key_digest char(64) NOT NULL,
    account_subject char(64) NOT NULL,
    created_at timestamptz NOT NULL,
    verified_at timestamptz,
    auth_method varchar(32),
    last_active_at timestamptz,
    traffic_class text NOT NULL DEFAULT 'unknown',
    environment text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_key_digest)
);
CREATE INDEX account_facts_subject ON mart.account_facts (account_subject);
CREATE INDEX account_facts_created ON mart.account_facts (created_at DESC, environment, traffic_class);

CREATE TABLE mart.listening_intervals (
    source_system text NOT NULL,
    source_key text NOT NULL,
    account_subject char(64) NOT NULL,
    device_subject char(64),
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    source_category varchar(16) NOT NULL CHECK (source_category IN ('intro','beacon','unknown')),
    access_class varchar(32) NOT NULL,
    environment text NOT NULL,
    traffic_class text NOT NULL DEFAULT 'unknown',
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_key),
    CHECK (ended_at >= started_at),
    CHECK (ended_at - started_at <= interval '24 hours')
);
CREATE INDEX listening_intervals_account_time ON mart.listening_intervals (account_subject, started_at, ended_at);
CREATE INDEX listening_intervals_time ON mart.listening_intervals (started_at, environment, traffic_class);

CREATE TABLE mart.live_presence_intervals (
    source_system text NOT NULL,
    source_key text NOT NULL,
    event_subject char(64) NOT NULL,
    person_subject char(64) NOT NULL,
    account_subject char(64),
    role varchar(32) NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    reconnect_count integer NOT NULL DEFAULT 0,
    end_reason varchar(32) NOT NULL,
    is_staff boolean NOT NULL,
    is_test boolean NOT NULL,
    environment text NOT NULL,
    traffic_class text NOT NULL DEFAULT 'unknown',
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_key),
    CHECK (ended_at >= started_at),
    CHECK (ended_at - started_at <= interval '12 hours')
);
CREATE INDEX live_presence_person_time ON mart.live_presence_intervals (event_subject, person_subject, started_at, ended_at);
CREATE INDEX live_presence_event_time ON mart.live_presence_intervals (event_subject, started_at, is_staff, is_test);

CREATE TABLE mart.membership_snapshots (
    source_system text NOT NULL,
    source_key text NOT NULL,
    account_subject char(64) NOT NULL,
    revision integer NOT NULL,
    state varchar(40) NOT NULL,
    provider varchar(32),
    offer_code varchar(128),
    currency char(3),
    amount_minor integer,
    effective_at timestamptz NOT NULL,
    paid_through timestamptz,
    terminal_at timestamptz,
    traffic_class text NOT NULL,
    environment text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_key, revision)
);
CREATE INDEX membership_current ON mart.membership_snapshots (account_subject, revision DESC);
CREATE INDEX membership_state_time ON mart.membership_snapshots (state, effective_at DESC, environment, traffic_class);

CREATE TABLE mart.payment_facts (
    source_system text NOT NULL,
    source_key_digest char(64) NOT NULL,
    account_subject char(64) NOT NULL,
    membership_source_key text,
    provider varchar(32) NOT NULL,
    state varchar(32) NOT NULL CHECK (state IN ('confirmed','refunded','reversed')),
    amount_minor integer NOT NULL CHECK (amount_minor >= 0),
    currency char(3) NOT NULL,
    occurred_at timestamptz NOT NULL,
    traffic_class text NOT NULL,
    environment text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, source_key_digest)
);
CREATE INDEX payment_facts_time ON mart.payment_facts (occurred_at DESC, environment, traffic_class, currency);

CREATE TABLE mart.campaign_entities (
    provider text NOT NULL,
    entity_type varchar(16) NOT NULL CHECK (entity_type IN ('campaign','adset','ad')),
    entity_id text NOT NULL,
    parent_id text,
    name text NOT NULL,
    configured_status varchar(32),
    effective_status varchar(64),
    objective varchar(64),
    starts_at timestamptz,
    ends_at timestamptz,
    account_currency char(3),
    account_timezone varchar(64),
    observed_at timestamptz NOT NULL,
    raw_digest char(64) NOT NULL,
    PRIMARY KEY (provider, entity_type, entity_id)
);

CREATE TABLE mart.campaign_insights (
    provider text NOT NULL,
    entity_type varchar(16) NOT NULL,
    entity_id text NOT NULL,
    date_start date NOT NULL,
    date_stop date NOT NULL,
    attribution_window varchar(64) NOT NULL,
    currency char(3) NOT NULL,
    spend_minor bigint,
    impressions bigint,
    reach bigint,
    frequency numeric(12,4),
    clicks bigint,
    ctr numeric(12,6),
    cpc_minor bigint,
    cpm_minor bigint,
    actions jsonb NOT NULL DEFAULT '{}'::jsonb,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (provider, entity_type, entity_id, date_start, date_stop, attribution_window)
);

CREATE TABLE audit.analytics_access (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_subject char(64) NOT NULL,
    actor_role varchar(32) NOT NULL,
    action varchar(32) NOT NULL CHECK (action IN ('dashboard_view','detail_view','csv_export')),
    resource varchar(128) NOT NULL,
    filters_digest char(64),
    row_count integer,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_access_actor_time ON audit.analytics_access (actor_subject, occurred_at DESC);

CREATE TABLE mart.daily_metrics (
    metric_date date NOT NULL,
    environment text NOT NULL,
    traffic_class text NOT NULL,
    surface text NOT NULL,
    visitors bigint NOT NULL DEFAULT 0,
    sessions bigint NOT NULL DEFAULT 0,
    pageviews bigint NOT NULL DEFAULT 0,
    accounts_created bigint NOT NULL DEFAULT 0,
    accounts_verified bigint NOT NULL DEFAULT 0,
    listeners bigint NOT NULL DEFAULT 0,
    listening_seconds bigint NOT NULL DEFAULT 0,
    attendees bigint NOT NULL DEFAULT 0,
    attendee_seconds bigint NOT NULL DEFAULT 0,
    payments_confirmed bigint NOT NULL DEFAULT 0,
    revenue_minor bigint NOT NULL DEFAULT 0,
    currency char(3),
    refreshed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (metric_date, environment, traffic_class, surface, currency)
);
