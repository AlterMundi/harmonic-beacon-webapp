#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: edge-smoke.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
nginx -t
test "$(sha256sum "$listener_staging_nginx_target" | awk '{print $1}')" = \
  "$(sha256sum "$listener_staging_nginx_source" | awk '{print $1}')" ||
  listener_staging_fail 'active staging vhost is not the reviewed template'

origin=https://earlybirds-staging.harmonicbeacon.com
curl_edge() {
  curl --silent --show-error --resolve earlybirds-staging.harmonicbeacon.com:443:127.0.0.1 "$@"
}

health=$(curl_edge --fail --max-time 5 "$origin/api/health")
printf '%s\n' "$health" | jq --exit-status \
  --arg sha "$LISTENER_IDENTITY_STAGING_GIT_SHA" \
  '.status == "ok" and .gitSha == $sha' >/dev/null ||
  listener_staging_fail 'public edge health provenance mismatch'

sentinel="listener-account-edge-${LISTENER_IDENTITY_STAGING_GIT_SHA}"
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT HUP INT TERM

login_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/login")
test "$login_code" = 503 || listener_staging_fail 'Account-off login did not fail closed in the app'
grep -Eiq '^cache-control:.*no-store' "$headers" || listener_staging_fail 'Account login lost no-store'
grep -Eiq '^referrer-policy: no-referrer' "$headers" || listener_staging_fail 'Account login lost no-referrer'

callback_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/callback?code=${sentinel}-code&state=${sentinel}-state")
test "$callback_code" = 302 || listener_staging_fail 'Account-off callback did not return its bounded error redirect'
grep -Eiq '^location: /\?authError=1' "$headers" || listener_staging_fail 'Account-off callback redirect is not bounded'
grep -Eiq '^cache-control:.*no-store' "$headers" || listener_staging_fail 'Account callback lost no-store'
grep -Eiq '^referrer-policy: no-referrer' "$headers" || listener_staging_fail 'Account callback lost no-referrer'

frontchannel_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/frontchannel-logout")
test "$frontchannel_code" = 500 || listener_staging_fail 'Account-off front-channel logout did not fail closed in the app'
grep -Eiq '^cache-control:.*no-store' "$headers" || listener_staging_fail 'Account front-channel logout lost no-store'

for route in login callback frontchannel-logout; do
  code=$(curl_edge --max-time 5 --request POST --output /dev/null --write-out '%{http_code}' \
    "$origin/api/account/$route")
  test "$code" = 405 || listener_staging_fail "Account route $route did not reach the method-failing app boundary"
done
suffix_code=$(curl_edge --max-time 5 --output /dev/null --write-out '%{http_code}' \
  "$origin/api/account/callback/extra?state=${sentinel}-suffix")
test "$suffix_code" = 404 || listener_staging_fail 'unknown Account suffix did not fail closed at the edge'

if find /var/log/nginx -maxdepth 1 -type f -name '*access*.log' \
  -exec grep -F "$sentinel" {} + | grep -q .; then
  listener_staging_fail 'Account callback state leaked into an access log'
fi
echo 'Listener identity staging edge smoke passed: exact vhost, Account-off proxy boundary and log redaction.'
