#!/usr/bin/env sh
set -eu

expected_sha=${1:?usage: health-smoke.sh exact-live-sha40}
case "$expected_sha" in *[!0-9a-f]*|'') echo 'exact lowercase sha40 required' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 40 || { echo 'exact lowercase sha40 required' >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo 'curl required' >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo 'jq required' >&2; exit 2; }

origin=https://live.harmonicbeacon.com
headers=$(mktemp)
trap 'rm -f -- "$headers"' EXIT HUP INT TERM
curl_flags='--silent --show-error --connect-timeout 3 --max-time 8'

curl $curl_flags --fail --proto '=https' "$origin/api/health" |
  jq --exit-status --arg sha "$expected_sha" '.status == "ok" and .gitSha == $sha' >/dev/null
curl $curl_flags --fail --proto '=https' "$origin/api/health/ready" |
  jq --exit-status '.status == "ok" and .checks.database == "ok" and .checks.account == "ok"' >/dev/null

status=$(curl $curl_flags --proto '=https' --output /dev/null --dump-header "$headers" \
  --write-out '%{http_code}' "$origin/api/account/login")
test "$status" = 303 || { echo 'Live Account login did not redirect' >&2; exit 1; }
location=$(sed -n 's/^[Ll]ocation:[[:space:]]*//p' "$headers" | tail -n 1 | tr -d '\r')
case "$location" in
  https://account.harmonicbeacon.com/api/account/auth/oauth2/authorize\?*) ;;
  *) echo 'Live Account login escaped the production issuer' >&2; exit 1 ;;
esac
case "$location" in *'client_id=hb-live'*) ;; *) echo 'Live Account client mismatch' >&2; exit 1 ;; esac
case "$location" in *'redirect_uri=https%3A%2F%2Flive.harmonicbeacon.com%2Fapi%2Faccount%2Fcallback'*) ;;
  *) echo 'Live Account callback mismatch' >&2; exit 1 ;;
esac
case "$location" in *'code_challenge_method=S256'*) ;; *) echo 'Live Account PKCE mismatch' >&2; exit 1 ;; esac
case "$location" in *client_secret*) echo 'Live Account redirect exposed a client secret field' >&2; exit 1 ;; esac
rm -f -- "$headers"
headers=$(mktemp)
unset location

sentinel="hb-live-account-smoke-$$-$(date +%s)"
status=$(curl $curl_flags --proto '=https' --output /dev/null --write-out '%{http_code}' \
  "$origin/api/account/callback?code=$sentinel&state=$sentinel")
test "$status" = 302 || { echo 'malformed Live Account callback was not bounded' >&2; exit 1; }
test "$(curl $curl_flags --proto '=https' --output /dev/null --write-out '%{http_code}' \
  "$origin/api/account/frontchannel-logout")" = 400 || { echo 'unsigned frontchannel logout was accepted' >&2; exit 1; }
for route in login callback frontchannel-logout; do
  test "$(curl $curl_flags --proto '=https' --request POST --output /dev/null --write-out '%{http_code}' \
    "$origin/api/account/$route")" = 405 || { echo "POST $route did not fail closed" >&2; exit 1; }
done
test "$(curl $curl_flags --proto '=https' --output /dev/null --write-out '%{http_code}' \
  "$origin/api/account/login/extra")" = 404 || { echo 'unknown Account suffix was exposed' >&2; exit 1; }
if test -r /var/log/nginx/access.log && tail -n 5000 /var/log/nginx/access.log | grep -Fq "$sentinel"; then
  echo 'OAuth callback material entered the Nginx access log' >&2
  exit 1
fi
unset sentinel
echo "Live production Account edge is healthy at exact SHA $expected_sha."
