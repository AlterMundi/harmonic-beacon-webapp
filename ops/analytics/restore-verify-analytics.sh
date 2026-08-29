#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

backup="${1:-}"
identity="${ANALYTICS_BACKUP_IDENTITY_FILE:-/etc/harmonic-beacon/analytics-backup-identity.txt}"
postgres_image="postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
[[ -s "$backup" && -s "${backup}.sha256" && -s "$identity" ]] || {
    echo "Usage: $0 /mnt/beacon-data/backups/analytics/postgres/hb-analytics-*.dump.age" >&2
    exit 64
}
mountpoint -q /mnt/beacon-data || { echo "Analytics data mount absent." >&2; exit 72; }
case "$(readlink -m -- "$backup")" in /mnt/beacon-data/backups/analytics/postgres/*) ;; *) exit 64;; esac
(cd "$(dirname "$backup")" && sha256sum -c -- "$(basename "${backup}.sha256")" >/dev/null)
stage="$(mktemp -d /mnt/beacon-data/backups/analytics/.restore.XXXXXX)"
restore_db="analytics_restore_$(date -u +%Y%m%d%H%M%S)"
cleanup() {
    docker exec hb-analytics-postgres dropdb -U analytics_owner --if-exists "$restore_db" >/dev/null 2>&1 || true
    rm -rf -- "$stage"
}
trap cleanup EXIT
age -d -i "$identity" -o "$stage/database.dump" "$backup"
docker run --rm -i "$postgres_image" pg_restore --list < "$stage/database.dump" >/dev/null
docker exec hb-analytics-postgres createdb -U analytics_owner -O analytics_owner "$restore_db"
docker cp "$stage/database.dump" "hb-analytics-postgres:/tmp/${restore_db}.dump"
docker exec hb-analytics-postgres pg_restore -U analytics_owner -d "$restore_db" --no-owner --no-privileges "/tmp/${restore_db}.dump"
docker exec hb-analytics-postgres rm -f "/tmp/${restore_db}.dump"
tables="$(docker exec hb-analytics-postgres psql -U analytics_owner -d "$restore_db" -Atc \
  "select count(*) from pg_catalog.pg_tables where schemaname in ('ingest','mart','ops','audit','identity_map')")"
[[ "$tables" -ge 10 ]] || { echo "Restore verification found too few tables: $tables" >&2; exit 74; }
printf 'restore_verified database=%s tables=%s backup=%s\n' "$restore_db" "$tables" "$backup"
