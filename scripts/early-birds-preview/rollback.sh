#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/rollback.sh /secure/preview.env}
require_synthetic_env "$env_file"

# Stop only the application control plane. PostgreSQL and its named volume
# remain intact for inspection, while the approved long-lived origin keeps
# serving already issued short-lived media URLs. Use stop-stream.sh only for
# a separately diagnosed origin incident.
preview_compose_command "$env_file" stop listener
echo 'EarlyBirds Listener stopped; withdrawal operator, preview PostgreSQL and Beacon origin were retained.'
echo 'Set EARLY_BIRDS_ENABLED=0, EARLY_BIRDS_FREE_FOR_ALL=0 and EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0 before the next start.'
echo 'No live/event service or volume was targeted.'
