#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

environment=${1:?usage: health-smoke.sh staging|production /secure/deploy.env [expected-sha40] [worker-present]}
ACCOUNT_DEPLOY_FILE=${2:?usage: health-smoke.sh staging|production /secure/deploy.env [expected-sha40] [worker-present]}
export ACCOUNT_DEPLOY_FILE
account_load_deploy_env "$ACCOUNT_DEPLOY_FILE"
expected_sha=${3:-$BEACON_ACCOUNT_GIT_SHA}
echo "$expected_sha" | grep -Eq '^[0-9a-f]{40}$' || account_fail 'expected SHA must be exact sha40'
expected_worker_present=${4:-}
if [ -z "$expected_worker_present" ]; then
  expected_worker_present=0
  account_image_supports_mail_worker "$expected_sha" && expected_worker_present=1
fi
case "$expected_worker_present" in 0|1) ;; *) account_fail 'worker presence must be 0 or 1' ;; esac
account_validate
account_verify_running "$environment" "$expected_sha" "$expected_sha" "$expected_worker_present"
command -v curl >/dev/null 2>&1 || account_fail 'curl is required for Account health smoke'
command -v jq >/dev/null 2>&1 || account_fail 'jq is required for Account health smoke'

port=13002
origin=https://account.harmonicbeacon.com
[ "$environment" = staging ] && port=13003 && origin=https://account-staging.harmonicbeacon.com
tmp=$(mktemp -d /run/beacon-account-smoke.XXXXXX)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
host=${origin#https://}
curl --fail --silent --show-error --connect-timeout 3 --max-time 8 -H "Host: $host" \
  "http://127.0.0.1:$port/api/account/health/ready" > "$tmp/ready.json"
curl --fail --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  "$origin/.well-known/openid-configuration" > "$tmp/discovery.json"
curl --fail --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  "$origin/.well-known/jwks.json" > "$tmp/jwks.json"
"$(dirname -- "$0")/verify-health-json.sh" \
  "$tmp" "$origin" "$expected_sha" "$BEACON_ACCOUNT_SCHEMA_VERSION"
echo "Beacon Account $environment loopback and HTTPS discovery are healthy."
