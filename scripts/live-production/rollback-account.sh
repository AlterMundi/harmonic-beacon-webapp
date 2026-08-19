#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
production_env=/etc/harmonic-beacon/production.env
bundle=/etc/harmonic-beacon/live-production-secrets/account.env
vhost=/etc/nginx/sites-enabled/harmonic-beacon
state_root=/var/lib/harmonic-beacon/live-account-production
last_activation="$state_root/last-activation"

fail() { echo "Live production Account rollback: $*" >&2; exit 2; }
case "$script_directory" in
  "$state_root"/activation-*) state=$script_directory ;;
  *)
    test -f "$last_activation" && test ! -L "$last_activation" || fail 'last activation pointer is missing'
    test "$(stat -c '%U:%G:%a' "$last_activation")" = root:root:600 || fail 'last activation pointer permissions are invalid'
    state=$(cat "$last_activation")
    ;;
esac
case "$state" in "$state_root"/activation-*) ;; *) fail 'last activation path is invalid' ;; esac
test -d "$state" && test ! -L "$state" || fail 'activation state is missing'
(cd "$state" && sha256sum -c SHA256SUMS >/dev/null) || fail 'activation evidence checksum mismatch'
live_image=$(cat "$state/live-image.txt")
live_sha=${live_image##*:}
case "$live_sha" in *[!0-9a-f]*|'') fail 'saved Live SHA is invalid' ;; esac
test "${#live_sha}" -eq 40 || fail 'saved Live SHA is invalid'
test "$(docker inspect beacon-app --format '{{.Config.Image}}')" = "$live_image" || fail 'running Live image mismatch'
test -f "$bundle" && test ! -L "$bundle" || fail 'active Account bundle is missing'
compose_file="$state/docker-compose.yml"
candidate_vhost="$state/nginx.candidate"
test -f "$compose_file" && test ! -L "$compose_file" || fail 'saved Compose file is missing'
test -f "$candidate_vhost" && test ! -L "$candidate_vhost" || fail 'saved candidate vhost is missing'

exec 9>/run/lock/live-account-production.lock
flock -n 9 || fail 'another Live production Account operation is active'
disabled="$state/account.env.disabled-$(date -u +%Y%m%dT%H%M%SZ)"
mv "$bundle" "$disabled"
chmod 0600 "$disabled"

rollback_failed=1
restore_enabled() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$rollback_failed" -eq 1; then
    test -f "$bundle" || mv -f "$disabled" "$bundle" || true
    BEACON_IMAGE_TAG="$live_sha" docker compose -p app --env-file "$production_env" \
      -f "$compose_file" up -d --no-deps --force-recreate --no-build app || true
    install -o root -g root -m 0644 "$candidate_vhost" "$vhost" || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
  exit "$status"
}
trap restore_enabled EXIT
trap 'exit 130' HUP INT TERM

BEACON_IMAGE_TAG="$live_sha" docker compose -p app --env-file "$production_env" \
  -f "$compose_file" up -d --no-deps --force-recreate --no-build app
attempt=0
while test "$attempt" -lt 60; do
  health=$(docker inspect beacon-app --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  test "$health" != healthy || break
  test "$health" != exited || fail 'Account-OFF Live app exited'
  attempt=$((attempt + 1))
  sleep 2
done
test "$health" = healthy || fail 'Account-OFF Live app did not become healthy'
enabled=$(docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_ACCOUNT_ENABLED=//p' | tail -n 1)
test "$enabled" != true || fail 'Account remained enabled after bundle removal'
curl --silent --show-error --fail --connect-timeout 3 --max-time 8 --proto '=https' \
  https://live.harmonicbeacon.com/api/health/ready |
  jq --exit-status '.status == "ok" and .checks.database == "ok" and .checks.account == "disabled"' >/dev/null

install -o root -g root -m 0644 "$state/nginx.previous" "$vhost"
nginx -t >/dev/null || fail 'previous Live Nginx configuration is invalid'
systemctl reload nginx
rollback_failed=0
trap - EXIT HUP INT TERM

{
  printf 'rolled_back_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'live_sha=%s\n' "$live_sha"
  printf 'account=disabled\n'
  printf 'previous_vhost=restored\n'
} > "$state/rollback-result.txt"
chmod 0600 "$state/rollback-result.txt"
echo "Live production Account is disabled; app remains healthy at exact SHA $live_sha."
echo "Dormant app-only bundle retained at $disabled"
