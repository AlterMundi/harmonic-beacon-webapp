#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/start.sh /secure/preview.env}
require_synthetic_env "$env_file"
preview_compose_command "$env_file" up -d --build postgres beacon-stream
echo 'EarlyBirds synthetic preview started. Run health-smoke.sh after a synthetic artifact is available.'
