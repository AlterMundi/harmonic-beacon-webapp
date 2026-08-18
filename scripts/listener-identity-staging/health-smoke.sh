#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: health-smoke.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
listener_staging_wait_healthy

docker exec listener-identity-staging-app sh -c \
  'cd /media/artifacts && sha256sum -cs /app/ops/listener-identity-staging/intro-artifacts.sha256' ||
  listener_staging_fail 'mounted Listener staging intros do not match the reviewed manifest'

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

  account_origin=https://account-staging.harmonicbeacon.com
  account_ready=$(curl --fail --silent --show-error --max-time 5 --proto '=https' \
    "$account_origin/api/account/health/ready")
  discovery=$(curl --fail --silent --show-error --max-time 5 --proto '=https' \
    "$account_origin/.well-known/openid-configuration")
  jwks=$(curl --fail --silent --show-error --max-time 5 --proto '=https' \
    "$account_origin/.well-known/jwks.json")
  printf '%s\n' "$account_ready" | jq --exit-status '
    .status == "ok" and
    (.gitSha | type == "string" and test("^[0-9a-f]{40}$")) and
    (.schemaVersion | type == "string" and test("^[0-9]{14}_[a-z0-9_]+$")) and
    .checks.database == "ok" and .checks.mail == "ok" and
    .checks.issuer == "ok" and .checks.jwks == "ok" and
    .checks.clients == "ok" and .checks.providers == "ok"
  ' >/dev/null || listener_staging_fail 'Account staging authority is not ready'
  printf '%s\n' "$discovery" | jq --exit-status --arg issuer "$account_origin" '
    .issuer == $issuer and
    .jwks_uri == ($issuer + "/.well-known/jwks.json") and
    .authorization_endpoint == ($issuer + "/api/account/auth/oauth2/authorize") and
    .token_endpoint == ($issuer + "/api/account/auth/oauth2/token") and
    .response_types_supported == ["code"] and
    .code_challenge_methods_supported == ["S256"] and
    .token_endpoint_auth_methods_supported == ["client_secret_basic"]
  ' >/dev/null || listener_staging_fail 'Account staging OIDC discovery drifted from its exact issuer'
  printf '%s\n' "$jwks" | jq --exit-status '
    (.keys | type == "array" and length > 0) and
    all(.keys[]; (.kid | type == "string" and length > 0) and
      (.kty | type == "string" and length > 0) and
      (.alg | type == "string" and length > 0))
  ' >/dev/null || listener_staging_fail 'Account staging JWKS has no usable verification key'
else
  printf '%s\n' "$ready" | jq --exit-status \
    '.status == "ok" and .checks.database == "ok" and
     .checks.listenerRuntime == "ok" and (.checks | has("listenerAccount") | not)' >/dev/null ||
    listener_staging_fail 'readiness or Account-off boundary mismatch'
fi

test "$(docker inspect listener-identity-staging-postgres --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}')" = \
  'listener_identity_staging_database ' || listener_staging_fail 'PostgreSQL escaped its dedicated internal network'
echo "Listener identity staging smoke passed: provenance, migration, database, readiness and Account mode $account_enabled."
