#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
state=${1:?usage: rollback.sh /var/lib/harmonic-beacon/listener-account-production/activation-*}
case "$state" in
  /var/lib/harmonic-beacon/listener-account-production/activation-*) ;;
  *) echo 'unexpected rollback state path' >&2; exit 2 ;;
esac
test -d "$state" && test ! -L "$state" || { echo 'rollback state must be a regular directory' >&2; exit 2; }
test "$(stat -c '%U:%G:%a' "$state")" = root:root:700 || {
  echo 'rollback state must be root:root mode 0700' >&2; exit 2;
}
for file in previous.env previous-image.txt previous-sha.txt previous-schema.txt previous-account-mode.txt \
  candidate-image.txt protected-env.before protected-env.after \
  protected-containers.before protected-containers.after result.txt SHA256SUMS; do
  test -f "$state/$file" && test ! -L "$state/$file" || { echo 'rollback state is incomplete' >&2; exit 2; }
  test "$(stat -c '%U:%G:%a' "$state/$file")" = root:root:600 || {
    echo 'rollback state file must be root:root mode 0600' >&2; exit 2;
  }
done
(cd "$state" && sha256sum -c SHA256SUMS >/dev/null)

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
listener_env=/etc/harmonic-beacon/earlybirds-preview.env
previous_image=$(sed -n '1p' "$state/previous-image.txt")
previous_sha=$(sed -n '1p' "$state/previous-sha.txt")
previous_schema=$(sed -n '1p' "$state/previous-schema.txt")
previous_account_mode=$(sed -n '1p' "$state/previous-account-mode.txt")
candidate_image=$(sed -n '1p' "$state/candidate-image.txt")
test "$previous_image" = "harmonic-beacon/earlybirds-preview-listener:$previous_sha" || {
  echo 'previous image provenance is inconsistent' >&2; exit 2;
}
case "$candidate_image" in
  harmonic-beacon/earlybirds-preview-listener:[0-9a-f][0-9a-f]*) ;;
  *) echo 'candidate image reference is invalid' >&2; exit 2 ;;
esac
candidate_sha=${candidate_image#harmonic-beacon/earlybirds-preview-listener:}
printf '%s\n' "$candidate_sha" | grep -Eq '^[0-9a-f]{40}$' || {
  echo 'candidate image SHA is invalid' >&2; exit 2;
}
printf '%s\n' "$previous_schema" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' || {
  echo 'previous schema provenance is invalid' >&2; exit 2;
}
case "$previous_account_mode" in
  0|1) ;;
  *) echo 'previous Listener Account mode is invalid' >&2; exit 2 ;;
esac
test "$(docker inspect earlybirds-preview-listener-1 --format '{{.Config.Image}}')" = "$candidate_image" || {
  echo 'running Listener does not match this rollback candidate' >&2; exit 2;
}
docker image inspect "$previous_image" >/dev/null 2>&1 || { echo 'previous image is missing' >&2; exit 2; }

exec 9>/run/lock/listener-account-production.lock
flock -n 9 || { echo 'another Listener Account production operation is active' >&2; exit 2; }
temporary="${listener_env}.rollback-$$"
trap 'rm -f "$temporary"' EXIT
# Once the rollback env replacement begins, finish restoring the exact prior
# app instead of accepting a half-applied operator interrupt.
trap '' HUP INT TERM
install -o root -g root -m 0600 "$state/previous.env" "$temporary"
mv -T "$temporary" "$listener_env"

. "$root/scripts/early-birds-preview/lib.sh"
test "$(preview_env_value EARLYBIRDS_PREVIEW_IMAGE_TAG "$listener_env")" = "$previous_sha" || {
  echo 'restored env image tag mismatch' >&2; exit 2;
}
test "$(preview_env_value EARLYBIRDS_PREVIEW_GIT_SHA "$listener_env")" = "$previous_sha" || {
  echo 'restored env SHA mismatch' >&2; exit 2;
}
test "$(preview_env_value EARLYBIRDS_PREVIEW_SCHEMA_VERSION "$listener_env")" = "$previous_schema" || {
  echo 'restored env schema mismatch' >&2; exit 2;
}
preview_compose_command "$listener_env" up -d --no-deps --force-recreate --no-build listener
attempt=0
while test "$attempt" -lt 60; do
  health=$(docker inspect earlybirds-preview-listener-1 \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  test "$health" != healthy || break
  attempt=$((attempt + 1))
  sleep 2
done
test "$health" = healthy || { echo 'restored Listener did not become healthy' >&2; exit 2; }
test "$(docker inspect earlybirds-preview-listener-1 --format '{{.Config.Image}}')" = "$previous_image" || {
  echo 'restored Listener image mismatch' >&2; exit 2;
}
running_sha=$(docker inspect earlybirds-preview-listener-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$running_sha" = "$previous_sha" || { echo 'restored Listener SHA mismatch' >&2; exit 2; }
"$root/scripts/listener-account-production/health-smoke.sh" \
  "$previous_sha" "$previous_account_mode" "$previous_schema"
trap - EXIT HUP INT TERM
echo "Listener production restored to exact SHA $previous_sha; database was not downgraded."
