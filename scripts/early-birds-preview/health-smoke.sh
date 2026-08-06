#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/health-smoke.sh /secure/preview.env}
require_synthetic_env "$env_file"
port=$(sed -n 's/^BEACON_STREAM_HOST_PORT=//p' "$env_file" | tail -n 1)
port=${port:-18080}
preview_compose_command "$env_file" ps --status running postgres beacon-stream
preview_compose_command "$env_file" exec -T postgres sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
curl --fail --silent --show-error "http://127.0.0.1:${port}/readyz" >/dev/null
echo 'EarlyBirds synthetic preview health smoke passed (PostgreSQL and isolated stream ready).'
