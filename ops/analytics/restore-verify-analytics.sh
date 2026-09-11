#!/bin/bash
set -Eeuo pipefail
umask 077
readonly PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH

readonly COMPOSE_FILE='/usr/local/libexec/harmonic-beacon/analytics/compose.synthetic.yml'
readonly IDENTITY_FILE='/etc/harmonic-beacon/analytics-backup-identity.txt'
readonly BACKUP_ROOT='/mnt/beacon-data/backups/analytics/postgres'
readonly postgres_image='postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'

backup="${1:-}"
expected_checksum="${2:-}"
image_ref="${3:-}"
run_id="${4:-}"
run_attempt="${5:-}"
[[ "$backup" =~ ^/mnt/beacon-data/backups/analytics/postgres/hb-analytics-[0-9]{8}T[0-9]{6}Z\.dump\.age$ ]] || exit 64
[[ "$expected_checksum" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 64
[[ "$image_ref" =~ ^ghcr\.io/altermundi/harmonic-beacon-analytics@sha256:[0-9a-f]{64}$ ]] || exit 64
[[ "$run_id" =~ ^[1-9][0-9]{0,19}$ && "$run_attempt" =~ ^[1-9][0-9]{0,9}$ ]] || exit 64
[[ -f "$backup" && ! -L "$backup" && -f "${backup}.sha256" && ! -L "${backup}.sha256" ]] || exit 64
[[ "$(stat -c '%h' "$backup")" = 1 && "$(stat -c '%h' "${backup}.sha256")" = 1 ]] || exit 64
[[ -f "$IDENTITY_FILE" && ! -L "$IDENTITY_FILE" && "$(stat -c '%U:%G:%a:%h' "$IDENTITY_FILE")" = root:root:600:1 ]] || exit 64
mountpoint -q /mnt/beacon-data || exit 72
[[ "$(stat -c %d /mnt/beacon-data)" != "$(stat -c %d /)" ]] || exit 72

actual_checksum="sha256:$(sha256sum "$backup" | cut -d' ' -f1)"
[[ "$actual_checksum" = "$expected_checksum" ]] || exit 74
(cd "$BACKUP_ROOT" && sha256sum --check --strict "$(basename "${backup}.sha256")" >/dev/null)
backup_bytes="$(stat -c %s "$backup")"
backup_age="$(( $(date +%s) - $(stat -c %Y "$backup") ))"
(( backup_bytes > 0 && backup_age >= 0 && backup_age <= 28800 )) || exit 74

project="analytics-synthetic-restore-${run_id}-${run_attempt}"
stage="$(mktemp -d /var/lib/harmonic-beacon/analytics-delivery/.restore.XXXXXX)"
password="analytics-synthetic-restore-${run_id}-${run_attempt}"
cleanup_observed=false
cleanup() {
  ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
    docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf --one-file-system -- "$stage"
}
trap cleanup EXIT

age -d -i "$IDENTITY_FILE" -o "$stage/database.dump" "$backup"
docker run --rm -i "$postgres_image" pg_restore --list < "$stage/database.dump" >/dev/null
ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
  docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore up -d --wait --wait-timeout 60 postgres-synthetic
container="$(ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
  docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore ps -q postgres-synthetic)"
[[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || exit 74
docker cp "$stage/database.dump" "$container:/tmp/database.dump"
docker exec "$container" pg_restore -U analytics_synthetic_user -d analytics_synthetic --no-owner --no-privileges /tmp/database.dump
docker exec "$container" rm -f /tmp/database.dump
ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
  docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore \
  run --rm --no-deps --no-build --pull never migrate-synthetic
observed_tables="$(docker exec "$container" psql -U analytics_synthetic_user -d analytics_synthetic -Atc \
  "select count(*) from pg_catalog.pg_tables where schemaname in ('ingest','mart','ops','audit','identity_map')")"
[[ "$observed_tables" =~ ^[0-9]+$ ]] && (( observed_tables >= 10 )) || exit 74

ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
  docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore \
  down --volumes --remove-orphans >/dev/null
remaining="$(ANALYTICS_IMAGE_REF="$image_ref" ANALYTICS_SYNTHETIC_DATABASE_PASSWORD="$password" \
  docker compose --file "$COMPOSE_FILE" --project-name "$project" --profile synthetic-restore ps -aq)"
[[ -z "$remaining" ]] || exit 74
cleanup_observed=true
trap - EXIT
rm -rf --one-file-system -- "$stage"
printf '{"status":"passed","profile":"analytics-synthetic-restore","backupChecksumSha256":"%s","backupBytes":%s,"backupAgeSeconds":%s,"observedTables":%s,"cleanupObserved":%s}\n' \
  "$actual_checksum" "$backup_bytes" "$backup_age" "$observed_tables" "$cleanup_observed"
