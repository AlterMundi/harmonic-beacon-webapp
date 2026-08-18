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
HEALTH_BODY=$health READY_BODY=$ready node - "$LISTENER_IDENTITY_STAGING_GIT_SHA" \
  "$LISTENER_IDENTITY_STAGING_SCHEMA_VERSION" <<'NODE'
const health = JSON.parse(process.env.HEALTH_BODY);
const ready = JSON.parse(process.env.READY_BODY);
const [sha, schema] = process.argv.slice(2);
if (health.status !== 'ok' || health.gitSha !== sha || health.databaseSchemaVersion !== schema) process.exit(1);
if (ready.status !== 'ok' || ready.checks?.database !== 'ok' ||
    ready.checks?.listenerRuntime !== 'ok' || 'listenerAccount' in (ready.checks ?? {})) process.exit(1);
NODE

test "$(docker inspect listener-identity-staging-postgres --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}')" = \
  'listener_identity_staging_database ' || listener_staging_fail 'PostgreSQL escaped its dedicated internal network'
echo 'Listener identity staging smoke passed: provenance, migration, database, readiness and Account-off boundary.'
