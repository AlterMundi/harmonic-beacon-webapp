#!/usr/bin/env sh
set -eu
umask 077
. "$(dirname -- "$0")/lib.sh"

env_file=${1:?usage: registered-free-smoke.sh PREVIEW_ENV [BASE_URL]}
base_url=${2:-https://earlybirds-staging.harmonicbeacon.com}
require_synthetic_env "$env_file"
command -v jq >/dev/null 2>&1 || preview_fail "jq is required"

case "$base_url" in
  https://earlybirds-staging.harmonicbeacon.com) ;;
  *) preview_fail "BASE_URL must be the protected EarlyBirds staging host" ;;
esac

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
login_secret=$(preview_env_value EARLY_BIRDS_TEST_LOGIN_SECRET "$env_file")
run_id="$(date +%s)-$$"

printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' \
  "$login_secret" >"$temporary/login.curl"

synthetic_login() {
  identity=$1
  cookie_jar=$2
  login_body=$3
  printf '{"name":"Registered Free smoke","email":"%s","authOnly":true}' \
    "$identity" >"$login_body"
  login_status=$(curl --silent --show-error --output "$login_body.response" \
    --write-out '%{http_code}' --request POST --config "$temporary/login.curl" \
    --cookie-jar "$cookie_jar" --data-binary @"$login_body" \
    "$base_url/api/early-birds/test-login")
  test "$login_status" = 200 || preview_fail "synthetic auth-only login returned HTTP $login_status"
  jq -e '.ok == true' "$login_body.response" >/dev/null || \
    preview_fail "synthetic auth-only login response is invalid"
}

post_schedule() {
  cookie_jar=$1
  request_body=$2
  output_file=$3
  curl --silent --show-error --output "$output_file" --write-out '%{http_code}' \
    --request POST --header "Origin: $base_url" --header 'Content-Type: application/json' \
    --cookie "$cookie_jar" --data-binary @"$request_body" \
    "$base_url/api/early-birds/free-window"
}

custom_email="free-custom-$run_id@e2e.invalid"
custom_cookies="$temporary/custom.cookies"
synthetic_login "$custom_email" "$custom_cookies" "$temporary/custom-login.json"

initial_status=$(curl --silent --show-error --output "$temporary/custom-initial.json" \
  --write-out '%{http_code}' --cookie "$custom_cookies" \
  "$base_url/api/early-birds/free-window")
test "$initial_status" = 200 || preview_fail "initial Free schedule returned HTTP $initial_status"
jq -e '.state.configured == false and .state.canChange == true' \
  "$temporary/custom-initial.json" >/dev/null || \
  preview_fail "new account Free schedule is not empty/changeable"

custom_minute=$(((($(date -u +%s) / 60) + 180) % 1440))
custom_request_id=$(tr -d '\r\n' </proc/sys/kernel/random/uuid)
printf '{"mode":"custom","timeZone":"UTC","localStartMinute":%s,"selectionRequestId":"%s"}' \
  "$custom_minute" "$custom_request_id" >"$temporary/custom-select.json"

custom_status=$(post_schedule "$custom_cookies" "$temporary/custom-select.json" "$temporary/custom-selected.json")
test "$custom_status" = 200 || preview_fail "custom Free selection returned HTTP $custom_status"
jq -e --argjson expected_minute "$custom_minute" '
  .replayed == false and
  .state.configured == true and
  .state.active == false and
  .state.timeZone == "UTC" and
  .state.localStartMinute == $expected_minute and
  .state.canChange == false and
  (.state.nextStart | type == "string") and
  (.state.changeAllowedAt | type == "string")
' "$temporary/custom-selected.json" >/dev/null || preview_fail "custom Free selection state is invalid"

replay_status=$(post_schedule "$custom_cookies" "$temporary/custom-select.json" "$temporary/custom-replayed.json")
test "$replay_status" = 200 || preview_fail "idempotent Free selection replay returned HTTP $replay_status"
jq -e '.replayed == true' "$temporary/custom-replayed.json" >/dev/null || \
  preview_fail "Free selection replay was not idempotent"

cooldown_request_id=$(tr -d '\r\n' </proc/sys/kernel/random/uuid)
printf '{"mode":"now","timeZone":"UTC","selectionRequestId":"%s"}' \
  "$cooldown_request_id" >"$temporary/custom-change.json"
cooldown_status=$(post_schedule "$custom_cookies" "$temporary/custom-change.json" "$temporary/custom-cooldown.json")
test "$cooldown_status" = 409 || preview_fail "Free schedule cooldown returned HTTP $cooldown_status"
jq -e '.error == "Free listening schedule is locked." and (.changeAllowedAt | type == "string")' \
  "$temporary/custom-cooldown.json" >/dev/null || \
  preview_fail "Free schedule cooldown response is invalid"

now_email="free-now-$run_id@e2e.invalid"
now_cookies="$temporary/now.cookies"
synthetic_login "$now_email" "$now_cookies" "$temporary/now-login.json"
now_request_id=$(tr -d '\r\n' </proc/sys/kernel/random/uuid)
printf '{"mode":"now","timeZone":"UTC","selectionRequestId":"%s"}' \
  "$now_request_id" >"$temporary/now-select.json"
now_status=$(post_schedule "$now_cookies" "$temporary/now-select.json" "$temporary/now-selected.json")
test "$now_status" = 200 || preview_fail "Listen-now Free selection returned HTTP $now_status"
jq -e '
  .replayed == false and
  .state.active == true and
  ((.state.activeEnd | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) -
   (.state.activeStart | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) == 7200)
' "$temporary/now-selected.json" >/dev/null || \
  preview_fail "Listen-now Free window is not active for two hours"

for ordinal in 1 2 3; do
  printf '{"deviceId":"registered_free_%s_device_%s","intent":"play"}' \
    "$run_id" "$ordinal" >"$temporary/lease-$ordinal.json"
  lease_status=$(curl --silent --show-error --output "$temporary/lease-$ordinal.response" \
    --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' \
    --cookie "$now_cookies" --data-binary @"$temporary/lease-$ordinal.json" \
    "$base_url/api/early-birds/stream/lease")
  test "$lease_status" = 200 || preview_fail "device $ordinal lease returned HTTP $lease_status"
done

jq -e -s '
  .[0].evictedAnotherDevice == false and
  .[1].evictedAnotherDevice == false and
  .[2].evictedAnotherDevice == true and
  (.[3].state.activeEnd | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $active_end |
  (.[0:3] | all((.leaseExpiresAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) <= $active_end))
' "$temporary/lease-1.response" "$temporary/lease-2.response" "$temporary/lease-3.response" \
  "$temporary/now-selected.json" >/dev/null || \
  preview_fail "two-device eviction or Free-window lease cap is invalid"

first_lease=$(jq -er '.leaseId' "$temporary/lease-1.response")
printf '{"leaseId":"%s","intent":"play"}' "$first_lease" >"$temporary/heartbeat.json"
heartbeat_status=$(curl --silent --show-error --output "$temporary/heartbeat.response" \
  --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' \
  --cookie "$now_cookies" --data-binary @"$temporary/heartbeat.json" \
  "$base_url/api/early-birds/stream/heartbeat")
test "$heartbeat_status" = 410 || preview_fail "displaced oldest device returned HTTP $heartbeat_status"
jq -e '.reason == "displaced"' "$temporary/heartbeat.response" >/dev/null || \
  preview_fail "oldest device displacement response is invalid"

third_lease=$(jq -er '.leaseId' "$temporary/lease-3.response")
manifest_status=$(curl --silent --show-error --output "$temporary/manifest.m3u8" \
  --write-out '%{http_code}' --cookie "$now_cookies" \
  "$base_url/api/early-birds/stream/manifest?leaseId=$third_lease")
test "$manifest_status" = 200 || preview_fail "active Free manifest returned HTTP $manifest_status"
grep -q '^#EXTM3U' "$temporary/manifest.m3u8" || preview_fail "active Free manifest is invalid"

echo "Registered Free smoke passed: future schedule, idempotency, cooldown, Listen now, exact lease cap, two-device eviction, and signed manifest."
