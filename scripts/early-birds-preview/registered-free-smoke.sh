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
cookie_jar="$temporary/listener.cookies"

printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' \
  "$login_secret" >"$temporary/login.curl"
printf '{"name":"Weekly quota smoke","email":"weekly-quota-%s@e2e.invalid","authOnly":true}' \
  "$run_id" >"$temporary/login.json"
login_status=$(curl --silent --show-error --output "$temporary/login.response" \
  --write-out '%{http_code}' --request POST --config "$temporary/login.curl" \
  --cookie-jar "$cookie_jar" --data-binary @"$temporary/login.json" \
  "$base_url/api/early-birds/test-login")
test "$login_status" = 200 || preview_fail "synthetic auth-only login returned HTTP $login_status"
jq -e '.ok == true' "$temporary/login.response" >/dev/null || \
  preview_fail "synthetic auth-only login response is invalid"

initial_status=$(curl --silent --show-error --output "$temporary/initial.json" \
  --write-out '%{http_code}' --cookie "$cookie_jar" \
  "$base_url/api/listener/access-state")
test "$initial_status" = 200 || preview_fail "initial quota state returned HTTP $initial_status"
jq -e '
  .access.kind == "free-quota" and
  .access.quota.policy == "personal-7-day-v1" and
  .access.quota.status == "not-started" and
  .access.quota.cycleStartedAt == null and
  .access.quota.baseAllowanceMs == 10800000 and
  .access.quota.remainingMs == 10800000
' "$temporary/initial.json" >/dev/null || preview_fail "initial weekly quota state is invalid"

for retired in free-window welcome-access; do
  retired_status=$(curl --silent --show-error --output "$temporary/$retired.json" \
    --write-out '%{http_code}' --cookie "$cookie_jar" \
    "$base_url/api/listener/$retired")
  test "$retired_status" = 410 || preview_fail "$retired legacy authority returned HTTP $retired_status"
done

for ordinal in 1 2 3; do
  printf '{"deviceId":"weekly_quota_%s_device_%s","intent":"play"}' \
    "$run_id" "$ordinal" >"$temporary/lease-$ordinal.json"
  lease_status=$(curl --silent --show-error --output "$temporary/lease-$ordinal.response" \
    --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' \
    --cookie "$cookie_jar" --data-binary @"$temporary/lease-$ordinal.json" \
    "$base_url/api/listener/stream/lease")
  test "$lease_status" = 200 || preview_fail "device $ordinal lease returned HTTP $lease_status"
  jq -e '
    .accessKind == "free-quota" and
    .quota.policy == "personal-7-day-v1" and
    .quota.status == "listening" and
    (.quota.remainingMs > 0 and .quota.remainingMs <= 10800000) and
    (.leaseGeneration | type == "number") and
    (.presenceSequence | type == "number")
  ' "$temporary/lease-$ordinal.response" >/dev/null || preview_fail "device $ordinal quota lease is invalid"
done

jq -e -s '
  .[0].evictedAnotherDevice == false and
  .[1].evictedAnotherDevice == false and
  .[2].evictedAnotherDevice == true
' "$temporary/lease-1.response" "$temporary/lease-2.response" "$temporary/lease-3.response" \
  >/dev/null || preview_fail "two-device eviction is invalid"

first_lease=$(jq -er '.leaseId' "$temporary/lease-1.response")
first_generation=$(jq -er '.leaseGeneration' "$temporary/lease-1.response")
first_sequence=$(jq -er '.presenceSequence' "$temporary/lease-1.response")
printf '{"leaseId":"%s","leaseGeneration":%s,"presenceSequence":%s,"intent":"play","presence":"listening"}' \
  "$first_lease" "$first_generation" "$first_sequence" >"$temporary/heartbeat.json"
heartbeat_status=$(curl --silent --show-error --output "$temporary/heartbeat.response" \
  --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' \
  --cookie "$cookie_jar" --data-binary @"$temporary/heartbeat.json" \
  "$base_url/api/listener/stream/heartbeat")
test "$heartbeat_status" = 410 || preview_fail "displaced oldest device returned HTTP $heartbeat_status"
jq -e '.reason == "displaced"' "$temporary/heartbeat.response" >/dev/null || \
  preview_fail "oldest device displacement response is invalid"

third_lease=$(jq -er '.leaseId' "$temporary/lease-3.response")
third_generation=$(jq -er '.leaseGeneration' "$temporary/lease-3.response")
manifest_status=$(curl --silent --show-error --output "$temporary/manifest.m3u8" \
  --write-out '%{http_code}' --cookie "$cookie_jar" \
  "$base_url/api/listener/stream/manifest?leaseId=$third_lease&leaseGeneration=$third_generation")
test "$manifest_status" = 200 || preview_fail "active Free manifest returned HTTP $manifest_status"
grep -q '^#EXTM3U' "$temporary/manifest.m3u8" || preview_fail "active Free manifest is invalid"

active_status=$(curl --silent --show-error --output "$temporary/active.json" \
  --write-out '%{http_code}' --cookie "$cookie_jar" \
  "$base_url/api/listener/access-state")
test "$active_status" = 200 || preview_fail "active quota state returned HTTP $active_status"
jq -e '
  .access.kind == "free-quota" and
  .access.quota.status == "listening" and
  (.access.quota.cycleStartedAt | type == "string") and
  ((.access.quota.cycleEndsAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) -
   (.access.quota.cycleStartedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) == 604800) and
  (.access.quota.remainingMs > 0 and .access.quota.remainingMs <= 10800000)
' "$temporary/active.json" >/dev/null || preview_fail "active weekly quota state is invalid"

echo "Registered Free smoke passed: weekly anchor, three-hour allowance, retired legacy APIs, two-device eviction, and generation-bound manifest."
