#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

environment=${1:?usage: rollback-app.sh staging|production /secure/deploy.env previous-sha40}
ACCOUNT_DEPLOY_FILE=${2:?usage: rollback-app.sh staging|production /secure/deploy.env previous-sha40}
previous_sha=${3:?usage: rollback-app.sh staging|production /secure/deploy.env previous-sha40}
export ACCOUNT_DEPLOY_FILE
case "$environment" in production|staging) ;; *) account_fail 'environment must be production or staging' ;; esac
echo "$previous_sha" | grep -Eq '^[0-9a-f]{40}$' || account_fail 'previous SHA must be exact sha40'

account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
exec 9>"/run/lock/beacon-account-$environment.lock"
flock -n 9 || account_fail "another $environment deployment is active"
docker image inspect "harmonic-beacon/account:$previous_sha" >/dev/null || account_fail 'previous image is unavailable'
previous_worker_present=0
if account_image_supports_mail_worker "$previous_sha"; then
  previous_worker_present=1
fi
previous_nav_asset_present=0
if account_image_supports_navigation_asset "$previous_sha"; then
  previous_nav_asset_present=1
fi
account_restore_previous_runtime "$environment" "$previous_sha" "$previous_worker_present"
"$(dirname -- "$0")/health-smoke.sh" \
  "$environment" "$ACCOUNT_DEPLOY_FILE" "$previous_sha" "$previous_worker_present" \
  "$previous_nav_asset_present"
echo "Beacon Account $environment runtime rolled back to $previous_sha; database was not downgraded."
