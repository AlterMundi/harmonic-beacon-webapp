#!/usr/bin/env sh
set -eu

expected_sha=${1:?usage: prepare.sh exact-sha40}
case "$expected_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }

image="harmonic-beacon/earlybirds-preview-listener:$expected_sha"
account_env=/etc/harmonic-beacon/account.production.env
listener_env=/etc/harmonic-beacon/earlybirds-preview.env
target=/etc/harmonic-beacon/listener-account-production.env
target_directory=/etc/harmonic-beacon
work=$(mktemp -d /run/listener-account-production.XXXXXX)
cleanup() { rm -rf "$work"; }
trap cleanup EXIT HUP INT TERM
umask 077

test -d "$target_directory" && test ! -L "$target_directory" || {
  echo 'Harmonic Beacon secret directory is not a regular directory' >&2; exit 2;
}
test "$(stat -c '%U:%G:%a' "$target_directory")" = root:root:700 || {
  echo 'Harmonic Beacon secret directory must be root:root mode 0700' >&2; exit 2;
}

for source in "$account_env" "$listener_env"; do
  test -f "$source" && test ! -L "$source" || { echo 'required production env is not a regular file' >&2; exit 2; }
  test "$(stat -c '%U:%G:%a' "$source")" = root:root:600 || {
    echo 'required production env must be root:root mode 0600' >&2; exit 2;
  }
done
if test -e "$target"; then
  test -f "$target" && test ! -L "$target" || { echo 'current Account bundle is not a regular file' >&2; exit 2; }
  test "$(stat -c '%U:%G:%a' "$target")" = root:root:600 || {
    echo 'current Account bundle must be root:root mode 0600' >&2; exit 2;
  }
  install -o root -g root -m 0600 "$target" "$work/current.env"
fi

docker image inspect "$image" >/dev/null
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$expected_sha" || { echo 'candidate image provenance mismatch' >&2; exit 2; }

docker run --rm --pull never --network none --read-only --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$account_env,dst=/run/account-production.env,readonly" \
  --mount "type=bind,src=$listener_env,dst=/run/listener-production.env,readonly" \
  --mount "type=bind,src=$work,dst=/run/work" \
  --entrypoint node "$image" /app/scripts/listener-account-production/sync-secret.mjs

test -f "$work/candidate.env" && test ! -L "$work/candidate.env" || {
  echo 'candidate Account bundle was not produced' >&2; exit 2;
}
test "$(stat -c '%a' "$work/candidate.env")" = 600 || {
  echo 'candidate Account bundle mode mismatch' >&2; exit 2;
}
temporary="${target}.tmp-$$"
trap 'rm -f "$temporary"; cleanup' EXIT HUP INT TERM
install -o root -g root -m 0600 "$work/candidate.env" "$temporary"
mv -T "$temporary" "$target"
trap cleanup EXIT HUP INT TERM
test "$(stat -c '%U:%G:%a' "$target")" = root:root:600 || {
  echo 'installed Account bundle ownership mismatch' >&2; exit 2;
}
echo 'Listener production Account bundle installed dormant; runtime and feature flag were not changed.'
