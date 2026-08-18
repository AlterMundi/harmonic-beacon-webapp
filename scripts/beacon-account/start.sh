#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

environment=${1:?usage: start.sh staging|production /secure/deploy.env}
ACCOUNT_DEPLOY_FILE=${2:?usage: start.sh staging|production /secure/deploy.env}
export ACCOUNT_DEPLOY_FILE
case "$environment" in production|staging) ;; *) account_fail 'environment must be production or staging' ;; esac

account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
exec 9>"/run/lock/beacon-account-$environment.lock"
flock -n 9 || account_fail "another $environment deployment is active"
account_require_internal_mail_network "$environment"
root=$(account_repo_root)
test "$(git -C "$root" rev-parse HEAD)" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'release checkout SHA mismatch'
test -z "$(git -C "$root" status --porcelain)" || account_fail 'release checkout is dirty'
previous_sha=$(account_capture_previous_runtime "$environment")
previous_worker_present=$(account_capture_previous_worker "$environment" "$previous_sha")
cutover_started=0
rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] && [ "$cutover_started" -eq 1 ]; then
    echo "beacon-account: cutover failed; restoring prior app image without downgrading the database" >&2
    account_restore_previous_runtime "$environment" "$previous_sha" "$previous_worker_present" || true
  fi
  exit "$status"
}
trap rollback_on_failure EXIT HUP INT TERM

# Build once from the exact reviewed checkout. Staging and production consume
# the same immutable image, but never the same runtime secret or database.
account_compose build account-production
baked_sha=$(docker image inspect "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
test "$baked_sha" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'built image provenance mismatch'
account_validate

[ "$environment" != production ] || account_check_production_migrations before
[ "$environment" != production ] || account_backup_production >/dev/null
cutover_started=1
account_compose up -d "account-mail-worker-$environment" "account-$environment"
[ "$environment" != production ] || account_check_production_migrations after
account_verify_running "$environment"
"$root/scripts/beacon-account/health-smoke.sh" "$environment" "$ACCOUNT_DEPLOY_FILE"
cutover_started=0
trap - EXIT HUP INT TERM
echo "Beacon Account $environment is healthy at exact SHA $BEACON_ACCOUNT_GIT_SHA."
