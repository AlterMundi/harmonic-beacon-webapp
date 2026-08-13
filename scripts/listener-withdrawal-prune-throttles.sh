#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'listener withdrawal throttle pruning requires root' >&2
  exit 1
fi

container=${LISTENER_WITHDRAWAL_CONTAINER:-earlybirds-preview-listener-1}
docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null | grep -Fxq true || {
  echo 'Listener container is not running' >&2
  exit 1
}
exec docker exec --user root "$container" \
  npx --no-install tsx scripts/listener-withdrawal-operator.ts prune-throttles 48
