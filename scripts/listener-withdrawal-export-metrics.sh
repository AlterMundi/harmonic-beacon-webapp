#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo 'listener withdrawal metrics export requires root' >&2
  exit 1
fi

container=${LISTENER_WITHDRAWAL_CONTAINER:-earlybirds-preview-withdrawal-operator-1}
metrics_dir=/var/lib/harmonic-beacon/metrics
metrics_file=$metrics_dir/listener-withdrawal.prom
docker inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" \
  2>/dev/null | grep -Fxq 'true healthy' || {
  echo 'Listener withdrawal operator sidecar is not healthy' >&2
  exit 1
}

install -d -o root -g root -m 0755 "$metrics_dir"
temporary=$(mktemp "$metrics_dir/.listener-withdrawal.XXXXXX")
trap 'rm -f "$temporary"' EXIT
docker exec --user root "$container" \
  npx --no-install tsx scripts/listener-withdrawal-operator.ts metrics >"$temporary"
printf '%s %s\n' beacon_listener_withdrawal_metrics_export_unixtime "$(date +%s)" >>"$temporary"
chown root:root "$temporary"
chmod 0644 "$temporary"
mv -f "$temporary" "$metrics_file"
trap - EXIT
