#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/start-origin.sh /secure/preview.env}
require_synthetic_env "$env_file"

echo 'This command may recreate the isolated Beacon audio origin.'
echo 'Run it only in an explicit origin maintenance window with a decoded-audio canary ready.'
preview_compose_command "$env_file" up -d --build --no-deps beacon-stream
echo 'Beacon stream origin updated. Run health-smoke.sh and decoded-audio acceptance immediately.'
