#!/usr/bin/env sh
set -eu

test "$(id -u)" -eq 0 || { echo 'run as root' >&2; exit 2; }
expected_sha=${1:?usage: health-smoke.sh expected-sha40 account-mode expected-schema}
account_mode=${2:?usage: health-smoke.sh expected-sha40 account-mode expected-schema}
expected_schema=${3:?usage: health-smoke.sh expected-sha40 account-mode expected-schema}
printf '%s\n' "$expected_sha" | grep -Eq '^[0-9a-f]{40}$' || {
  echo 'exact lowercase sha40 required' >&2; exit 2;
}
case "$account_mode" in 0|1) ;; *) echo 'account mode must be 0 or 1' >&2; exit 2 ;; esac
printf '%s\n' "$expected_schema" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' || {
  echo 'exact schema migration required' >&2; exit 2;
}

container=earlybirds-preview-listener-1
expected_image="harmonic-beacon/earlybirds-preview-listener:$expected_sha"
test "$(docker inspect "$container" --format '{{.Config.Image}}')" = "$expected_image" || {
  echo 'Listener image mismatch' >&2; exit 2;
}
test "$(docker inspect "$container" --format '{{.State.Health.Status}}')" = healthy || {
  echo 'Listener is not healthy' >&2; exit 2;
}
test "$(docker inspect "$container" --format '{{.RestartCount}}')" = 0 || {
  echo 'Listener restarted during the cutover' >&2; exit 2;
}

work=$(mktemp -d /run/listener-account-production-health.XXXXXX)
trap 'rm -rf "$work"' EXIT
trap 'exit 130' HUP INT TERM
docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' > "$work/runtime.env"
chmod 0600 "$work/runtime.env"
env_value() { sed -n "s/^$1=//p" "$work/runtime.env" | tail -n 1 | tr -d '\r'; }
test "$(env_value BEACON_GIT_SHA)" = "$expected_sha" || { echo 'Listener SHA mismatch' >&2; exit 2; }
test "$(env_value BEACON_DATABASE_SCHEMA_VERSION)" = "$expected_schema" || {
  echo 'Listener schema provenance mismatch' >&2; exit 2;
}
runtime_account_mode=$(env_value BEACON_LISTENER_ACCOUNT_ENABLED)
if test "$account_mode" -eq 1; then
  test "$runtime_account_mode" = 1 || { echo 'Listener Account mode mismatch' >&2; exit 2; }
else
  case "$runtime_account_mode" in ''|0) ;; *) echo 'Listener Account mode mismatch' >&2; exit 2 ;; esac
fi

if test "$account_mode" -eq 1; then
  test "$(env_value BEACON_LISTENER_ACCOUNT_ENVIRONMENT)" = production || {
    echo 'Listener Account environment mismatch' >&2; exit 2;
  }
  client_secret=$(env_value BEACON_LISTENER_ACCOUNT_CLIENT_SECRET)
  state_secret=$(env_value BEACON_LISTENER_ACCOUNT_STATE_SECRET)
  test "${#client_secret}" -ge 32 && test "${#state_secret}" -ge 32 || {
    echo 'Listener Account credentials are missing' >&2; exit 2;
  }
  test "$client_secret" != "$state_secret" || { echo 'Listener Account credentials are reused' >&2; exit 2; }
  for key in \
    BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING \
    BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING \
    EARLY_BIRDS_GOOGLE_CLIENT_ID \
    EARLY_BIRDS_GOOGLE_CLIENT_SECRET \
    BEACON_LISTENER_APPLE_CLIENT_ID \
    BEACON_LISTENER_APPLE_CLIENT_SECRET \
    EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL \
    EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN \
    EARLY_BIRDS_MAGIC_LINK_RATE_SECRET; do
    test -z "$(env_value "$key")" || {
      echo 'legacy or cross-environment identity material is active' >&2; exit 2;
    }
  done
  test "$(env_value BEACON_LISTENER_APPLE_ENABLED)" = 0 || {
    echo 'direct Listener Apple identity is active' >&2; exit 2;
  }
else
  test -z "$(env_value BEACON_LISTENER_ACCOUNT_CLIENT_SECRET)" || {
    echo 'Account-off Listener contains an Account credential' >&2; exit 2;
  }
  test -z "$(env_value BEACON_LISTENER_ACCOUNT_STATE_SECRET)" || {
    echo 'Account-off Listener contains an Account state secret' >&2; exit 2;
  }
fi

curl --fail --silent --show-error --connect-timeout 3 --max-time 8 \
  http://127.0.0.1:13000/api/health > "$work/local-health.json"
curl --fail --silent --show-error --connect-timeout 3 --max-time 8 \
  http://127.0.0.1:13000/api/health/ready > "$work/local-ready.json"
curl --fail --silent --show-error --connect-timeout 3 --max-time 8 \
  http://127.0.0.1:18080/healthz >/dev/null
curl --fail --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  https://listen.harmonicbeacon.com/api/health > "$work/public-health.json"
jq --exit-status --arg sha "$expected_sha" --arg schema "$expected_schema" \
  '.status == "ok" and .gitSha == $sha and .databaseSchemaVersion == $schema' \
  "$work/local-health.json" >/dev/null
jq --exit-status --arg sha "$expected_sha" --arg schema "$expected_schema" \
  '.status == "ok" and .gitSha == $sha and .databaseSchemaVersion == $schema' \
  "$work/public-health.json" >/dev/null
jq --exit-status '.status == "ok" and .checks.database == "ok" and .checks.listenerRuntime == "ok"' \
  "$work/local-ready.json" >/dev/null

login_code=$(curl --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  --dump-header "$work/login.headers" --output /dev/null --write-out '%{http_code}' \
  https://listen.harmonicbeacon.com/api/account/login)
if test "$account_mode" -eq 1; then
  case "$login_code" in 302|303) ;; *) echo 'public Account login did not redirect' >&2; exit 2 ;; esac
  grep -Eiq '^location: https://account\.harmonicbeacon\.com/api/account/auth/oauth2/authorize\?' \
    "$work/login.headers" || { echo 'public Account login targets the wrong issuer' >&2; exit 2; }
  grep -Eiq '^set-cookie: __Host-hb_listener_account_attempt=' "$work/login.headers" || {
    echo 'public Account login did not set its host-only attempt cookie' >&2; exit 2;
  }
  jq --exit-status '.checks.listenerAccount == "ok"' "$work/local-ready.json" >/dev/null
else
  test "$login_code" = 404 || { echo 'Account-off Listener exposes Account login' >&2; exit 2; }
fi

suffix_code=$(curl --silent --show-error --proto '=https' --connect-timeout 3 --max-time 8 \
  --output /dev/null --write-out '%{http_code}' \
  https://listen.harmonicbeacon.com/api/account/login/extra)
test "$suffix_code" = 404 || { echo 'public Listener Account suffix is exposed' >&2; exit 2; }
echo "Listener production health and Account mode $account_mode are exact at SHA $expected_sha."
