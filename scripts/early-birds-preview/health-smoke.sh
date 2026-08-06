#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/health-smoke.sh /secure/preview.env}
require_synthetic_env "$env_file"
app_port=$(preview_env_value EARLYBIRDS_PREVIEW_APP_PORT "$env_file")
stream_port=$(preview_env_value BEACON_STREAM_HOST_PORT "$env_file")

running_services=$(preview_compose_command "$env_file" ps --status running --services)
for service in postgres listener beacon-stream; do
  printf '%s\n' "$running_services" | grep -qx "$service" || {
    echo "preview service is not running: $service" >&2
    exit 1
  }
done

migration_id=$(preview_compose_command "$env_file" ps --all --quiet migration)
test -n "$migration_id" || { echo 'forward-only migration container is missing' >&2; exit 1; }
test "$(docker inspect --format '{{.State.ExitCode}}' "$migration_id")" = 0 || {
  echo 'forward-only migration did not complete successfully' >&2
  exit 1
}

preview_compose_command "$env_file" exec -T postgres sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
health_body=$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${app_port}/api/health")
expected_schema=$(preview_env_value EARLYBIRDS_PREVIEW_SCHEMA_VERSION "$env_file")
EXPECTED_SCHEMA="$expected_schema" node -e '
  let body = "";
  process.stdin.on("data", chunk => { body += chunk; });
  process.stdin.on("end", () => {
    const health = JSON.parse(body);
    if (health.databaseSchemaVersion !== process.env.EXPECTED_SCHEMA) {
      console.error(`Listener schema provenance mismatch: expected ${process.env.EXPECTED_SCHEMA}, got ${health.databaseSchemaVersion}`);
      process.exit(1);
    }
  });
' <<EOF
$health_body
EOF
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${app_port}/api/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${stream_port}/healthz" >/dev/null
preview_compose_command "$env_file" exec -T beacon-stream node -e \
  "fetch('http://127.0.0.1:9090/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
echo 'EarlyBirds preview smoke passed: migration, PostgreSQL, Listener liveness/readiness, and stream liveness/readiness.'
