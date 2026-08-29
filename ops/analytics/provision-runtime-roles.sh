#!/usr/bin/env bash
set -Eeuo pipefail

: "${ANALYTICS_COLLECTOR_DATABASE_PASSWORD:?required}"
: "${ANALYTICS_DASHBOARD_DATABASE_PASSWORD:?required}"
postgres_container="${ANALYTICS_POSTGRES_CONTAINER:-hb-analytics-postgres}"
[[ "$ANALYTICS_COLLECTOR_DATABASE_PASSWORD" != "$ANALYTICS_DASHBOARD_DATABASE_PASSWORD" ]] || {
  echo "Analytics database passwords must be distinct." >&2; exit 64;
}
for password in "$ANALYTICS_COLLECTOR_DATABASE_PASSWORD" "$ANALYTICS_DASHBOARD_DATABASE_PASSWORD"; do
  [[ "$password" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || { echo "Database passwords must be base64url strings." >&2; exit 64; }
done
docker exec \
  -e HB_COLLECTOR_PASSWORD="$ANALYTICS_COLLECTOR_DATABASE_PASSWORD" \
  -e HB_DASHBOARD_PASSWORD="$ANALYTICS_DASHBOARD_DATABASE_PASSWORD" \
  "$postgres_container" sh -ceu '
    psql -v ON_ERROR_STOP=1 -v collector_password="$HB_COLLECTOR_PASSWORD" -v dashboard_password="$HB_DASHBOARD_PASSWORD" -U analytics_owner -d analytics <<'"'"'SQL'"'"'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='"'"'hb_analytics_collector'"'"') THEN CREATE ROLE hb_analytics_collector LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='"'"'hb_analytics_dashboard'"'"') THEN CREATE ROLE hb_analytics_dashboard LOGIN; END IF;
END $roles$;
SELECT format('"'"'ALTER ROLE hb_analytics_collector PASSWORD %L'"'"', :'"'"'collector_password'"'"') \gexec
SELECT format('"'"'ALTER ROLE hb_analytics_dashboard PASSWORD %L'"'"', :'"'"'dashboard_password'"'"') \gexec
GRANT analytics_collector TO hb_analytics_collector;
GRANT analytics_dashboard TO hb_analytics_dashboard;
SQL
  '
