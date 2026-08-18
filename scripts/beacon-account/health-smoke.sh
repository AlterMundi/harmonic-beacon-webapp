#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

environment=${1:?usage: health-smoke.sh staging|production /secure/deploy.env}
ACCOUNT_DEPLOY_FILE=${2:?usage: health-smoke.sh staging|production /secure/deploy.env}
export ACCOUNT_DEPLOY_FILE
account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
account_validate
account_verify_running "$environment"

port=13002
origin=https://account.harmonicbeacon.com
[ "$environment" = staging ] && port=13003 && origin=https://account-staging.harmonicbeacon.com
tmp=$(mktemp -d /run/beacon-account-smoke.XXXXXX)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
host=${origin#https://}
curl --fail --silent --show-error -H "Host: $host" \
  "http://127.0.0.1:$port/api/account/health/ready" > "$tmp/ready.json"
curl --fail --silent --show-error "$origin/.well-known/openid-configuration" > "$tmp/discovery.json"
curl --fail --silent --show-error "$origin/.well-known/jwks.json" > "$tmp/jwks.json"
node - "$tmp" "$origin" "$BEACON_ACCOUNT_GIT_SHA" "$BEACON_ACCOUNT_SCHEMA_VERSION" <<'NODE'
const fs = require('node:fs');
const [directory, issuer, sha, schema] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${directory}/${name}.json`, 'utf8'));
const ready = read('ready');
if (ready.status !== 'ok' || ready.gitSha !== sha || ready.schemaVersion !== schema || ready.checks?.mail !== 'ok') {
  throw new Error('Account readiness provenance/schema/mail mismatch');
}
const discovery = read('discovery');
if (discovery.issuer !== issuer || discovery.jwks_uri !== `${issuer}/.well-known/jwks.json`) {
  throw new Error('OIDC discovery issuer/JWKS mismatch');
}
const jwks = read('jwks');
if (!Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.some((key) => !key.kid || !key.kty || !key.use)) {
  throw new Error('JWKS key material is missing');
}
NODE
echo "Beacon Account $environment loopback and HTTPS discovery are healthy."
