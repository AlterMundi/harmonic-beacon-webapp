#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/rollback.sh /secure/preview.env}
require_synthetic_env "$env_file"

# Stop public-serving components only. PostgreSQL and its named volume remain
# intact for inspection and an additive forward fix.
preview_compose_command "$env_file" stop listener beacon-stream
echo 'EarlyBirds Listener and stream origin stopped; preview PostgreSQL was retained.'
echo 'Set EARLY_BIRDS_ENABLED=0 and EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0 before the next start.'
echo 'No live/event service or volume was targeted.'
