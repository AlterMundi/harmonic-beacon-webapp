#!/usr/bin/env bash
if [[ "${EUID}" -eq 0 && -n "${SUDO_USER:-}" && "${SUDO_USER}" != root ]]; then
    exec sudo -u "$SUDO_USER" -- "$0" "$@"
fi
set -Eeuo pipefail
umask 077

mount_root="${ANALYTICS_BACKUP_REQUIRED_MOUNT:-/mnt/beacon-data}"
output_root="${ANALYTICS_BACKUP_OUTPUT:-/mnt/beacon-data/backups/analytics/postgres}"
recipients_file="${ANALYTICS_BACKUP_RECIPIENTS_FILE:-/etc/harmonic-beacon/analytics-backup-recipients.txt}"
retention_days="${ANALYTICS_BACKUP_RETENTION_DAYS:-14}"

mountpoint -q -- "$mount_root" || { echo "Analytics backup mount is absent: $mount_root" >&2; exit 72; }
[[ "$(stat -c %d -- "$mount_root")" != "$(stat -c %d -- /)" ]] || {
    echo "Analytics backup mount resolves to root filesystem." >&2
    exit 72
}
output_root="$(readlink -m -- "$output_root")"
case "${output_root}/" in "${mount_root}/"*) ;; *) echo "Analytics backup output is outside mount." >&2; exit 72;; esac
[[ "$retention_days" =~ ^[1-9][0-9]*$ ]] || exit 64
mapfile -t recipients < <(sed -n '/^age1[[:alnum:]]/p' "$recipients_file" | sort -u)
[[ "${#recipients[@]}" -eq 2 ]] || { echo "Exactly two age recipients are required." >&2; exit 64; }

exec 9>/run/lock/hb-analytics-backup.lock
flock -n 9 || { echo "Another analytics backup is active." >&2; exit 75; }
install -d -m 0700 "$output_root" "${mount_root}/backups/analytics/.stage"
stage="$(mktemp -d "${mount_root}/backups/analytics/.stage/run.XXXXXX")"
trap '[[ -n "${stage:-}" && "$stage" == /mnt/beacon-data/backups/analytics/.stage/run.* ]] && rm -rf -- "$stage"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="${stage}/hb-analytics-${stamp}.dump"
docker exec hb-analytics-postgres pg_dump -U analytics_owner -d analytics --format=custom --no-owner --no-privileges > "$plain"
pg_restore --list "$plain" >/dev/null
output="${output_root}/hb-analytics-${stamp}.dump.age"
age -r "${recipients[0]}" -r "${recipients[1]}" -o "$output" "$plain"
chmod 600 "$output"
(cd "$output_root" && sha256sum "$(basename "$output")") > "${output}.sha256"
chmod 600 "${output}.sha256"
while IFS= read -r -d '' artifact; do
    [[ -s "${artifact}.sha256" ]] || { echo "Refusing retention without checksum: $artifact" >&2; exit 74; }
    rm -- "$artifact" "${artifact}.sha256"
done < <(find "$output_root" -maxdepth 1 -type f -name 'hb-analytics-*.dump.age' -mtime "+${retention_days}" -print0)
echo "$output"
