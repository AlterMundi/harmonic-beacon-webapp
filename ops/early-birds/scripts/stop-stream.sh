#!/usr/bin/env sh
set -eu

environment_file=${1:?usage: ops/early-birds/scripts/stop-stream.sh /secure/earlybirds-stream.env}
repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)

# This project name and compose file are intentionally EarlyBirds-only. It
# cannot stop the event compose project, LiveKit or playlist-bot.
exec docker compose --project-name earlybirds-preview --env-file "$environment_file" \
  -f "$repository_root/services/beacon-stream/docker-compose.yml" stop beacon-stream
