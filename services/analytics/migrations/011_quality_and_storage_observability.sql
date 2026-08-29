CREATE TABLE ops.storage_samples (
    checked_at timestamptz NOT NULL DEFAULT now(),
    database_bytes bigint NOT NULL CHECK (database_bytes >= 0),
    raw_events bigint NOT NULL CHECK (raw_events >= 0),
    account_facts bigint NOT NULL CHECK (account_facts >= 0),
    listening_intervals bigint NOT NULL CHECK (listening_intervals >= 0),
    live_presence_intervals bigint NOT NULL CHECK (live_presence_intervals >= 0),
    membership_snapshots bigint NOT NULL CHECK (membership_snapshots >= 0),
    payment_facts bigint NOT NULL CHECK (payment_facts >= 0),
    PRIMARY KEY (checked_at)
);
CREATE INDEX storage_samples_recent ON ops.storage_samples (checked_at DESC);

CREATE OR REPLACE VIEW mart.latest_quality_results AS
SELECT DISTINCT ON (check_name, source)
       check_name,source,status,observed_value,expected_value,details,checked_at
FROM ops.quality_results
ORDER BY check_name,source,checked_at DESC,id DESC;

GRANT SELECT ON ops.storage_samples TO analytics_dashboard;
GRANT SELECT ON mart.latest_quality_results TO analytics_dashboard;

