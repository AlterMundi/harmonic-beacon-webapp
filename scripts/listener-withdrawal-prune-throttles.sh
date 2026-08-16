#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'listener withdrawal throttle pruning requires root' >&2
  exit 1
fi

container=${LISTENER_WITHDRAWAL_CONTAINER:-earlybirds-preview-withdrawal-operator-1}
docker inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" \
  2>/dev/null | grep -Fxq 'true healthy' || {
  echo 'Listener withdrawal operator sidecar is not healthy' >&2
  exit 1
}
exec docker exec --user root "$container" \
  npx --no-install tsx scripts/listener-withdrawal-operator.ts prune-throttles 48
