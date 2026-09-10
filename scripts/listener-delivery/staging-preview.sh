#!/usr/bin/env sh
set -eu

source_sha=${1:?usage: staging-preview.sh SOURCE_SHA deliver|interrupt|rollback}
mode=${2:?usage: staging-preview.sh SOURCE_SHA deliver|interrupt|rollback}
printf '%s\n' "$source_sha" | grep -Eq '^[0-9a-f]{40}$' || {
  echo 'staging preview requires an exact lowercase sha40' >&2; exit 2;
}
case "$mode" in deliver|interrupt|rollback) ;; *) echo 'unsupported staging checkpoint mode' >&2; exit 2 ;; esac

fixture_root=${LISTENER_DELIVERY_SYNTHETIC_FIXTURE_ROOT:-}
if test -n "$fixture_root"; then
  test "$(id -u)" -ne 0 || { echo 'synthetic fixture mode is forbidden for root' >&2; exit 2; }
  case "$(realpath "$fixture_root")" in /tmp/*) ;; *) echo 'synthetic fixture must be below /tmp' >&2; exit 2 ;; esac
  test -f "$fixture_root/synthetic-listener-preview.fixture.v1" || {
    echo 'synthetic Listener fixture marker is missing' >&2; exit 2;
  }
  test -f "$fixture_root/current-state" || { echo 'synthetic prior preview state is missing' >&2; exit 2; }
  cp "$fixture_root/current-state" "$fixture_root/previous-state"
  cutover_started=0
  restore_fixture() {
    status=$?
    trap - EXIT HUP INT TERM
    if test "$status" -ne 0 && test "$cutover_started" -eq 1; then
      cp "$fixture_root/previous-state" "$fixture_root/current-state"
      rm -f "$fixture_root/candidate-active"
      printf '%s\n' '{"schema_version":"listen-staging-cleanup.v1","restored":true,"candidate_removed":true}' \
        > "$fixture_root/cleanup-proof.json"
    fi
    exit "$status"
  }
  trap restore_fixture EXIT
  trap 'exit 130' HUP INT TERM
  cutover_started=1
  printf 'running|harmonic-beacon/earlybirds-preview-listener:%s|account-off\n' "$source_sha" \
    > "$fixture_root/current-state"
  : > "$fixture_root/candidate-active"
  printf '%s\n' "$source_sha" > "$fixture_root/interruption-checkpoint"
  test "$mode" != interrupt || kill -TERM "$$"
  rm -f "$fixture_root/candidate-active" "$fixture_root/previous-state"
  cutover_started=0
  trap - EXIT HUP INT TERM
  exit 0
fi

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
repository=/srv/harmonic-beacon/early-birds
env_file=/etc/harmonic-beacon/earlybirds-preview-staging.env
candidate_source=/etc/harmonic-beacon/listener-delivery-staging-candidate.env
state_root=/var/lib/harmonic-beacon/listener-delivery/staging
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test "$root" = "$repository" || { echo 'staging adapter must run from the root-owned delivery checkout' >&2; exit 2; }
for protected_env in "$candidate_source"; do
  test -f "$protected_env" && test ! -L "$protected_env" || { echo 'staging candidate env is missing' >&2; exit 2; }
  test "$(stat -c '%U:%G:%a' "$protected_env")" = root:root:600 || {
    echo 'staging candidate env must be root:root mode 0600' >&2; exit 2;
  }
done
if test -e "$env_file"; then
  test -f "$env_file" && test ! -L "$env_file" || { echo 'active staging preview env is unsafe' >&2; exit 2; }
  test "$(stat -c '%U:%G:%a' "$env_file")" = root:root:600 || {
    echo 'active staging preview env must be root:root mode 0600' >&2; exit 2;
  }
fi
. "$repository/scripts/early-birds-preview/lib.sh"
require_synthetic_env "$candidate_source"
test "$(preview_env_value EARLYBIRDS_PREVIEW_GIT_SHA "$candidate_source")" = "$source_sha" || {
  echo 'staging candidate env SHA mismatch' >&2; exit 2;
}
test "$(preview_env_value EARLYBIRDS_PREVIEW_IMAGE_TAG "$candidate_source")" = "$source_sha" || {
  echo 'staging candidate image tag mismatch' >&2; exit 2;
}

install -d -o root -g root -m 0700 "$state_root"
if test "$mode" = rollback; then
  pointer="$state_root/last-attempt"
  test -f "$pointer" && test ! -L "$pointer" || { echo 'staging recovery evidence is absent' >&2; exit 2; }
  state=$(sed -n '1p' "$pointer")
  case "$state" in "$state_root"/attempt-"$source_sha"-*) ;; *) echo 'staging recovery evidence does not match source SHA' >&2; exit 2 ;; esac
  for recovery_file in candidate.env previous-image.txt previous-mode.txt interruption-checkpoint cleanup-status.txt; do
    test -f "$state/$recovery_file" && test ! -L "$state/$recovery_file" || { echo 'staging recovery evidence is incomplete' >&2; exit 2; }
  done
  test "$(sed -n '1p' "$state/interruption-checkpoint")" = "$source_sha" || { echo 'staging checkpoint SHA mismatch' >&2; exit 2; }
  previous_image=$(sed -n '1p' "$state/previous-image.txt")
  if test "$previous_image" = null; then
    "$repository/scripts/early-birds-preview/rollback.sh" "$state/candidate.env"
    if test -f "$state/previous.env"; then
      temporary="${env_file}.rollback-$$"
      install -o root -g root -m 0600 "$state/previous.env" "$temporary"
      mv -T "$temporary" "$env_file"
    else
      rm -f "$env_file"
    fi
  else
    test -f "$state/previous.env" && test ! -L "$state/previous.env" || { echo 'prior staging environment is absent' >&2; exit 2; }
    temporary="${env_file}.rollback-$$"
    install -o root -g root -m 0600 "$state/previous.env" "$temporary"
    mv -T "$temporary" "$env_file"
    preview_compose_command "$env_file" up -d --no-deps --force-recreate --no-build listener
    "$repository/scripts/early-birds-preview/health-smoke.sh" "$env_file"
  fi
  printf '%s\n' proved > "$state/cleanup-status.txt"
  chmod 0600 "$state/cleanup-status.txt"
  echo "Synthetic Listener staging preview recovery succeeded for SHA $source_sha."
  exit 0
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
state="$state_root/attempt-$source_sha-$stamp"
install -d -o root -g root -m 0700 "$state"
install -o root -g root -m 0600 "$candidate_source" "$state/candidate.env"
had_previous_env=0
if test -f "$env_file"; then
  install -o root -g root -m 0600 "$env_file" "$state/previous.env"
  had_previous_env=1
fi
prior_running=$(docker inspect earlybirds-preview-listener-1 --format '{{.State.Running}}' 2>/dev/null || true)
previous_image=null
previous_mode=stopped
if test "$prior_running" = true; then
  test "$had_previous_env" -eq 1 || { echo 'running staging Listener has no active env evidence' >&2; exit 2; }
  previous_image=$(docker inspect earlybirds-preview-listener-1 --format '{{.Config.Image}}')
  previous_sha=${previous_image#harmonic-beacon/earlybirds-preview-listener:}
  printf '%s\n' "$previous_sha" | grep -Eq '^[0-9a-f]{40}$' || {
    echo 'prior staging Listener image is not an exact SHA image' >&2; exit 2;
  }
  test "$(preview_env_value EARLYBIRDS_PREVIEW_GIT_SHA "$state/previous.env")" = "$previous_sha" || {
    echo 'prior staging env SHA does not match the running image' >&2; exit 2;
  }
  test "$(preview_env_value EARLYBIRDS_PREVIEW_IMAGE_TAG "$state/previous.env")" = "$previous_sha" || {
    echo 'prior staging env tag does not match the running image' >&2; exit 2;
  }
  docker image inspect "$previous_image" >/dev/null 2>&1 || { echo 'prior staging image is unavailable' >&2; exit 2; }
  running_mode=$(docker inspect earlybirds-preview-listener-1 --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_LISTENER_ACCOUNT_ENABLED=//p' | tail -n 1)
  case "$running_mode" in 1) previous_mode=account-on ;; ''|0) previous_mode=account-off ;; *) previous_mode=unknown ;; esac
fi
printf '%s\n' "$previous_image" > "$state/previous-image.txt"
printf '%s\n' "$previous_mode" > "$state/previous-mode.txt"
chmod 0600 "$state/previous-image.txt" "$state/previous-mode.txt"

cutover_started=0
restore_preview() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$cutover_started" -eq 1; then
    cleanup_status=failed
    if test "$prior_running" = true; then
      temporary="${env_file}.interrupt-rollback-$$"
      if install -o root -g root -m 0600 "$state/previous.env" "$temporary" &&
         mv -T "$temporary" "$env_file" &&
         preview_compose_command "$env_file" up -d --no-deps --force-recreate --no-build listener &&
         "$repository/scripts/early-birds-preview/health-smoke.sh" "$env_file"; then
        cleanup_status=proved
      fi
    elif "$repository/scripts/early-birds-preview/rollback.sh" "$state/candidate.env"; then
      restore_env_status=0
      if test "$had_previous_env" -eq 1; then
        temporary="${env_file}.interrupt-rollback-$$"
        install -o root -g root -m 0600 "$state/previous.env" "$temporary" && mv -T "$temporary" "$env_file" || restore_env_status=1
      else
        rm -f "$env_file" || restore_env_status=1
      fi
      test "$restore_env_status" -ne 0 || cleanup_status=proved
    fi
    printf '%s\n' "$cleanup_status" > "$state/cleanup-status.txt"
    chmod 0600 "$state/cleanup-status.txt"
    printf '%s\n' "$state" > "$state_root/last-attempt.tmp-$$"
    chmod 0600 "$state_root/last-attempt.tmp-$$"
    mv -T "$state_root/last-attempt.tmp-$$" "$state_root/last-attempt"
  fi
  exit "$status"
}
trap restore_preview EXIT
trap 'exit 130' HUP INT TERM
cutover_started=1
"$repository/scripts/early-birds-preview/start.sh" "$state/candidate.env"
"$repository/scripts/early-birds-preview/health-smoke.sh" "$state/candidate.env"
temporary="${env_file}.activate-$$"
install -o root -g root -m 0600 "$state/candidate.env" "$temporary"
mv -T "$temporary" "$env_file"
printf '%s\n' "$source_sha" > "$state/interruption-checkpoint"
chmod 0600 "$state/interruption-checkpoint"
# A deterministic future staging drill selects interrupt; the already-armed
# signal trap restores the exact prior preview and records cleanup status.
test "$mode" != interrupt || kill -TERM "$$"
printf '%s\n' captured > "$state/cleanup-status.txt"
chmod 0600 "$state/cleanup-status.txt"
printf '%s\n' "$state" > "$state_root/last-attempt.tmp-$$"
chmod 0600 "$state_root/last-attempt.tmp-$$"
mv -T "$state_root/last-attempt.tmp-$$" "$state_root/last-attempt"
cutover_started=0
trap - EXIT HUP INT TERM
echo "Synthetic Listener staging preview is healthy at exact SHA $source_sha."
