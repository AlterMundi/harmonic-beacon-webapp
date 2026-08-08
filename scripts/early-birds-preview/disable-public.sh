#!/usr/bin/env sh
set -eu

. "$(dirname -- "$0")/lib.sh"

usage() {
  echo 'usage: disable-public.sh {--dry-run|--apply} /secure/preview.env' >&2
  exit 2
}

mode=${1:-}
env_file=${2:-}
test "$#" -eq 2 || usage
case "$mode" in --dry-run|--apply) ;; *) usage ;; esac
test -n "$env_file" || usage
test -f "$env_file" && test ! -L "$env_file" \
  || preview_fail 'preview env path must be a regular non-symlink file'

umask 077
lock_file="${env_file}.listener-public.lock"
exec 9>"$lock_file"
chmod 0600 "$lock_file"
flock -n 9 || preview_fail 'another Listener public-mode operation holds the lock'

protected_env_file=$env_file
require_synthetic_env "$env_file"
env_file=$protected_env_file
test "$(stat -c '%a' "$env_file")" = 600 \
  || preview_fail 'preview env file mode must be exactly 0600'

for key in \
  EARLY_BIRDS_ENABLED \
  EARLY_BIRDS_FREE_FOR_ALL \
  EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED
do
  count=$(grep -c "^${key}=" "$env_file" || true)
  test "$count" -eq 1 || preview_fail "$key must appear exactly once"
done

if test "$mode" = --dry-run; then
  echo 'DRY RUN: no environment value, container or public route was changed.'
  echo "Would set EARLY_BIRDS_ENABLED=0 (currently $(preview_env_value EARLY_BIRDS_ENABLED "$env_file"))."
  echo "Would set EARLY_BIRDS_FREE_FOR_ALL=0 (currently $(preview_env_value EARLY_BIRDS_FREE_FOR_ALL "$env_file"))."
  echo "Would set EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0 (currently $(preview_env_value EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED "$env_file"))."
  echo 'Would create one mode-0600 backup, atomically replace the env file, recreate only Listener, then verify health/readiness and lease denial.'
  exit 0
fi

test "$(id -u)" -eq 0 || preview_fail '--apply must run as root'

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="${env_file}.pre-disable-public-${timestamp}-$$"
candidate=$(mktemp "${env_file}.disable-public.XXXXXX")
cleanup() { test -z "$candidate" || rm -f "$candidate"; }
trap cleanup EXIT HUP INT TERM

test ! -e "$backup" || preview_fail 'refusing to overwrite an existing disable backup'
cp -p "$env_file" "$backup"
chmod 0600 "$backup"

awk '
  /^EARLY_BIRDS_ENABLED=/ { print "EARLY_BIRDS_ENABLED=0"; next }
  /^EARLY_BIRDS_FREE_FOR_ALL=/ { print "EARLY_BIRDS_FREE_FOR_ALL=0"; next }
  /^EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=/ {
    print "EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0"; next
  }
  { print }
' "$env_file" > "$candidate"
chmod 0600 "$candidate"
require_synthetic_env "$candidate"
env_file=$protected_env_file
for key in \
  EARLY_BIRDS_ENABLED \
  EARLY_BIRDS_FREE_FOR_ALL \
  EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED
do
  test "$(preview_env_value "$key" "$candidate")" = 0 \
    || preview_fail "$key candidate value is not disabled"
done

mv -f "$candidate" "$env_file"
candidate=''
sync -f "$env_file"

fail_closed() {
  echo "Listener disable failed after the env was secured; stopping only Listener. Backup: $backup" >&2
  listener_ids=$(docker ps -q \
    --filter label=com.docker.compose.project=earlybirds-preview \
    --filter label=com.docker.compose.service=listener 2>/dev/null || true)
  if test -n "$listener_ids"; then
    for listener_id in $listener_ids; do docker stop "$listener_id" >/dev/null 2>&1 || true; done
  else
    (preview_compose_command "$env_file" stop listener) >/dev/null 2>&1 || true
  fi
  exit 1
}

wait_for_http_success() {
  wait_url=${1:?usage: wait_for_http_success URL}
  wait_attempt=1
  while test "$wait_attempt" -le 10; do
    if curl --fail --silent --show-error --max-time 2 "$wait_url" >/dev/null; then
      return 0
    fi
    test "$wait_attempt" -lt 10 || return 1
    sleep 1
    wait_attempt=$((wait_attempt + 1))
  done
  return 1
}

(preview_compose_command "$env_file" \
  up -d --no-deps --force-recreate --no-build listener) || fail_closed

app_port=$(preview_env_value EARLYBIRDS_PREVIEW_APP_PORT "$env_file")
wait_for_http_success "http://127.0.0.1:${app_port}/api/health" || fail_closed
wait_for_http_success "http://127.0.0.1:${app_port}/api/health/ready" || fail_closed
denial_status=$(curl --silent --show-error --max-time 10 \
  --output /dev/null --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' \
  --data '{"deviceId":"00000000-0000-4000-8000-000000000000","intent":"play"}' \
  "http://127.0.0.1:${app_port}/api/early-birds/stream/lease") || fail_closed
test "$denial_status" = 503 || fail_closed

echo 'Listener public entry, Free for All and staging team entry are disabled.'
echo 'Only Listener was recreated; PostgreSQL and stream origin were retained.'
echo "Health/readiness passed and the lease endpoint denied with 503. Backup: $backup"
