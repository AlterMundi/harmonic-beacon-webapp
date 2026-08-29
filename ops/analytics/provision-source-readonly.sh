#!/usr/bin/env bash
set -Eeuo pipefail

source_name="${1:-}"
password="${2:-}"
[[ "$password" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || { echo "Usage: $0 SOURCE BASE64URL_PASSWORD" >&2; exit 64; }
case "$source_name" in
  listener)
    container=earlybirds-preview-postgres-1; database=earlybirds_preview; owner=earlybirds_preview
    tables='early_bird_users early_bird_identities listener_account_subjects early_bird_stream_leases early_bird_listening_intervals early_bird_membership_projections'
    ;;
  live)
    container=beacon-postgres; database=beacon; owner=beacon
    tables='session_participants scheduled_sessions live_presence_intervals ticket_entitlements'
    ;;
  authority)
    container=earlybirds-authority-postgres-1; database=earlybirds_authority; owner=earlybirds_authority
    tables='early_bird_subscriptions early_bird_accounts early_bird_checkout_bindings early_bird_provider_events'
    ;;
  *) echo "Unknown source: $source_name" >&2; exit 64;;
esac

grants=''
for table in $tables; do
  grants+="GRANT SELECT ON TABLE public.\"$table\" TO hb_analytics_ro;"
done
docker exec -e HB_ANALYTICS_RO_PASSWORD="$password" "$container" sh -ceu "
  psql -v ON_ERROR_STOP=1 -v analytics_password=\"\$HB_ANALYTICS_RO_PASSWORD\" -U '$owner' -d '$database' <<'SQL'
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hb_analytics_ro') THEN CREATE ROLE hb_analytics_ro LOGIN; END IF;
END \$roles\$;
SELECT format('ALTER ROLE hb_analytics_ro PASSWORD %L', :'analytics_password') \gexec
GRANT CONNECT ON DATABASE $database TO hb_analytics_ro;
GRANT USAGE ON SCHEMA public TO hb_analytics_ro;
$grants
SQL
"
printf 'readonly_source_role_ready source=%s tables=%s\n' "$source_name" "$(wc -w <<<"$tables")"
