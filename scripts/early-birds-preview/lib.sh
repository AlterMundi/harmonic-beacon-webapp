#!/usr/bin/env sh
set -eu

preview_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
preview_compose="$preview_root/ops/early-birds-preview/compose.yml"
stream_compose="$preview_root/services/beacon-stream/docker-compose.yml"
preview_project=earlybirds-preview

require_synthetic_env() {
  env_file=${1:?usage: provide a synthetic preview env file}
  test -f "$env_file" || { echo "preview env file not found: $env_file" >&2; exit 2; }
  grep -q '^EARLYBIRDS_PREVIEW_ENV=synthetic$' "$env_file" || {
    echo 'refusing to run: EARLYBIRDS_PREVIEW_ENV must be synthetic' >&2; exit 2;
  }
  if grep -Eiq '(harmonicbeacon\.com|paypal|mercadopago|production)' "$env_file"; then
    echo 'refusing to run: synthetic preview env contains a production/provider value' >&2; exit 2
  fi
}

preview_compose_command() {
  env_file=${1:?usage: provide a synthetic preview env file}
  shift
  docker compose --project-name "$preview_project" --env-file "$env_file" \
    -f "$preview_compose" -f "$stream_compose" "$@"
}
