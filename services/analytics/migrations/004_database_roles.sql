DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='analytics_collector') THEN CREATE ROLE analytics_collector NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='analytics_dashboard') THEN CREATE ROLE analytics_dashboard NOLOGIN; END IF;
END $roles$;

GRANT CONNECT ON DATABASE analytics TO analytics_collector, analytics_dashboard;
GRANT USAGE ON SCHEMA ingest TO analytics_collector;
GRANT INSERT ON ingest.raw_events TO analytics_collector;

GRANT USAGE ON SCHEMA ingest, mart, ops, audit TO analytics_dashboard;
GRANT SELECT ON ALL TABLES IN SCHEMA ingest, mart, ops TO analytics_dashboard;
GRANT INSERT ON audit.analytics_access TO analytics_dashboard;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO analytics_dashboard;

ALTER DEFAULT PRIVILEGES FOR ROLE analytics_owner IN SCHEMA ingest GRANT SELECT ON TABLES TO analytics_dashboard;
ALTER DEFAULT PRIVILEGES FOR ROLE analytics_owner IN SCHEMA mart GRANT SELECT ON TABLES TO analytics_dashboard;
ALTER DEFAULT PRIVILEGES FOR ROLE analytics_owner IN SCHEMA ops GRANT SELECT ON TABLES TO analytics_dashboard;
ALTER DEFAULT PRIVILEGES FOR ROLE analytics_owner IN SCHEMA audit GRANT INSERT ON TABLES TO analytics_dashboard;
ALTER DEFAULT PRIVILEGES FOR ROLE analytics_owner IN SCHEMA audit GRANT USAGE, SELECT ON SEQUENCES TO analytics_dashboard;
