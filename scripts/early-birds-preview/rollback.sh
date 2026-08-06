#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/rollback.sh /secure/preview.env}
require_synthetic_env "$env_file"
preview_compose_command "$env_file" stop beacon-stream
echo 'EarlyBirds stream origin stopped. No event service, event database, or production container was targeted.'
echo 'Disable the Listener entry feature flag in its owning application lane before announcing unavailability.'
