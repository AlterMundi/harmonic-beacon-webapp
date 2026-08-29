#!/usr/bin/env bash
set -Eeuo pipefail

mountpoint -q /mnt/beacon-data || { echo "analytics_mount_absent" >&2; exit 1; }
[[ "$(stat -c %d /mnt/beacon-data)" != "$(stat -c %d /)" ]] || { echo "analytics_mount_is_root" >&2; exit 1; }
for container in hb-analytics-postgres hb-analytics-collector hb-analytics-worker; do
    state="$(docker inspect "$container" --format '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
    [[ "$state" == running:healthy ]] || { echo "analytics_container_unhealthy name=$container state=$state" >&2; exit 1; }
done
root_percent="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
data_percent="$(df -P /mnt/beacon-data | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
data_inode_percent="$(df -Pi /mnt/beacon-data | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
data_available="$(df -Pk /mnt/beacon-data | awk 'NR==2 {print $4}')"
[[ "$root_percent" -lt "${ANALYTICS_ROOT_DISK_ALERT_PERCENT:-85}" ]] || exit 1
[[ "$data_percent" -lt "${ANALYTICS_DATA_DISK_ALERT_PERCENT:-85}" ]] || exit 1
[[ "$data_inode_percent" -lt "${ANALYTICS_DATA_INODE_ALERT_PERCENT:-85}" ]] || exit 1
[[ "$data_available" -ge "${ANALYTICS_DATA_DISK_RESERVE_KIB:-10485760}" ]] || exit 1
backup_root="${ANALYTICS_BACKUP_OUTPUT:-/mnt/beacon-data/backups/analytics/postgres}"
latest="$(find "$backup_root" -maxdepth 1 -type f -name 'hb-analytics-*.dump.age' -printf '%T@|%p\n' | sort -nr | head -1 | cut -d'|' -f2-)"
[[ -n "$latest" && -s "${latest}.sha256" ]] || { echo "analytics_backup_missing" >&2; exit 1; }
age_seconds="$(( $(date +%s) - $(stat -c %Y -- "$latest") ))"
[[ "$age_seconds" -le "${ANALYTICS_BACKUP_MAX_AGE_SECONDS:-28800}" ]] || { echo "analytics_backup_stale age=$age_seconds" >&2; exit 1; }
(cd "$backup_root" && sha256sum -c -- "$(basename "${latest}.sha256")" >/dev/null)
db_bytes="$(docker exec hb-analytics-postgres psql -U analytics_owner -d analytics -Atc "select pg_database_size(current_database())")"
lag="$(docker exec hb-analytics-postgres psql -U analytics_owner -d analytics -Atc "select coalesce(max(lag_seconds),0) from ops.source_watermarks where status='ok'")"
unhealthy_sources="$(docker exec hb-analytics-postgres psql -U analytics_owner -d analytics -Atc \
  "select count(*) from mart.source_health where display_state in ('stale','error') or open_dead_letters>0")"
[[ "$unhealthy_sources" -eq 0 ]] || { echo "analytics_sources_unhealthy count=$unhealthy_sources" >&2; exit 1; }
unhealthy_quality="$(docker exec hb-analytics-postgres psql -U analytics_owner -d analytics -Atc \
  "select count(*) from mart.latest_quality_results where status='error' and checked_at>now()-interval '2 hours'")"
[[ "$unhealthy_quality" -eq 0 ]] || { echo "analytics_quality_failed count=$unhealthy_quality" >&2; exit 1; }
daily_growth="$(docker exec hb-analytics-postgres psql -U analytics_owner -d analytics -Atc \
  "with current_sample as (select database_bytes from ops.storage_samples order by checked_at desc limit 1),
         prior_sample as (select database_bytes from ops.storage_samples where checked_at<=now()-interval '20 hours' order by checked_at desc limit 1)
   select coalesce(greatest(0,current_sample.database_bytes-prior_sample.database_bytes),0) from current_sample left join prior_sample on true")"
[[ "$daily_growth" -le "${ANALYTICS_DATABASE_DAILY_GROWTH_ALERT_BYTES:-1073741824}" ]] || {
  echo "analytics_database_growth_high bytes=$daily_growth" >&2; exit 1;
}
printf 'analytics_monitor_ok root=%s%% data=%s%% inodes=%s%% backup_age=%ss database_bytes=%s daily_growth=%s max_lag=%ss\n' \
  "$root_percent" "$data_percent" "$data_inode_percent" "$age_seconds" "$db_bytes" "$daily_growth" "$lag"
