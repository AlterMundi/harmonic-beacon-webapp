#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

test "$(id -u)" -eq 0 || account_fail 'run as root'
environment=${1:?usage: activate-social-provider.sh staging|production google|apple /secure/deploy.env}
provider=${2:?usage: activate-social-provider.sh staging|production google|apple /secure/deploy.env}
ACCOUNT_DEPLOY_FILE=${3:?usage: activate-social-provider.sh staging|production google|apple /secure/deploy.env}
export ACCOUNT_DEPLOY_FILE
case "$environment" in staging|production) ;; *) account_fail 'environment must be staging or production' ;; esac
case "$provider" in google|apple) ;; *) account_fail 'provider must be google or apple' ;; esac

account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
root=$(account_repo_root)
image="harmonic-beacon/account:$BEACON_ACCOUNT_GIT_SHA"
account_env=$BEACON_ACCOUNT_STAGING_ENV_FILE
test "$environment" != production || account_env=$BEACON_ACCOUNT_PRODUCTION_ENV_FILE
bundle="/etc/harmonic-beacon/account-provider-$environment-$provider.env"
state_root=/var/lib/harmonic-beacon/account-social-providers
stamp=$(date -u +%Y%m%dT%H%M%SZ)
activation_state="$state_root/$environment-$provider-$BEACON_ACCOUNT_GIT_SHA-$stamp"
container=$(account_container_name "$environment")
worker=$(account_mail_worker_container_name "$environment")
database_container=beacon-account-account-staging-postgres-1
test "$environment" != production || database_container=earlybirds-preview-postgres-1

exec 9>"/run/lock/beacon-account-$environment.lock"
flock -n 9 || account_fail "another $environment Account operation is active"
account_require_private_file "$bundle"
test "$(git -C "$root" rev-parse HEAD)" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'release checkout SHA mismatch'
test -z "$(git -C "$root" status --porcelain)" || account_fail 'release checkout is dirty'
docker image inspect "$image" >/dev/null 2>&1 || account_fail 'exact Account image is missing'
baked_sha=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
  sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'Account image provenance mismatch'
account_verify_running "$environment" "$BEACON_ACCOUNT_GIT_SHA" "$BEACON_ACCOUNT_IMAGE_TAG" 1
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "$image" || account_fail 'running Account image mismatch'

if test -e "$state_root"; then
  test -d "$state_root" && test ! -L "$state_root" || account_fail 'provider state root must be a regular directory'
  test "$(stat -c '%U:%G:%a' "$state_root")" = root:root:700 || account_fail 'provider state root must be root:root 0700'
else
  install -d -o root -g root -m 0700 "$state_root"
fi
test ! -e "$activation_state" || account_fail 'provider activation state already exists'
install -d -o root -g root -m 0700 "$activation_state"
install -o root -g root -m 0600 "$account_env" "$activation_state/previous.env"
printf '%s\n' "$environment" > "$activation_state/environment.txt"
printf '%s\n' "$provider" > "$activation_state/provider.txt"
printf '%s\n' "$BEACON_ACCOUNT_GIT_SHA" > "$activation_state/sha.txt"
docker inspect "$container" --format '{{.Id}}' > "$activation_state/app-id.before"
docker inspect "$worker" --format '{{.Id}}' > "$activation_state/worker-id.before"
docker inspect "$database_container" --format '{{.Id}}' > "$activation_state/database-id.before"
chmod 0600 "$activation_state"/*.txt "$activation_state"/*.before

cleanup_before_cutover() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0; then rm -rf "$activation_state"; fi
  exit "$status"
}
trap cleanup_before_cutover EXIT HUP INT TERM

if test "$environment" = production; then
  backup=$(account_backup_production)
else
  backup=$(account_backup_staging)
fi
printf '%s\n' "$backup" > "$activation_state/database-backup.txt"
sha256sum "$backup" | awk '{print $1}' > "$activation_state/database-backup.sha256"
chmod 0600 "$activation_state/database-backup.txt"
chmod 0600 "$activation_state/database-backup.sha256"

docker run --rm --pull never --network none --read-only --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$account_env,dst=/run/account.env,readonly" \
  --mount "type=bind,src=$bundle,dst=/run/provider.env,readonly" \
  --mount "type=bind,src=$activation_state,dst=/run/state" \
  --entrypoint node "$image" /app/scripts/beacon-account/social-provider-env.mjs \
    /run/account.env /run/provider.env /run/state/candidate.env "$environment" "$provider"
account_require_private_file "$activation_state/candidate.env"

production_candidate=$BEACON_ACCOUNT_PRODUCTION_ENV_FILE
staging_candidate=$BEACON_ACCOUNT_STAGING_ENV_FILE
test "$environment" != production || production_candidate=$activation_state/candidate.env
test "$environment" != staging || staging_candidate=$activation_state/candidate.env
docker run --rm --pull never --network none --read-only --cap-drop ALL --user 0:0 \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$production_candidate,dst=/run/account-production.env,readonly" \
  --mount "type=bind,src=$staging_candidate,dst=/run/account-staging.env,readonly" \
  --mount "type=bind,src=$BEACON_ACCOUNT_STAGING_DB_ENV_FILE,dst=/run/account-staging-database.env,readonly" \
  --mount "type=bind,src=$BEACON_ACCOUNT_MAIL_WORKER_PRODUCTION_ENV_FILE,dst=/run/account-mail-worker-production.env,readonly" \
  --mount "type=bind,src=$BEACON_ACCOUNT_MAIL_WORKER_STAGING_ENV_FILE,dst=/run/account-mail-worker-staging.env,readonly" \
  --entrypoint node "$image" /app/ops/beacon-account/validate.mjs \
    /run/account-production.env /run/account-staging.env /run/account-staging-database.env \
    /run/account-mail-worker-production.env /run/account-mail-worker-staging.env

cutover_started=0
rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$cutover_started" -eq 1; then
    echo 'Beacon Account provider activation failed; restoring the previous environment.' >&2
    temporary="${account_env}.rollback-$$"
    install -o root -g root -m 0600 "$activation_state/previous.env" "$temporary" || true
    mv -T "$temporary" "$account_env" || true
    account_compose up -d --no-deps --force-recreate --no-build "account-$environment" || true
    account_wait_healthy "$container" || true
  elif test "$status" -ne 0; then
    rm -rf "$activation_state"
  fi
  exit "$status"
}
trap rollback_on_failure EXIT
trap 'exit 130' HUP INT TERM

temporary="${account_env}.provider-$$"
cutover_started=1
install -o root -g root -m 0600 "$activation_state/candidate.env" "$temporary"
mv -T "$temporary" "$account_env"
rm -f "$activation_state/candidate.env"
account_compose up -d --no-deps --force-recreate --no-build "account-$environment"
account_wait_healthy "$container"
account_verify_running "$environment" "$BEACON_ACCOUNT_GIT_SHA" "$BEACON_ACCOUNT_IMAGE_TAG" 1
"$root/scripts/beacon-account/health-smoke.sh" \
  "$environment" "$ACCOUNT_DEPLOY_FILE" "$BEACON_ACCOUNT_GIT_SHA" 1 1
test "$(docker inspect "$worker" --format '{{.Id}}')" = "$(cat "$activation_state/worker-id.before")" ||
  account_fail 'mail worker changed during provider activation'
test "$(docker inspect "$database_container" --format '{{.Id}}')" = "$(cat "$activation_state/database-id.before")" ||
  account_fail 'database changed during provider activation'

origin=https://account.harmonicbeacon.com
test "$environment" != staging || origin=https://account-staging.harmonicbeacon.com
page="$activation_state/account-page.html"
curl --fail --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  -H 'Accept-Language: en' "$origin/account?lang=en" > "$page"
label='Continue with Google'
test "$provider" != apple || label='Continue with Apple'
grep -Fq "$label" "$page" || account_fail 'enabled provider is absent from the Account page'
grep -Fq 'Sign in' "$page" || account_fail 'email and password sign-in is absent from the Account page'
rm -f "$page"

{
  printf 'activated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'environment=%s\n' "$environment"
  printf 'provider=%s\n' "$provider"
  printf 'sha=%s\n' "$BEACON_ACCOUNT_GIT_SHA"
  printf 'database_backup=%s\n' "$backup"
  printf 'readiness=pass\nprovider_ui=pass\nmail_worker=unchanged\n'
} > "$activation_state/result.txt"
chmod 0600 "$activation_state/result.txt"
(cd "$activation_state" && sha256sum previous.env environment.txt provider.txt sha.txt app-id.before \
  worker-id.before database-id.before database-backup.txt database-backup.sha256 result.txt > SHA256SUMS)
chmod 0600 "$activation_state/SHA256SUMS"
last_tmp="$state_root/last-activation.tmp-$$"
printf '%s\n' "$activation_state" > "$last_tmp"
chmod 0600 "$last_tmp"
mv -T "$last_tmp" "$state_root/last-activation"

cutover_started=0
trap - EXIT HUP INT TERM
echo "Beacon Account $provider is enabled and healthy in $environment at exact SHA $BEACON_ACCOUNT_GIT_SHA."
echo "Rollback state: $activation_state"
