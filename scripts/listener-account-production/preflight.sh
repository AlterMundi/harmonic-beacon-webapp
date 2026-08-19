#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }

expected_sha=${1:?usage: preflight.sh exact-sha40}
case "$expected_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }
image="harmonic-beacon/earlybirds-preview-listener:$expected_sha"
bundle=/etc/harmonic-beacon/listener-account-production.env

test -f "$bundle" && test ! -L "$bundle" || { echo 'Listener production Account bundle is absent' >&2; exit 2; }
test "$(stat -c '%U:%G:%a' "$bundle")" = root:root:600 || {
  echo 'Listener production Account bundle must be root:root mode 0600' >&2; exit 2;
}
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$expected_sha" || { echo 'candidate image provenance mismatch' >&2; exit 2; }
network_internal=$(docker network inspect earlybirds_preview_listener_egress --format '{{.Internal}}' 2>/dev/null || true)
test "$network_internal" = false || { echo 'Listener egress network is unavailable' >&2; exit 2; }

docker run --rm --pull never --network earlybirds_preview_listener_egress --read-only --user 0:0 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$bundle,dst=/run/listener-account-production.env,readonly" \
  --entrypoint node "$image" /app/scripts/listener-account-production/preflight.mjs
