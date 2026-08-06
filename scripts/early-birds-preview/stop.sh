#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/stop.sh /secure/preview.env}
require_synthetic_env "$env_file"
preview_compose_command "$env_file" stop postgres beacon-stream
echo 'EarlyBirds preview services stopped; preview volume retained for a migration rollback rehearsal.'
