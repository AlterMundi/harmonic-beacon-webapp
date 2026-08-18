#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: health-smoke.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
listener_staging_wait_healthy

test "$(docker inspect listener-identity-staging-app --format '{{.Config.Image}}')" = \
  "harmonic-beacon/listener-identity-staging:$LISTENER_IDENTITY_STAGING_IMAGE_TAG" ||
  listener_staging_fail 'running app image does not match deploy contract'
test "$(docker inspect listener-identity-staging-migrate --format '{{.State.ExitCode}}')" = 0 ||
  listener_staging_fail 'forward-only migration did not exit successfully'
test "$(docker inspect listener-identity-staging-postgres --format '{{.State.Health.Status}}')" = healthy ||
  listener_staging_fail 'dedicated PostgreSQL is not healthy'

health=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:13001/api/health)
ready=$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:13001/api/health/ready)
account_enabled=$(listener_staging_account_enabled)
printf '%s\n' "$health" | jq --exit-status \
  --arg sha "$LISTENER_IDENTITY_STAGING_GIT_SHA" \
  --arg schema "$LISTENER_IDENTITY_STAGING_SCHEMA_VERSION" \
  '.status == "ok" and .gitSha == $sha and .databaseSchemaVersion == $schema' >/dev/null ||
  listener_staging_fail 'health provenance or schema mismatch'
if test "$account_enabled" = 1; then
  printf '%s\n' "$ready" | jq --exit-status \
    '.status == "ok" and .checks.database == "ok" and
     .checks.listenerRuntime == "ok" and .checks.listenerAccount == "ok"' >/dev/null ||
    listener_staging_fail 'readiness or Account-on boundary mismatch'
else
  printf '%s\n' "$ready" | jq --exit-status \
    '.status == "ok" and .checks.database == "ok" and
     .checks.listenerRuntime == "ok" and (.checks | has("listenerAccount") | not)' >/dev/null ||
    listener_staging_fail 'readiness or Account-off boundary mismatch'
fi

test "$(docker inspect listener-identity-staging-postgres --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}')" = \
  'listener_identity_staging_database ' || listener_staging_fail 'PostgreSQL escaped its dedicated internal network'
echo "Listener identity staging smoke passed: provenance, migration, database, readiness and Account mode $account_enabled."
