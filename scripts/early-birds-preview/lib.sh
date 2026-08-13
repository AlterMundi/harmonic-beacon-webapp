#!/usr/bin/env sh
set -eu

preview_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
preview_compose="$preview_root/ops/early-birds-preview/compose.yml"
stream_compose="$preview_root/services/beacon-stream/docker-compose.yml"
preview_overlay="$preview_root/ops/early-birds-preview/stream-build.override.yml"
authority_overlay="$preview_root/ops/early-birds-preview/authority-network.override.yml"
preview_project=earlybirds-preview

preview_env_value() {
  preview_key=${1:?usage: preview_env_value KEY FILE}
  preview_value_file=${2:?usage: preview_env_value KEY FILE}
  sed -n "s/^${preview_key}=//p" "$preview_value_file" | tail -n 1 | tr -d '\r'
}

preview_fail() {
  echo "refusing to run: $1" >&2
  exit 2
}

require_exact_preview_value() {
  required_key=${1:?usage: require_exact_preview_value KEY VALUE FILE}
  required_value=${2:?usage: require_exact_preview_value KEY VALUE FILE}
  required_file=${3:?usage: require_exact_preview_value KEY VALUE FILE}
  actual_value=$(preview_env_value "$required_key" "$required_file")
  test "$actual_value" = "$required_value" || preview_fail "$required_key must be $required_value"
}

require_synthetic_secret() {
  secret_key=${1:?usage: require_synthetic_secret KEY MIN_LENGTH FILE}
  secret_min_length=${2:?usage: require_synthetic_secret KEY MIN_LENGTH FILE}
  secret_file=${3:?usage: require_synthetic_secret KEY MIN_LENGTH FILE}
  secret_value=$(preview_env_value "$secret_key" "$secret_file")
  case "$secret_value" in
    synthetic-*) ;;
    *) preview_fail "$secret_key must remain visibly synthetic" ;;
  esac
  test "${#secret_value}" -ge "$secret_min_length" || preview_fail "$secret_key is too short"
}

require_withdrawal_operator_image() {
  operator_env_file=${1:?usage: require_withdrawal_operator_image FILE}
  operator_tag=$(preview_env_value EARLYBIRDS_WITHDRAWAL_OPERATOR_IMAGE_TAG "$operator_env_file")
  operator_expected_sha=$(preview_env_value EARLYBIRDS_WITHDRAWAL_OPERATOR_GIT_SHA "$operator_env_file")
  operator_environment=$(preview_env_value EARLYBIRDS_PREVIEW_ENV "$operator_env_file")
  if test "$operator_environment" = synthetic; then
    test "$operator_tag" = synthetic || preview_fail 'synthetic withdrawal operator image tag must be synthetic'
    test "$operator_expected_sha" = synthetic-preview || preview_fail 'synthetic withdrawal operator provenance must be synthetic-preview'
  else
    test -n "$operator_tag" || preview_fail 'EARLYBIRDS_WITHDRAWAL_OPERATOR_IMAGE_TAG is required'
    test -n "$operator_expected_sha" || preview_fail 'EARLYBIRDS_WITHDRAWAL_OPERATOR_GIT_SHA is required'
    printf '%s\n' "$operator_tag" | grep -Eq '^[0-9a-f]{40}$' || \
      preview_fail 'EARLYBIRDS_WITHDRAWAL_OPERATOR_IMAGE_TAG must be an exact lowercase sha40'
    test "$operator_expected_sha" = "$operator_tag" || \
      preview_fail 'withdrawal operator image tag must match EARLYBIRDS_WITHDRAWAL_OPERATOR_GIT_SHA'
  fi
  operator_image="harmonic-beacon/earlybirds-preview-listener:$operator_tag"
  operator_actual_sha=$(docker image inspect "$operator_image" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | \
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$operator_actual_sha" = "$operator_expected_sha" || \
    preview_fail 'withdrawal operator image provenance does not match its pinned tag'
}

verify_running_withdrawal_operator() {
  operator_env_file=${1:?usage: verify_running_withdrawal_operator FILE}
  operator_expected_sha=$(preview_env_value EARLYBIRDS_WITHDRAWAL_OPERATOR_GIT_SHA "$operator_env_file")
  operator_container="${LISTENER_WITHDRAWAL_CONTAINER:-earlybirds-preview-withdrawal-operator-1}"
  operator_state=$(docker inspect "$operator_container" \
    --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
  test "$operator_state" = 'true healthy' || preview_fail 'withdrawal operator container is not healthy'
  operator_running_sha=$(docker inspect "$operator_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | \
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$operator_running_sha" = "$operator_expected_sha" || \
    preview_fail 'running withdrawal operator provenance does not match its pinned SHA'
}

require_synthetic_env() {
  env_file=${1:?usage: provide a synthetic preview env file}
  test -f "$env_file" || preview_fail "preview env file not found: $env_file"

  require_exact_preview_value EARLYBIRDS_PREVIEW_ENV synthetic "$env_file"
  require_exact_preview_value EARLYBIRDS_PREVIEW_DB_USER earlybirds_preview "$env_file"
  require_exact_preview_value EARLYBIRDS_PREVIEW_DB_NAME earlybirds_preview "$env_file"
  require_exact_preview_value EARLYBIRDS_PREVIEW_APP_PORT 13000 "$env_file"
  require_exact_preview_value BEACON_STREAM_HOST_PORT 18080 "$env_file"
  schema_version=$(preview_env_value EARLYBIRDS_PREVIEW_SCHEMA_VERSION "$env_file")
  printf '%s\n' "$schema_version" | grep -Eq '^[0-9]{14}_[a-z0-9_]+$' || \
    preview_fail 'EARLYBIRDS_PREVIEW_SCHEMA_VERSION must name a checked-in Prisma migration'
  google_client_id=$(preview_env_value EARLY_BIRDS_GOOGLE_CLIENT_ID "$env_file")
  google_client_secret=$(preview_env_value EARLY_BIRDS_GOOGLE_CLIENT_SECRET "$env_file")
  apple_client_id=$(preview_env_value EARLY_BIRDS_APPLE_CLIENT_ID "$env_file")
  apple_client_secret=$(preview_env_value EARLY_BIRDS_APPLE_CLIENT_SECRET "$env_file")
  if { test -n "$google_client_id" && test -z "$google_client_secret"; } || \
     { test -z "$google_client_id" && test -n "$google_client_secret"; }; then
    preview_fail 'Google OAuth client ID and secret must be configured together'
  fi
  if { test -n "$apple_client_id" && test -z "$apple_client_secret"; } || \
     { test -z "$apple_client_id" && test -n "$apple_client_secret"; }; then
    preview_fail 'Apple OAuth client ID and secret must be configured together'
  fi
  if test -n "$google_client_id" || test -n "$apple_client_id"; then
    require_exact_preview_value EARLY_BIRDS_AUTH_BASE_URL https://listen.harmonicbeacon.com "$env_file"
    require_exact_preview_value EARLY_BIRDS_TRUSTED_ORIGINS \
      https://listen.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com "$env_file"
  else
    require_exact_preview_value EARLY_BIRDS_AUTH_BASE_URL https://earlybirds-staging.harmonicbeacon.com "$env_file"
    require_exact_preview_value EARLY_BIRDS_TRUSTED_ORIGINS https://earlybirds-staging.harmonicbeacon.com "$env_file"
  fi
  require_exact_preview_value EARLY_BIRDS_STREAM_ORIGIN https://stream.harmonicbeacon.com "$env_file"
  require_exact_preview_value BEACON_STREAM_PUBLIC_ORIGIN https://stream.harmonicbeacon.com "$env_file"
  stream_allowed_origins=$(preview_env_value BEACON_STREAM_ALLOWED_ORIGINS "$env_file")
  case "$stream_allowed_origins" in
    https://earlybirds-staging.harmonicbeacon.com|\
    https://earlybirds-staging.harmonicbeacon.com,https://listen.harmonicbeacon.com) ;;
    *) preview_fail 'BEACON_STREAM_ALLOWED_ORIGINS must contain only the reviewed Listener hosts' ;;
  esac
  listener_artifact=$(preview_env_value EARLY_BIRDS_STREAM_ARTIFACT_ID "$env_file")
  origin_artifact=$(preview_env_value BEACON_STREAM_ARTIFACT_ID "$env_file")
  test "$listener_artifact" = "$origin_artifact" || preview_fail 'Listener and origin artifact IDs must match'
  case "$listener_artifact" in
    synthetic-preview-artifact|beacon-luz-20260624-aac320-v1|beacon-luz-20260624-2hs-aac320-v2) ;;
    *) preview_fail 'stream artifact is not approved for synthetic staging' ;;
  esac
  require_exact_preview_value EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS earlybirds-staging.harmonicbeacon.com "$env_file"
  geoip_host_path=$(preview_env_value BEACON_LISTENER_GEOIP_HOST_PATH "$env_file")
  case "$geoip_host_path" in
    /*/dbip-country-lite-2026-07.mmdb) ;;
    *) preview_fail 'BEACON_LISTENER_GEOIP_HOST_PATH must be the reviewed absolute July 2026 Country MMDB path' ;;
  esac

  kill_switch=$(preview_env_value EARLY_BIRDS_ENABLED "$env_file")
  case "$kill_switch" in 0|1) ;; *) preview_fail 'EARLY_BIRDS_ENABLED must be 0 or 1' ;; esac
  free_for_all_switch=$(preview_env_value EARLY_BIRDS_FREE_FOR_ALL "$env_file")
  case "$free_for_all_switch" in 0|1) ;; *) preview_fail 'EARLY_BIRDS_FREE_FOR_ALL must be 0 or 1' ;; esac
  team_entry_switch=$(preview_env_value EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED "$env_file")
  case "$team_entry_switch" in 0|1) ;; *) preview_fail 'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED must be 0 or 1' ;; esac
  reactive_lab_switch=$(preview_env_value BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED "$env_file")
  case "$reactive_lab_switch" in ''|0|1) ;; *) preview_fail 'BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED must be 0 or 1' ;; esac
  withdrawal_switch=$(preview_env_value LISTENER_WITHDRAWAL_ENABLED "$env_file")
  case "$withdrawal_switch" in ''|0|1) ;; *) preview_fail 'LISTENER_WITHDRAWAL_ENABLED must be 0 or 1' ;; esac
  withdrawal_secret=$(preview_env_value LISTENER_WITHDRAWAL_SECRET "$env_file")
  if test "$withdrawal_switch" = 1; then
    test "${#withdrawal_secret}" -ge 32 || preview_fail 'LISTENER_WITHDRAWAL_SECRET is required when withdrawal is enabled'
  fi
  paypal_checkout_switch=$(preview_env_value BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED "$env_file")
  case "$paypal_checkout_switch" in ''|0|1) ;; *) preview_fail 'BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED must be 0 or 1' ;; esac
  mercado_pago_checkout_switch=$(preview_env_value BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED "$env_file")
  case "$mercado_pago_checkout_switch" in ''|0|1) ;; *) preview_fail 'BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED must be 0 or 1' ;; esac
  require_exact_preview_value BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED 0 "$env_file"
  require_exact_preview_value BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED 0 "$env_file"
  require_exact_preview_value BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED 0 "$env_file"
  test -z "$(preview_env_value BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID "$env_file")" || \
    preview_fail 'synthetic preview cannot contain a private Live account allowlist'
  test -z "$(preview_env_value BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER "$env_file")" || \
    preview_fail 'synthetic preview cannot select a private Live provider'
  test -z "$(preview_env_value BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET "$env_file")" || \
    preview_fail 'synthetic preview cannot contain a private Live CSRF secret'
  require_exact_preview_value EARLY_BIRDS_TEST_ACCESS_ENABLED 1 "$env_file"

  authority_network=$(preview_env_value EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK "$env_file")
  if test -n "$authority_network"; then
    test "$authority_network" = earlybirds_authority_private || preview_fail 'authority network must be earlybirds_authority_private'
    require_exact_preview_value EARLY_BIRDS_AUTHORITY_BASE_URL http://pmp-myth-api:8765 "$env_file"
  else
    require_exact_preview_value EARLY_BIRDS_AUTHORITY_BASE_URL https://authority.example.invalid "$env_file"
  fi

  require_synthetic_secret EARLYBIRDS_PREVIEW_DB_PASSWORD 24 "$env_file"
  require_synthetic_secret EARLY_BIRDS_AUTH_SECRET 32 "$env_file"
  require_synthetic_secret EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN 43 "$env_file"
  require_synthetic_secret EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT 43 "$env_file"
  require_synthetic_secret EARLY_BIRDS_STREAM_SIGNING_SECRET 32 "$env_file"
  require_synthetic_secret EARLY_BIRDS_DEVICE_PEPPER 32 "$env_file"
  require_synthetic_secret EARLY_BIRDS_TEST_LOGIN_SECRET 32 "$env_file"
  require_synthetic_secret BEACON_STREAM_SIGNING_SECRET 32 "$env_file"

  listener_signing_secret=$(preview_env_value EARLY_BIRDS_STREAM_SIGNING_SECRET "$env_file")
  origin_signing_secret=$(preview_env_value BEACON_STREAM_SIGNING_SECRET "$env_file")
  test "$listener_signing_secret" = "$origin_signing_secret" || preview_fail 'Listener and origin signing secrets must match'

  effective_assignments=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$env_file" || true)
  while IFS= read -r assignment; do
    test -n "$assignment" || continue
    case "$assignment" in
      EARLY_BIRDS_AUTH_BASE_URL=https://earlybirds-staging.harmonicbeacon.com|\
      EARLY_BIRDS_TRUSTED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com|\
      EARLY_BIRDS_AUTH_BASE_URL=https://listen.harmonicbeacon.com|\
      EARLY_BIRDS_TRUSTED_ORIGINS=https://listen.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com|\
      EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS=earlybirds-staging.harmonicbeacon.com|\
      EARLY_BIRDS_STREAM_ORIGIN=https://stream.harmonicbeacon.com|\
      BEACON_STREAM_PUBLIC_ORIGIN=https://stream.harmonicbeacon.com|\
      BEACON_STREAM_ALLOWED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com|\
      BEACON_STREAM_ALLOWED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com,https://listen.harmonicbeacon.com) ;;
      *harmonicbeacon.com*) preview_fail 'synthetic preview env contains a non-staging Harmonic Beacon hostname' ;;
    esac
    assignment_value=${assignment#*=}
    case "$assignment_value" in
      *[Pp][Aa][Yy][Pp][Aa][Ll]*|*[Mm][Ee][Rr][Cc][Aa][Dd][Oo][Pp][Aa][Gg][Oo]*|*[Pp][Rr][Oo][Dd][Uu][Cc][Tt][Ii][Oo][Nn]*)
        preview_fail 'synthetic preview env contains a production/provider value'
        ;;
    esac
  done <<EOF
$effective_assignments
EOF
}

preview_compose_command() {
  env_file=${1:?usage: provide a synthetic preview env file}
  shift
  authority_network=$(preview_env_value EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK "$env_file")
  if test -n "$authority_network"; then
    authority_internal=$(docker network inspect --format '{{.Internal}}' "$authority_network" 2>/dev/null || true)
    test "$authority_internal" = true || preview_fail 'authority network must already exist with Internal=true'
    docker compose --project-name "$preview_project" --env-file "$env_file" \
      -f "$preview_compose" -f "$stream_compose" -f "$preview_overlay" \
      -f "$authority_overlay" "$@"
  else
    docker compose --project-name "$preview_project" --env-file "$env_file" \
      -f "$preview_compose" -f "$stream_compose" -f "$preview_overlay" "$@"
  fi
}
