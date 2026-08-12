#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/start.sh /secure/preview.env}
require_synthetic_env "$env_file"

# Compose's completed-successfully dependency makes this order fail closed:
# PostgreSQL health -> forward-only migration -> Listener readiness. The
# long-lived audio origin is intentionally outside an ordinary app release;
# use start-origin.sh only in its own reviewed maintenance window.
preview_compose_command "$env_file" up -d --build listener
kill_switch=$(preview_env_value EARLY_BIRDS_ENABLED "$env_file")
free_for_all_switch=$(preview_env_value EARLY_BIRDS_FREE_FOR_ALL "$env_file")
team_entry_switch=$(preview_env_value EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED "$env_file")
echo "EarlyBirds synthetic preview started with EARLY_BIRDS_ENABLED=$kill_switch, EARLY_BIRDS_FREE_FOR_ALL=$free_for_all_switch and EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=$team_entry_switch."
echo 'The Beacon stream origin was not rebuilt, recreated or restarted.'
echo 'Run health-smoke.sh; keep the public entry disabled until every gate passes.'
