#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
runtime_sha=${1:?usage: run-staff-account-binding.sh runtime-sha40 (--dry-run|--apply)}
mode=${2:?usage: run-staff-account-binding.sh runtime-sha40 (--dry-run|--apply)}
test "$#" -eq 2 || { echo 'exactly two arguments required' >&2; exit 2; }
case "$runtime_sha" in *[!0-9a-f]*|'') echo 'exact lowercase runtime sha40 required' >&2; exit 2 ;; esac
test "${#runtime_sha}" -eq 40 || { echo 'exact lowercase runtime sha40 required' >&2; exit 2; }
case "$mode" in --dry-run|--apply) ;; *) echo 'mode must be --dry-run or --apply' >&2; exit 2 ;; esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
source_script="$root/scripts/live-production/bind-staff-account.ts"
image="harmonic-beacon/app:$runtime_sha"
production_env=/etc/harmonic-beacon/production.env
input=/etc/harmonic-beacon/live-production-secrets/staff-account-binding.env
state_root=/var/lib/harmonic-beacon/live-production-staff-binding
stamp=$(date -u +%Y%m%dT%H%M%SZ)
state="$state_root/run-$stamp"
network="hb-live-staff-binding-$$"
minimal_env=$(mktemp /run/hb-live-staff-binding.XXXXXX)
runner_cidfile=$(mktemp /run/hb-live-staff-binding-cid.XXXXXX)
network_created=0
database_connected=0

fail() { echo "Live production staff binding: $*" >&2; exit 2; }
private_file() {
  test -f "$1" && test ! -L "$1" || fail "$2 must be a regular file"
  test "$(stat -c '%U:%G:%a' "$1")" = root:root:600 || fail "$2 must be root:root mode 0600"
}
env_value() {
  key=$1
  count=$(grep -c "^${key}=" "$production_env" || true)
  test "$count" -eq 1 || fail "$key must appear exactly once in production env"
  sed -n "s/^${key}=//p" "$production_env"
}
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if test -s "$runner_cidfile"; then
    runner_cid=$(cat "$runner_cidfile")
    case "$runner_cid" in *[!0-9a-f]*|'') ;; *) docker rm -f "$runner_cid" >/dev/null 2>&1 || true ;; esac
  fi
  if test "$database_connected" -eq 1; then
    docker network disconnect -f "$network" beacon-postgres >/dev/null 2>&1 || true
  fi
  if test "$network_created" -eq 1; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  rm -f -- "$minimal_env" "$runner_cidfile"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

private_file "$production_env" 'production environment'
private_file "$input" 'staff binding input'
test -f "$source_script" && test ! -L "$source_script" || fail 'operator source must be a regular file'
source_sha=$(git -C "$root" rev-parse HEAD)
test -n "$source_sha" && test "${#source_sha}" -eq 40 || fail 'operator source checkout is invalid'
test -z "$(git -C "$root" status --porcelain)" || fail 'operator source checkout is dirty'
docker image inspect "$image" >/dev/null 2>&1 || fail 'exact runtime image is absent'
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$runtime_sha" || fail 'runtime image provenance mismatch'
test "$(docker inspect beacon-app --format '{{.Config.Image}}')" = "$image" || fail 'runtime image is not active'
test "$(docker inspect beacon-app --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" = 'true|healthy' ||
  fail 'Live app is not healthy'
test "$(docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_ACCOUNT_ENABLED=//p' | tail -n 1)" = true || fail 'Live Account is not enabled'
test "$(docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_ACCOUNT_ISSUER_URL=//p' | tail -n 1)" = https://account.harmonicbeacon.com ||
  fail 'Live Account issuer is not production'

postgres_user=$(env_value POSTGRES_USER)
postgres_password=$(env_value POSTGRES_PASSWORD)
postgres_database=$(env_value POSTGRES_DB)
test "$postgres_database" = beacon || fail 'production database name is not beacon'
command -v jq >/dev/null 2>&1 || fail 'jq is required'
command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
encoded_user=$(jq -rn --arg value "$postgres_user" '$value|@uri')
encoded_password=$(jq -rn --arg value "$postgres_password" '$value|@uri')
encoded_database=$(jq -rn --arg value "$postgres_database" '$value|@uri')
unset postgres_user postgres_password postgres_database
{
  printf 'DATABASE_URL=postgresql://%s:%s@postgres:5432/%s\n' "$encoded_user" "$encoded_password" "$encoded_database"
  printf 'LIVE_PRODUCTION_STAFF_BINDING_ENABLED=1\n'
  printf 'LIVE_PRODUCTION_ENVIRONMENT=production\n'
  printf 'BEACON_ACCOUNT_ISSUER_URL=https://account.harmonicbeacon.com\n'
} > "$minimal_env"
unset encoded_user encoded_password encoded_database
chown root:root "$minimal_env"
chmod 0600 "$minimal_env"
private_file "$minimal_env" 'minimal runner environment'

if test -e "$state_root"; then
  test -d "$state_root" && test ! -L "$state_root" || fail 'state root must be a regular directory'
  test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:700 || fail 'state root must be root:root mode 0700'
else
  install -d -o root -g root -m 0700 "$state_root"
fi
test ! -e "$state" || fail 'operator state already exists'
install -d -o root -g root -m 0700 "$state"
install -o root -g root -m 0600 "$source_script" "$state/bind-staff-account.ts"
printf 'source_sha=%s\nruntime_sha=%s\nmode=%s\n' "$source_sha" "$runtime_sha" "$mode" > "$state/provenance.txt"
chmod 0600 "$state/provenance.txt"

if test "$mode" = --apply; then
  docker exec beacon-postgres sh -ec \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$state/live.before.dump"
  test -s "$state/live.before.dump" || fail 'database backup is empty'
  chmod 0600 "$state/live.before.dump"
  docker exec -i beacon-postgres pg_restore --list < "$state/live.before.dump" >/dev/null ||
    fail 'database backup could not be listed'
fi

docker network create --internal --driver bridge "$network" >/dev/null
network_created=1
docker network connect --alias postgres "$network" beacon-postgres
database_connected=1
output=$(timeout --signal=TERM 30s docker run --rm --pull never --cidfile "$runner_cidfile" --network "$network" \
  --read-only --user 0:0 --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$source_script,dst=/app/scripts/live-production/bind-staff-account.operator.ts,readonly" \
  --mount "type=bind,src=$input,dst=/run/harmonic-beacon/staff-account-binding.env,readonly" \
  --env-file "$minimal_env" --tmpfs /tmp:size=16m,mode=1777 --workdir /app \
  --entrypoint npx "$image" tsx /app/scripts/live-production/bind-staff-account.operator.ts "$mode")
printf '%s\n' "$output" | jq -e --arg mode "${mode#--}" \
  '.mode == $mode and (.outcome == "would-create" or .outcome == "created" or .outcome == "already-bound") and
   (.staffUserId | type == "string") and (.subjectDigest | test("^[0-9a-f]{12}$"))' >/dev/null ||
  fail 'operator returned an invalid result'
printf '%s\n' "$output" > "$state/result.json"
chmod 0600 "$state/result.json"
(cd "$state" && sha256sum bind-staff-account.ts provenance.txt result.json \
  $(test -f live.before.dump && printf '%s' live.before.dump) > SHA256SUMS)
chmod 0600 "$state/SHA256SUMS"
printf '%s\n' "$output"
printf 'Evidence: %s\n' "$state"
