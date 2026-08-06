#!/usr/bin/env sh
set -eu
umask 077
. "$(dirname -- "$0")/lib.sh"

env_file=${1:?usage: canonical-free-smoke.sh PREVIEW_ENV INVITATION_FILE}
invitation_file=${2:?usage: canonical-free-smoke.sh PREVIEW_ENV INVITATION_FILE}
require_synthetic_env "$env_file"
test -s "$invitation_file" || preview_fail "invitation file is missing or empty"

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
base_url=$(preview_env_value EARLY_BIRDS_AUTH_BASE_URL "$env_file")
login_secret=$(preview_env_value EARLY_BIRDS_TEST_LOGIN_SECRET "$env_file")
invitation_token=$(tr -d '\r\n' <"$invitation_file")
test "${#invitation_token}" -ge 32 || preview_fail "invitation token is too short"

synthetic_email="free-smoke-$(date +%s)-$$@e2e.invalid"
printf '{"name":"Canonical Free smoke","email":"%s","authOnly":true}' "$synthetic_email" >"$temporary/login.json"
printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' \
  "$login_secret" >"$temporary/login.curl"
printf 'url = "%s/early-birds?invite=%s"\n' "$base_url" "$invitation_token" >"$temporary/invitation.curl"

invitation_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --location --config "$temporary/invitation.curl" --cookie-jar "$temporary/cookies")
test "$invitation_status" = 200 || preview_fail "invitation cookie handoff returned HTTP $invitation_status"

login_status=$(curl --silent --show-error --output "$temporary/login.response" \
  --write-out '%{http_code}' --request POST --config "$temporary/login.curl" \
  --cookie-jar "$temporary/cookies" --data-binary @"$temporary/login.json" \
  "$base_url/api/early-birds/test-login")
test "$login_status" = 200 || preview_fail "synthetic login returned HTTP $login_status"
grep -q '"ok":true' "$temporary/login.response" || preview_fail "synthetic login response is invalid"

redeem_status=$(curl --silent --show-error --output "$temporary/redeem.response" \
  --write-out '%{http_code}' --request POST --cookie "$temporary/cookies" \
  --cookie-jar "$temporary/cookies" "$base_url/api/early-birds/free/redeem")
test "$redeem_status" = 200 || preview_fail "canonical Free redeem returned HTTP $redeem_status"
grep -q '"ok":true' "$temporary/redeem.response" || preview_fail "canonical Free redeem response is invalid"

home_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cookie "$temporary/cookies" "$base_url/")
test "$home_status" = 200 || preview_fail "entitled Listener home returned HTTP $home_status"

echo "Canonical Free smoke passed: synthetic login, private authority redeem, projection, session cookie, and Listener home."
