#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }

expected_sha=${1:?usage: activate.sh exact-sha40}
case "$expected_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image="harmonic-beacon/earlybirds-preview-listener:$expected_sha"
listener_env=/etc/harmonic-beacon/earlybirds-preview.env
bundle=/etc/harmonic-beacon/listener-account-production.env
account_deploy=/etc/harmonic-beacon/beacon-account-deploy.env
state_root=/var/lib/harmonic-beacon/listener-account-production
build_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
state="$state_root/activation-$expected_sha-$stamp"
cleanup_preflight() { test ! -d "$state" || rm -rf "$state"; }
trap cleanup_preflight EXIT
trap 'exit 130' HUP INT TERM
umask 077

fail() { echo "Listener production Account activation: $*" >&2; exit 2; }
private_file() {
  test -f "$1" && test ! -L "$1" || fail "$2 must be a regular file"
  test "$(stat -c '%U:%G:%a' "$1")" = root:root:600 || fail "$2 must be root:root mode 0600"
}
write_protected_environment() {
  protected_source=$1
  protected_target=$2
  grep -E '^(EARLY_BIRDS_ENABLED|EARLY_BIRDS_FREE_FOR_ALL|BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED|BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED|BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED|BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED|BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED|LISTENER_WITHDRAWAL_ENABLED|EARLY_BIRDS_STREAM_ORIGIN|EARLY_BIRDS_STREAM_ARTIFACT_ID|EARLY_BIRDS_AUTHORITY_BASE_URL)=' \
    "$protected_source" | sort > "$protected_target"
  test "$(wc -l < "$protected_target")" -eq 11 || fail 'protected Listener environment inventory is incomplete'
  chmod 0600 "$protected_target"
}
write_protected_containers() {
  protected_target=$1
  : > "$protected_target"
  for protected_container in \
    earlybirds-preview-postgres-1 \
    earlybirds-preview-beacon-stream-1 \
    earlybirds-preview-withdrawal-operator-1; do
    docker inspect "$protected_container" \
      --format '{{.Name}}|{{.Id}}|{{.Config.Image}}|{{.State.Running}}|{{.RestartCount}}' \
      >> "$protected_target"
  done
  chmod 0600 "$protected_target"
}
wait_healthy() {
  wait_attempt=0
  while test "$wait_attempt" -lt 60; do
    wait_state=$(docker inspect earlybirds-preview-listener-1 \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    test "$wait_state" != healthy || return 0
    test "$wait_state" != exited || return 1
    wait_attempt=$((wait_attempt + 1))
    sleep 2
  done
  return 1
}

exec 9>/run/lock/listener-account-production.lock
flock -n 9 || fail 'another Listener Account production activation is active'
private_file "$listener_env" 'Listener production environment'
private_file "$bundle" 'Listener Account production bundle'
private_file "$account_deploy" 'Account deployment coordinates'
expected_schema=$(sed -n 's/^BEACON_ACCOUNT_SCHEMA_VERSION=//p' "$account_deploy" | tail -n 1 | tr -d '\r')
printf '%s\n' "$expected_schema" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' ||
  fail 'Account schema coordinate is invalid'
test "$(git -C "$root" rev-parse HEAD)" = "$expected_sha" || fail 'release checkout SHA mismatch'
test -z "$(git -C "$root" status --porcelain)" || fail 'release checkout is dirty'
docker image inspect "$image" >/dev/null 2>&1 || fail 'exact candidate image is missing'
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$expected_sha" || fail 'candidate image provenance mismatch'
baked_schema=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_DATABASE_SCHEMA_VERSION=//p' | tail -n 1)
test "$baked_schema" = "$expected_schema" || fail 'candidate image schema provenance mismatch'

current_state=$(docker inspect earlybirds-preview-listener-1 \
  --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
test "$current_state" = 'true|healthy' || fail 'current production Listener is not healthy'
previous_image=$(docker inspect earlybirds-preview-listener-1 --format '{{.Config.Image}}')
case "$previous_image" in
  harmonic-beacon/earlybirds-preview-listener:[0-9a-f][0-9a-f]*) ;;
  *) fail 'previous Listener image reference is invalid' ;;
esac
docker image inspect "$previous_image" >/dev/null 2>&1 || fail 'previous Listener image is missing'
previous_sha=$(docker inspect earlybirds-preview-listener-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
printf '%s\n' "$previous_sha" | grep -Eq '^[0-9a-f]{40}$' || fail 'previous Listener provenance is invalid'
test "$previous_image" = "harmonic-beacon/earlybirds-preview-listener:$previous_sha" ||
  fail 'previous Listener image tag and provenance differ'
previous_schema=$(sed -n 's/^EARLYBIRDS_PREVIEW_SCHEMA_VERSION=//p' "$listener_env" | tail -n 1 | tr -d '\r')
printf '%s\n' "$previous_schema" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' ||
  fail 'previous Listener schema provenance is invalid'
previous_account_mode=$(sed -n 's/^BEACON_LISTENER_ACCOUNT_ENABLED=//p' "$listener_env" | tail -n 1 | tr -d '\r')
case "$previous_account_mode" in
  ''|0) previous_account_mode=0 ;;
  1) ;;
  *) fail 'previous Listener Account mode is invalid' ;;
esac
test "$previous_image" != "$image" || fail 'candidate is already running'

# This is intentionally before every persistent write and runtime mutation.
# It proves the public Account issuer and the exact dedicated RP credential.
"$root/scripts/listener-account-production/preflight.sh" "$expected_sha"

if test -e "$state_root"; then
  test -d "$state_root" && test ! -L "$state_root" || fail 'state root must be a regular directory'
  test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:700 ||
    fail 'state root must be root:root mode 0700'
else
  install -d -o root -g root -m 0700 "$state_root"
fi
test ! -e "$state" || fail 'activation state already exists'
install -d -o root -g root -m 0700 "$state"
install -o root -g root -m 0600 "$listener_env" "$state/previous.env"
printf '%s\n' "$previous_image" > "$state/previous-image.txt"
printf '%s\n' "$previous_sha" > "$state/previous-sha.txt"
printf '%s\n' "$previous_schema" > "$state/previous-schema.txt"
printf '%s\n' "$previous_account_mode" > "$state/previous-account-mode.txt"
printf '%s\n' "$image" > "$state/candidate-image.txt"
chmod 0600 "$state/previous-image.txt" "$state/previous-sha.txt" \
  "$state/previous-schema.txt" "$state/previous-account-mode.txt" "$state/candidate-image.txt"
write_protected_environment "$listener_env" "$state/protected-env.before"
write_protected_containers "$state/protected-containers.before"

docker run --rm --pull never --network none --read-only --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$listener_env,dst=/run/listener.env,readonly" \
  --mount "type=bind,src=$bundle,dst=/run/account.env,readonly" \
  --mount "type=bind,src=$state,dst=/run/state" \
  --entrypoint node "$image" /app/scripts/listener-account-production/activate-env.mjs \
  /run/listener.env /run/account.env /run/state/candidate.env \
  "$expected_sha" "$build_time" "$expected_schema"
private_file "$state/candidate.env" 'candidate Listener environment'

. "$root/scripts/early-birds-preview/lib.sh"
candidate_images=$(preview_compose_command "$state/candidate.env" config --images)
printf '%s\n' "$candidate_images" | grep -Fxq "$image" || fail 'Compose does not select the exact candidate image'

cutover_started=0
rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$cutover_started" -eq 1; then
    echo 'Listener production Account activation failed; restoring prior env and image.' >&2
    temporary="${listener_env}.rollback-$$"
    install -o root -g root -m 0600 "$state/previous.env" "$temporary" || true
    mv -T "$temporary" "$listener_env" || true
    preview_compose_command "$listener_env" up -d --no-deps --force-recreate --no-build listener || true
    wait_healthy || true
    "$root/scripts/listener-account-production/health-smoke.sh" \
      "$previous_sha" "$previous_account_mode" "$previous_schema" || true
  elif test "$status" -ne 0; then
    rm -rf "$state"
  fi
  exit "$status"
}
trap rollback_on_failure EXIT
trap 'exit 130' HUP INT TERM

temporary="${listener_env}.activate-$$"
cutover_started=1
install -o root -g root -m 0600 "$state/candidate.env" "$temporary"
mv -T "$temporary" "$listener_env"
rm -f "$state/candidate.env"
preview_compose_command "$listener_env" up -d --no-deps --force-recreate --no-build listener
wait_healthy || fail 'Listener did not become healthy'

running_image=$(docker inspect earlybirds-preview-listener-1 --format '{{.Config.Image}}')
test "$running_image" = "$image" || fail 'running Listener image mismatch'
running_sha=$(docker inspect earlybirds-preview-listener-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$running_sha" = "$expected_sha" || fail 'running Listener SHA mismatch'
"$root/scripts/listener-account-production/health-smoke.sh" \
  "$expected_sha" 1 "$expected_schema"
docker inspect earlybirds-preview-listener-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' > "$state/runtime-after.env"
chmod 0600 "$state/runtime-after.env"
write_protected_environment "$state/runtime-after.env" "$state/protected-env.after"
rm -f "$state/runtime-after.env"
cmp -s "$state/protected-env.before" "$state/protected-env.after" ||
  fail 'payments, stream or authority environment changed during Account activation'
write_protected_containers "$state/protected-containers.after"
cmp -s "$state/protected-containers.before" "$state/protected-containers.after" ||
  fail 'protected Listener dependencies changed during Account activation'

{
  printf 'activated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'candidate_sha=%s\n' "$expected_sha"
  printf 'candidate_schema=%s\n' "$expected_schema"
  printf 'previous_sha=%s\n' "$previous_sha"
  printf 'previous_account_mode=%s\n' "$previous_account_mode"
  printf 'listener_health=pass\n'
  printf 'account_preflight=pass\n'
  printf 'public_login=pass\n'
  printf 'protected_runtime=unchanged\n'
} > "$state/result.txt"
chmod 0600 "$state/result.txt"
(cd "$state" && sha256sum previous.env previous-image.txt previous-sha.txt previous-schema.txt \
  previous-account-mode.txt \
  candidate-image.txt protected-env.before protected-env.after protected-containers.before \
  protected-containers.after result.txt > SHA256SUMS)
chmod 0600 "$state/SHA256SUMS"
last_activation_temporary="$state_root/last-activation.tmp-$$"
printf '%s\n' "$state" > "$last_activation_temporary"
chmod 0600 "$last_activation_temporary"
mv -T "$last_activation_temporary" "$state_root/last-activation"

cutover_started=0
trap - EXIT HUP INT TERM
echo "Listener production Account RP is healthy at exact SHA $expected_sha."
echo "Rollback state: $state"
