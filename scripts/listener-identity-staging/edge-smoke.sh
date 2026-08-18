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
account_enabled=$(listener_staging_account_enabled)
printf '%s\n' "$health" | jq --exit-status \
  --arg sha "$LISTENER_IDENTITY_STAGING_GIT_SHA" \
  '.status == "ok" and .gitSha == $sha' >/dev/null ||
  listener_staging_fail 'public edge health provenance mismatch'

sentinel="listener-account-edge-${LISTENER_IDENTITY_STAGING_GIT_SHA}"
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT HUP INT TERM

nav_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/assets/hb-global-nav.js")
test "$nav_code" = 200 || listener_staging_fail 'canonical navigation asset is not available at the exact edge path'
expected_nav_sha=$(docker exec listener-identity-staging-app \
  sha256sum /app/public/assets/hb-global-nav.js | awk '{print $1}')
test "$(sha256sum "$body" | awk '{print $1}')" = "$expected_nav_sha" ||
  listener_staging_fail 'public navigation asset differs from the verified app image'
grep -Eiq '^cache-control: public, max-age=300' "$headers" ||
  listener_staging_fail 'navigation asset lost bounded public caching'
grep -Eiq '^x-content-type-options: nosniff' "$headers" ||
  listener_staging_fail 'navigation asset lost nosniff'
grep -Eiq '^referrer-policy: no-referrer' "$headers" ||
  listener_staging_fail 'navigation asset lost no-referrer'
if grep -Fq '<iframe' "$body"; then
  listener_staging_fail 'navigation asset unexpectedly embeds an iframe'
fi
if grep -Fq '/favicon.svg' "$body"; then
  listener_staging_fail 'navigation asset unexpectedly fetches the remote favicon'
fi
for asset_path in /assets/other.js /assets/hb-global-nav.js/extra; do
  code=$(curl_edge --max-time 5 --output /dev/null --write-out '%{http_code}' "$origin$asset_path")
  test "$code" = 404 || listener_staging_fail "unexpected asset path escaped deny-default: $asset_path"
done

login_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/login")
if test "$account_enabled" = 1; then
  test "$login_code" = 302 || listener_staging_fail 'Account-on login did not redirect to the staging issuer'
  grep -Eiq '^location: https://account-staging\.harmonicbeacon\.com/api/account/auth/oauth2/authorize\?' "$headers" ||
    listener_staging_fail 'Account-on login escaped the exact staging issuer authorization endpoint'
  grep -Eiq '^set-cookie: __Host-hb_listener_account_attempt=.*Path=/;.*HttpOnly;.*Secure;.*SameSite=Lax' "$headers" ||
    listener_staging_fail 'Account-on login lost its host-only OAuth attempt cookie contract'
else
  test "$login_code" = 503 || listener_staging_fail 'Account-off login did not fail closed in the app'
fi
grep -Eiq '^cache-control:.*no-store' "$headers" || listener_staging_fail 'Account login lost no-store'
grep -Eiq '^referrer-policy: no-referrer' "$headers" || listener_staging_fail 'Account login lost no-referrer'

callback_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/callback?code=${sentinel}-code&state=${sentinel}-state")
test "$callback_code" = 302 || listener_staging_fail 'malformed Account callback did not return its bounded error redirect'
grep -Eiq '^location: /\?authError=1' "$headers" || listener_staging_fail 'malformed Account callback redirect is not bounded'
grep -Eiq '^cache-control:.*no-store' "$headers" || listener_staging_fail 'Account callback lost no-store'
grep -Eiq '^referrer-policy: no-referrer' "$headers" || listener_staging_fail 'Account callback lost no-referrer'

frontchannel_code=$(curl_edge --max-time 5 --dump-header "$headers" --output "$body" \
  --write-out '%{http_code}' "$origin/api/account/frontchannel-logout")
if test "$account_enabled" = 1; then
  test "$frontchannel_code" = 400 || listener_staging_fail 'Account-on front-channel logout accepted an unsigned request'
else
  test "$frontchannel_code" = 500 || listener_staging_fail 'Account-off front-channel logout did not fail closed in the app'
fi
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
echo "Listener identity staging edge smoke passed: exact vhost, Account mode $account_enabled and log redaction."
