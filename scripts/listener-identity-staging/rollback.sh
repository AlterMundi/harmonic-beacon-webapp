#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: rollback.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
exec 9>/run/lock/listener-identity-staging.lock
flock -n 9 || listener_staging_fail 'another Listener staging operation is active'
listener_staging_restore_edge
listener_staging_restore_account_enabled
listener_staging_restore_drop_ins

previous_file="$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-image"
if test -f "$previous_file"; then
  previous=$(sed -n '1p' "$previous_file")
  printf '%s\n' "$previous" | grep -Eq '^harmonic-beacon/listener-identity-staging:[0-9a-f]{40}$' ||
    listener_staging_fail 'recorded rollback image is invalid'
  docker image inspect "$previous" >/dev/null
  LISTENER_IDENTITY_STAGING_IMAGE_TAG=${previous##*:}
  LISTENER_IDENTITY_STAGING_GIT_SHA=$LISTENER_IDENTITY_STAGING_IMAGE_TAG
  export LISTENER_IDENTITY_STAGING_IMAGE_TAG LISTENER_IDENTITY_STAGING_GIT_SHA
  listener_staging_compose up -d --no-deps --force-recreate app
  listener_staging_wait_healthy
  health=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:13001/api/health)
  printf '%s\n' "$health" | grep -Fq "\"gitSha\":\"$LISTENER_IDENTITY_STAGING_GIT_SHA\"" ||
    listener_staging_fail 'rollback health provenance mismatch'
  echo "Listener identity staging rolled back to $LISTENER_IDENTITY_STAGING_GIT_SHA; database was not downgraded."
  exit 0
fi

# First-cutover recovery: the prior disposable staging container is retained,
# stopped rather than deleted, until the new stack is accepted.
listener_staging_compose stop app || true
if docker inspect listener-ui-dev >/dev/null 2>&1; then
  docker start listener-ui-dev >/dev/null
  echo 'First-cutover rollback restored the retained listener-ui-dev container; dedicated PostgreSQL was preserved.'
  exit 0
fi
listener_staging_fail 'no previous immutable image or retained legacy staging container is available'
