#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
live_sha=${1:?usage: activate-account.sh live-sha40 account-sha40 account-schema}
account_sha=${2:?usage: activate-account.sh live-sha40 account-sha40 account-schema}
account_schema=${3:?usage: activate-account.sh live-sha40 account-sha40 account-schema}
for exact_sha in "$live_sha" "$account_sha"; do
  case "$exact_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
  test "${#exact_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }
done
printf '%s\n' "$account_schema" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' || {
  echo 'exact Account schema required' >&2
  exit 2
}

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image="harmonic-beacon/app:$live_sha"
production_env=/etc/harmonic-beacon/production.env
bundle=/etc/harmonic-beacon/live-production-secrets/account.env
vhost=/etc/nginx/sites-available/harmonic-beacon
vhost_enabled=/etc/nginx/sites-enabled/harmonic-beacon
state_root=/var/lib/harmonic-beacon/live-account-production
stamp=$(date -u +%Y%m%dT%H%M%SZ)
state="$state_root/activation-$live_sha-$stamp"
# Exact public vhost in use before this Account surface existed. If production
# changes independently, activation stops for a fresh review instead of
# overwriting operator drift.
pre_account_vhost_sha=9cfa7d4ba1ae5c1de767c02a154ef4ff980a2927a66a64b85062a87f296f3be3

fail() { echo "Live production Account activation: $*" >&2; exit 2; }
private_file() {
  test -f "$1" && test ! -L "$1" || fail "$2 must be a regular file"
  test "$(stat -c '%U:%G:%a' "$1")" = root:root:600 || fail "$2 must be root:root mode 0600"
}
container_env_value() {
  docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n "s/^${1}=//p" | tail -n 1 | tr -d '\r'
}
wait_healthy() {
  attempt=0
  while test "$attempt" -lt 60; do
    health=$(docker inspect beacon-app --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    test "$health" != healthy || return 0
    test "$health" != exited || return 1
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}
write_protected_containers() {
  destination=$1
  : > "$destination"
  for name in beacon-postgres beacon-livekit beacon-playlist-bot beacon-tapestry beacon-commerce-reconciler; do
    docker inspect "$name" --format '{{.Name}}|{{.Id}}|{{.Config.Image}}|{{.State.Running}}|{{.RestartCount}}' >> "$destination"
  done
  chmod 0600 "$destination"
}
compose_app() {
  BEACON_IMAGE_TAG="$live_sha" docker compose -p app --env-file "$production_env" \
    -f "$root/docker-compose.yml" up -d --no-deps --force-recreate --no-build app
}
run_account_preflight() {
  mode=$1
  docker run --rm --pull never --read-only --user 0:0 --cap-drop ALL \
    --security-opt no-new-privileges \
    --mount "type=bind,src=$bundle,dst=/etc/harmonic-beacon/live-production-secrets/account.env,readonly" \
    --tmpfs /tmp:size=16m,mode=1777 \
    --entrypoint node "$image" /app/scripts/live-production/account-preflight.mjs \
    "$mode" "$account_sha" "$account_schema"
}

exec 9>/run/lock/live-account-production.lock
flock -n 9 || fail 'another Live production Account activation is active'
test "$(git -C "$root" rev-parse HEAD)" = "$live_sha" || fail 'release checkout SHA mismatch'
test -z "$(git -C "$root" status --porcelain)" || fail 'release checkout is dirty'
private_file "$production_env" 'Live production environment'
private_file "$bundle" 'Live production Account bundle'
test -f "$vhost" && test ! -L "$vhost" || fail 'Live production vhost must be a regular file'
test -L "$vhost_enabled" || fail 'Live production enabled vhost must be a symbolic link'
test "$(readlink -f "$vhost_enabled")" = "$vhost" ||
  fail 'Live production enabled vhost targets an unexpected file'
test "$(sha256sum "$vhost" | awk '{print $1}')" = "$pre_account_vhost_sha" || fail 'current Live vhost is not the reviewed pre-Account boundary'
docker image inspect "$image" >/dev/null 2>&1 || fail 'exact Live image is missing'
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$live_sha" || fail 'Live image provenance mismatch'
running_image=$(docker inspect beacon-app --format '{{.Config.Image}}')
test "$running_image" = "$image" || fail 'deploy the exact Live release with Account OFF before activation'
test "$(docker inspect beacon-app --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" = 'true|healthy' ||
  fail 'current Live app is not healthy'
test "$(container_env_value BEACON_ACCOUNT_ENABLED)" != true || fail 'Live Account is already enabled'

# Prove the authority and the exact confidential hb-live credential before any
# persistent edge or runtime mutation. This candidate receives only its own
# four-key app bundle while it has egress.
run_account_preflight prepared

if test -e "$state_root"; then
  test -d "$state_root" && test ! -L "$state_root" || fail 'state root must be a regular directory'
  test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:700 || fail 'state root must be root:root mode 0700'
else
  install -d -o root -g root -m 0700 "$state_root"
fi
test ! -e "$state" || fail 'activation state already exists'
install -d -o root -g root -m 0700 "$state"
install -o root -g root -m 0600 "$bundle" "$state/account.env.prepared"
install -o root -g root -m 0600 "$vhost" "$state/nginx.previous"
install -o root -g root -m 0600 "$root/deploy/nginx-harmonic-beacon.conf" "$state/nginx.candidate"
install -o root -g root -m 0600 "$root/docker-compose.yml" "$state/docker-compose.yml"
install -o root -g root -m 0700 "$root/scripts/live-production/rollback-account.sh" "$state/rollback-account.sh"
printf '%s\n' "$image" > "$state/live-image.txt"
printf '%s\n' "$account_sha" > "$state/account-sha.txt"
printf '%s\n' "$account_schema" > "$state/account-schema.txt"
chmod 0600 "$state/live-image.txt" "$state/account-sha.txt" "$state/account-schema.txt"
write_protected_containers "$state/protected-containers.before"

cutover_started=0
rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$cutover_started" -eq 1; then
    echo 'Live production Account activation failed; restoring Account-OFF app and prior vhost.' >&2
    if test -f "$bundle"; then mv -f "$bundle" "$state/account.env.failed" || true; fi
    compose_app || true
    wait_healthy || true
    install -o root -g root -m 0644 "$state/nginx.previous" "$vhost" || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  elif test "$status" -ne 0; then
    rm -rf "$state"
  fi
  exit "$status"
}
trap rollback_on_failure EXIT
trap 'exit 130' HUP INT TERM

cutover_started=1
install -o root -g root -m 0644 "$root/deploy/nginx-harmonic-beacon.conf" "$vhost"
nginx -t >/dev/null || fail 'candidate Live Nginx configuration is invalid'
systemctl reload nginx
compose_app
wait_healthy || fail 'Live app did not become healthy with Account enabled'

test "$(docker inspect beacon-app --format '{{.Config.Image}}')" = "$image" || fail 'running Live image mismatch'
test "$(container_env_value BEACON_GIT_SHA)" = "$live_sha" || fail 'running Live SHA mismatch'
test "$(container_env_value BEACON_ACCOUNT_ENABLED)" = true || fail 'running Live Account flag mismatch'
test "$(container_env_value BEACON_ACCOUNT_ISSUER_URL)" = https://account.harmonicbeacon.com || fail 'running issuer mismatch'
test "$(container_env_value BEACON_ACCOUNT_CLIENT_ID)" = hb-live || fail 'running client mismatch'
docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
  grep -q '^BEACON_ACCOUNT_CLIENT_SECRET=' || fail 'running client secret is absent'
if docker inspect beacon-postgres beacon-livekit beacon-playlist-bot beacon-tapestry beacon-commerce-reconciler \
  --format '{{range .Config.Env}}{{println .}}{{end}}' |
  grep -q '^BEACON_ACCOUNT_CLIENT_SECRET='; then
  fail 'non-app container received the Account client secret'
fi

"$root/scripts/live-production/health-smoke.sh" "$live_sha"
run_account_preflight public
write_protected_containers "$state/protected-containers.after"
cmp -s "$state/protected-containers.before" "$state/protected-containers.after" ||
  fail 'protected Live, event, audio or payment containers changed during Account activation'

{
  printf 'activated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'live_sha=%s\n' "$live_sha"
  printf 'account_sha=%s\n' "$account_sha"
  printf 'account_schema=%s\n' "$account_schema"
  printf 'account_preflight=pass\n'
  printf 'public_edge=pass\n'
  printf 'protected_runtime=unchanged\n'
} > "$state/result.txt"
chmod 0600 "$state/result.txt"
(cd "$state" && sha256sum account.env.prepared nginx.previous nginx.candidate docker-compose.yml \
  rollback-account.sh live-image.txt account-sha.txt \
  account-schema.txt protected-containers.before protected-containers.after result.txt > SHA256SUMS)
chmod 0600 "$state/SHA256SUMS"
temporary="$state_root/last-activation.tmp-$$"
printf '%s\n' "$state" > "$temporary"
chmod 0600 "$temporary"
mv -T "$temporary" "$state_root/last-activation"

cutover_started=0
trap - EXIT HUP INT TERM
echo "Live production Account is healthy at exact Live SHA $live_sha."
echo "Rollback state: $state"
echo "Durable rollback command: sudo $state/rollback-account.sh"
