#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

test "$(id -u)" -eq 0 || account_fail 'run as root'
rollback_state=${1:?usage: rollback-social-provider.sh /var/lib/harmonic-beacon/account-social-providers/environment-provider-sha-timestamp /secure/deploy.env}
ACCOUNT_DEPLOY_FILE=${2:?usage: rollback-social-provider.sh state /secure/deploy.env}
export ACCOUNT_DEPLOY_FILE
case "$rollback_state" in /var/lib/harmonic-beacon/account-social-providers/*) ;; *) account_fail 'unexpected provider rollback state path' ;; esac
test -d "$rollback_state" && test ! -L "$rollback_state" || account_fail 'provider rollback state must be a regular directory'
test "$(stat -c '%U:%G:%a' "$rollback_state")" = root:root:700 || account_fail 'provider rollback state must be root:root 0700'
for file in previous.env environment.txt provider.txt sha.txt app-id.before worker-id.before \
  database-id.before database-backup.txt database-backup.sha256 result.txt SHA256SUMS; do
  test -f "$rollback_state/$file" && test ! -L "$rollback_state/$file" || account_fail 'provider rollback state is incomplete'
  test "$(stat -c '%U:%G:%a' "$rollback_state/$file")" = root:root:600 || account_fail 'provider rollback state file must be root:root 0600'
done
(cd "$rollback_state" && sha256sum -c SHA256SUMS >/dev/null)

environment=$(cat "$rollback_state/environment.txt")
provider=$(cat "$rollback_state/provider.txt")
expected_sha=$(cat "$rollback_state/sha.txt")
case "$environment" in staging|production) ;; *) account_fail 'rollback environment is invalid' ;; esac
case "$provider" in google|apple) ;; *) account_fail 'rollback provider is invalid' ;; esac
echo "$expected_sha" | grep -Eq '^[0-9a-f]{40}$' || account_fail 'rollback SHA is invalid'
account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
test "$BEACON_ACCOUNT_GIT_SHA" = "$expected_sha" || account_fail 'deploy coordinates differ from rollback SHA'
account_env=$BEACON_ACCOUNT_STAGING_ENV_FILE
test "$environment" != production || account_env=$BEACON_ACCOUNT_PRODUCTION_ENV_FILE
container=$(account_container_name "$environment")
worker=$(account_mail_worker_container_name "$environment")
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "harmonic-beacon/account:$expected_sha" ||
  account_fail 'running Account image differs from rollback state'
upper=$(printf '%s' "$provider" | tr '[:lower:]' '[:upper:]')
grep -Fxq "BEACON_ACCOUNT_${upper}_ENABLED=1" "$account_env" || account_fail 'target provider is not currently enabled'

exec 9>"/run/lock/beacon-account-$environment.lock"
flock -n 9 || account_fail "another $environment Account operation is active"
temporary="${account_env}.rollback-$$"
trap 'rm -f "$temporary"' EXIT
trap '' HUP INT TERM
install -o root -g root -m 0600 "$rollback_state/previous.env" "$temporary"
mv -T "$temporary" "$account_env"
account_compose up -d --no-deps --force-recreate --no-build "account-$environment"
account_wait_healthy "$container"
account_verify_running "$environment" "$expected_sha" "$expected_sha" 1
"$(account_repo_root)/scripts/beacon-account/health-smoke.sh" \
  "$environment" "$ACCOUNT_DEPLOY_FILE" "$expected_sha" 1 1
test "$(docker inspect "$worker" --format '{{.Id}}')" = "$(cat "$rollback_state/worker-id.before")" ||
  account_fail 'mail worker changed during provider rollback'
trap - EXIT HUP INT TERM
echo "Beacon Account $provider in $environment was restored to its pre-activation state; identities and sessions were retained."
