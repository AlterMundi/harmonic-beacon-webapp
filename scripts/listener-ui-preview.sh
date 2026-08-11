#!/usr/bin/env bash
set -euo pipefail

# Fast, disposable Listener UI loop. Source stays on the workstation, is synced
# to the secondary volume on mona, and is served by Next dev behind the existing
# staging hostname. The persistent Listener release on port 13000 is untouched.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIEW_HOST="${LISTENER_UI_PREVIEW_HOST:-mona}"
REMOTE_ROOT="${LISTENER_UI_PREVIEW_ROOT:-/mnt/beacon-data/listener-ui-dev}"
REMOTE_SOURCE="${REMOTE_ROOT}/source"
REMOTE_NEXT="${REMOTE_ROOT}/next"
DEV_CONTAINER="listener-ui-dev"
RELEASE_CONTAINER="earlybirds-preview-listener-1"
PREVIEW_FREE_FOR_ALL="${LISTENER_UI_PREVIEW_FREE_FOR_ALL:-1}"
PREVIEW_PAYPAL_CHECKOUT="${LISTENER_UI_PREVIEW_PAYPAL_SANDBOX_CHECKOUT_ENABLED:-0}"
PREVIEW_MERCADO_PAGO_CHECKOUT="${LISTENER_UI_PREVIEW_MERCADO_PAGO_TEST_CHECKOUT_ENABLED:-0}"
PREVIEW_ORIGIN="https://earlybirds-staging.harmonicbeacon.com"

case "$PREVIEW_FREE_FOR_ALL:$PREVIEW_PAYPAL_CHECKOUT:$PREVIEW_MERCADO_PAGO_CHECKOUT" in
    0:0:0|0:1:0|0:0:1|1:0:0) ;;
    1:1:0|1:0:1) echo "Payment checkout requires Free For All to be disabled." >&2; exit 2 ;;
    0:1:1|1:1:1) echo "Select exactly one payment provider in the workbench." >&2; exit 2 ;;
    *) echo "Preview switches must be 0 or 1." >&2; exit 2 ;;
esac

usage() {
    echo "Usage: $0 {start|sync|watch|status|stop|logs}" >&2
}

sync_source() {
    ssh "$PREVIEW_HOST" "sudo install -d -m 0755 -o \"\$(id -un)\" -g \"\$(id -gn)\" '$REMOTE_ROOT' '$REMOTE_SOURCE' '$REMOTE_SOURCE/src' '$REMOTE_SOURCE/public'"
    rsync -az --delete --chmod=D755,F644 "$ROOT_DIR/src/" "$PREVIEW_HOST:$REMOTE_SOURCE/src/"
    rsync -az --delete --chmod=D755,F644 "$ROOT_DIR/public/" "$PREVIEW_HOST:$REMOTE_SOURCE/public/"
    rsync -az --chmod=F644 \
        "$ROOT_DIR/next.config.ts" \
        "$ROOT_DIR/postcss.config.mjs" \
        "$ROOT_DIR/tsconfig.json" \
        "$PREVIEW_HOST:$REMOTE_SOURCE/"
}

start_remote() {
    ssh "$PREVIEW_HOST" "REMOTE_SOURCE='$REMOTE_SOURCE' REMOTE_NEXT='$REMOTE_NEXT' DEV_CONTAINER='$DEV_CONTAINER' RELEASE_CONTAINER='$RELEASE_CONTAINER' PREVIEW_FREE_FOR_ALL='$PREVIEW_FREE_FOR_ALL' PREVIEW_PAYPAL_CHECKOUT='$PREVIEW_PAYPAL_CHECKOUT' PREVIEW_MERCADO_PAGO_CHECKOUT='$PREVIEW_MERCADO_PAGO_CHECKOUT' PREVIEW_ORIGIN='$PREVIEW_ORIGIN' bash -s" <<'REMOTE'
set -euo pipefail

image="$(docker inspect "$RELEASE_CONTAINER" --format '{{.Config.Image}}')"
env_file="$(mktemp /tmp/listener-ui-dev-env.XXXXXX)"
cleanup() { rm -f "$env_file"; }
trap cleanup EXIT
umask 077
docker inspect "$RELEASE_CONTAINER" | jq -r '.[0].Config.Env[]' > "$env_file"

set_env_file_value() {
    key="$1"
    value="$2"
    sed -i "/^${key}=/d" "$env_file"
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
}

install -d -m 0755 "$REMOTE_NEXT"
sudo chown 1001:1001 "$REMOTE_NEXT"
sudo install -m 0644 -o 1001 -g 1001 /dev/null "$REMOTE_NEXT/next-env.d.ts"

if docker container inspect "$DEV_CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$DEV_CONTAINER" >/dev/null
fi

runtime_args=()
command_args=()
if [ "$PREVIEW_PAYPAL_CHECKOUT" = 1 ] || [ "$PREVIEW_MERCADO_PAGO_CHECKOUT" = 1 ]; then
    # Synthetic team entry is deliberately unavailable under NODE_ENV=development.
    # Payment rehearsal therefore runs the exact built release artifact.
    # OAuth state and session cookies are host-only. The workbench must initiate
    # and receive the callback on its own origin; inheriting the persistent
    # Listener base URL sends Google back to listen.harmonicbeacon.com, where
    # the staging state cookie is absent and Better Auth correctly rejects it.
    set_env_file_value BEACON_LISTENER_AUTH_BASE_URL "$PREVIEW_ORIGIN"
    set_env_file_value EARLY_BIRDS_AUTH_BASE_URL "$PREVIEW_ORIGIN"
    runtime_args=(-e NODE_ENV=production)
    command_args=(node server.js)
else
    runtime_args=(
        -e NODE_ENV=development
        -e BEACON_GIT_SHA=ui-dev
        -e WATCHPACK_POLLING=true
        -v "$REMOTE_SOURCE/src:/app/src:ro"
        -v "$REMOTE_SOURCE/public:/app/public:ro"
        -v "$REMOTE_SOURCE/next.config.ts:/app/next.config.ts:ro"
        -v "$REMOTE_NEXT/next-env.d.ts:/app/next-env.d.ts"
        -v "$REMOTE_SOURCE/postcss.config.mjs:/app/postcss.config.mjs:ro"
        -v "$REMOTE_SOURCE/tsconfig.json:/app/tsconfig.json:ro"
        -v "$REMOTE_NEXT:/app/.next"
    )
    command_args=(npm run dev -- --hostname 0.0.0.0 --port 3000)
fi

docker run -d \
    --name "$DEV_CONTAINER" \
    --restart unless-stopped \
    --init \
    --env-file "$env_file" \
    -e NEXT_TELEMETRY_DISABLED=1 \
    -e EARLY_BIRDS_ENABLED=1 \
    -e BEACON_LISTENER_ENABLED=1 \
    -e EARLY_BIRDS_FREE_FOR_ALL="$PREVIEW_FREE_FOR_ALL" \
    -e BEACON_LISTENER_FREE_FOR_ALL="$PREVIEW_FREE_FOR_ALL" \
    -e BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED="$PREVIEW_PAYPAL_CHECKOUT" \
    -e BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED="$PREVIEW_MERCADO_PAGO_CHECKOUT" \
    --network earlybirds_preview_db_internal \
    -p 127.0.0.1:13001:3000 \
    --volumes-from "$RELEASE_CONTAINER:ro" \
    "${runtime_args[@]}" \
    "$image" \
    "${command_args[@]}" >/dev/null

docker network connect earlybirds_preview_listener_egress "$DEV_CONTAINER"
docker network connect earlybirds_authority_private "$DEV_CONTAINER"

for _ in $(seq 1 90); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:13001/api/health >/dev/null; then
        exit 0
    fi
    sleep 1
done

docker logs --tail 80 "$DEV_CONTAINER" >&2
exit 1
REMOTE
}

case "${1:-}" in
    start)
        sync_source
        start_remote
        ;;
    sync)
        sync_source
        ;;
    watch)
        sync_source
        echo "Watching Listener UI sources; Ctrl-C stops only the sync loop."
        while inotifywait -qq -r -e close_write,create,delete,move \
            "$ROOT_DIR/src" "$ROOT_DIR/public" \
            "$ROOT_DIR/next.config.ts" "$ROOT_DIR/postcss.config.mjs" "$ROOT_DIR/tsconfig.json"; do
            sync_source
        done
        ;;
    status)
        ssh "$PREVIEW_HOST" "docker ps --filter name=^/${DEV_CONTAINER}$ --format '{{.Names}} {{.Image}} {{.Status}}'; curl --fail --silent http://127.0.0.1:13001/api/health; printf '\n'"
        ;;
    stop)
        ssh "$PREVIEW_HOST" "docker rm -f '$DEV_CONTAINER' >/dev/null 2>&1 || true"
        ;;
    logs)
        ssh "$PREVIEW_HOST" "docker logs --tail 120 -f '$DEV_CONTAINER'"
        ;;
    *)
        usage
        exit 2
        ;;
esac
