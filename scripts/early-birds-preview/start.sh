#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/start.sh /secure/preview.env}
require_synthetic_env "$env_file"

# Compose's completed-successfully dependency makes this order fail closed:
# PostgreSQL health -> forward-only migration -> Listener readiness.
preview_compose_command "$env_file" up -d --build listener beacon-stream
kill_switch=$(preview_env_value EARLY_BIRDS_ENABLED "$env_file")
team_entry_switch=$(preview_env_value EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED "$env_file")
echo "EarlyBirds synthetic preview started with EARLY_BIRDS_ENABLED=$kill_switch and EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=$team_entry_switch."
echo 'Run health-smoke.sh; keep the public entry disabled until every gate passes.'
