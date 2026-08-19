#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
expected_sha=${1:?usage: prepare-account.sh exact-live-sha40}
case "$expected_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
image="harmonic-beacon/app:$expected_sha"
authority=/etc/harmonic-beacon/account.production.env
target_dir=/etc/harmonic-beacon/live-production-secrets
target="$target_dir/account.env"

fail() { echo "Live production Account preparation: $*" >&2; exit 2; }
private_file() {
  test -f "$1" && test ! -L "$1" || fail "$2 must be a regular file"
  test "$(stat -c '%U:%G:%a' "$1")" = root:root:600 || fail "$2 must be root:root mode 0600"
}
env_value() {
  key=$1
  file=$2
  test "$(grep -c "^${key}=" "$file")" -eq 1 || fail "$key must occur exactly once"
  sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '\r'
}

exec 9>/run/lock/live-account-production.lock
flock -n 9 || fail 'another Live production Account operation is active'

test "$(git -C "$root" rev-parse HEAD)" = "$expected_sha" || fail 'release checkout SHA mismatch'
test -z "$(git -C "$root" status --porcelain)" || fail 'release checkout is dirty'
private_file "$authority" 'Account production environment'
docker image inspect "$image" >/dev/null 2>&1 || fail 'exact Live image is missing'
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$expected_sha" || fail 'Live image provenance mismatch'
if docker inspect beacon-app >/dev/null 2>&1; then
  running_account=$(docker inspect beacon-app --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_ACCOUNT_ENABLED=//p' | tail -n 1 | tr -d '\r')
  test "$running_account" != true || fail 'Account is already active; use a separately reviewed credential rotation'
fi

if test -e "$target_dir"; then
  test -d "$target_dir" && test ! -L "$target_dir" || fail 'target must be a regular directory'
  test "$(stat -c '%U:%G:%a' "$target_dir")" = root:root:700 ||
    fail 'target directory must be root:root mode 0700'
else
  install -d -o root -g root -m 0700 "$target_dir"
fi
test "$(env_value BEACON_ACCOUNT_BASE_URL "$authority")" = https://account.harmonicbeacon.com || fail 'authority issuer mismatch'
test "$(env_value BEACON_ACCOUNT_RUNTIME "$authority")" = 1 || fail 'authority runtime is not enabled'
test -z "$(env_value BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE_STAGING "$authority")" || fail 'production authority carries staging Live material'
authority_secret=$(env_value BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE "$authority")
test "${#authority_secret}" -ge 32 || fail 'authority client secret is too short'
case "$authority_secret" in *[!A-Za-z0-9._~-]*) fail 'authority client secret has an unsafe character' ;; esac

if test -e "$target"; then
  private_file "$target" 'existing Live production Account bundle'
  test "$(grep -Ec '^[A-Z][A-Z0-9_]*=' "$target")" -eq 4 || fail 'existing bundle key count mismatch'
  test "$(grep -Ec '^(BEACON_ACCOUNT_ENABLED|BEACON_ACCOUNT_ISSUER_URL|BEACON_ACCOUNT_CLIENT_ID|BEACON_ACCOUNT_CLIENT_SECRET)=' "$target")" -eq 4 ||
    fail 'existing bundle contains an unexpected key'
  test "$(env_value BEACON_ACCOUNT_ENABLED "$target")" = true || fail 'existing bundle is not enabled'
  test "$(env_value BEACON_ACCOUNT_ISSUER_URL "$target")" = https://account.harmonicbeacon.com || fail 'existing issuer mismatch'
  test "$(env_value BEACON_ACCOUNT_CLIENT_ID "$target")" = hb-live || fail 'existing client mismatch'
fi

temporary=$(mktemp "$target_dir/.account.env.XXXXXX")
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT HUP INT TERM
{
  printf 'BEACON_ACCOUNT_ENABLED=true\n'
  printf 'BEACON_ACCOUNT_ISSUER_URL=https://account.harmonicbeacon.com\n'
  printf 'BEACON_ACCOUNT_CLIENT_ID=hb-live\n'
  printf 'BEACON_ACCOUNT_CLIENT_SECRET=%s\n' "$authority_secret"
} > "$temporary"
chown root:root "$temporary"
chmod 0600 "$temporary"
mv -T "$temporary" "$target"
trap - EXIT HUP INT TERM
unset authority_secret

private_file "$target" 'Live production Account bundle'
test "$(grep -Ec '^[A-Z][A-Z0-9_]*=' "$target")" -eq 4 || fail 'bundle key count mismatch'
test "$(grep -Ec '^(BEACON_ACCOUNT_ENABLED|BEACON_ACCOUNT_ISSUER_URL|BEACON_ACCOUNT_CLIENT_ID|BEACON_ACCOUNT_CLIENT_SECRET)=' "$target")" -eq 4 || fail 'bundle contains an unexpected key'

echo 'Live production Account app-only bundle is prepared; runtime remains unchanged.'
