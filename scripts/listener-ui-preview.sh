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
PREVIEW_REACTIVE_FIELD_LAB="${LISTENER_UI_PREVIEW_REACTIVE_FIELD_LAB_ENABLED:-1}"
PREVIEW_DROPIN_EN_PATH="${LISTENER_UI_PREVIEW_DROPIN_EN_PATH:-}"
PREVIEW_PAYPAL_CHECKOUT="${LISTENER_UI_PREVIEW_PAYPAL_SANDBOX_CHECKOUT_ENABLED:-0}"
PREVIEW_MERCADO_PAGO_CHECKOUT="${LISTENER_UI_PREVIEW_MERCADO_PAGO_TEST_CHECKOUT_ENABLED:-0}"
PREVIEW_LIVE_WORKBENCH="${LISTENER_UI_PREVIEW_LIVE_WORKBENCH_ENABLED:-0}"
PREVIEW_EXPECTED_SHA="${LISTENER_UI_PREVIEW_EXPECTED_SHA:-}"
LIVE_WORKBENCH_ENV_FILE="/etc/harmonic-beacon/listener-live-workbench.env"
PREVIEW_ORIGIN="https://earlybirds-staging.harmonicbeacon.com"

for switch in "$PREVIEW_FREE_FOR_ALL" "$PREVIEW_REACTIVE_FIELD_LAB" "$PREVIEW_PAYPAL_CHECKOUT" \
    "$PREVIEW_MERCADO_PAGO_CHECKOUT" "$PREVIEW_LIVE_WORKBENCH"; do
    case "$switch" in 0|1) ;; *) echo "Preview switches must be 0 or 1." >&2; exit 2 ;; esac
done

if [ -n "$PREVIEW_DROPIN_EN_PATH" ] &&
   [[ ! "$PREVIEW_DROPIN_EN_PATH" =~ ^/media/artifacts/drop-ins/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.m4a$ ]]; then
    echo "English intro preview must name one bounded immutable .m4a artifact." >&2
    exit 2
fi

payment_modes=$((PREVIEW_PAYPAL_CHECKOUT + PREVIEW_MERCADO_PAGO_CHECKOUT + PREVIEW_LIVE_WORKBENCH))
if [ "$payment_modes" -gt 0 ] && [ "$PREVIEW_FREE_FOR_ALL" != 0 ]; then
    echo "Payment checkout requires Free For All to be disabled." >&2
    exit 2
fi
if [ "$payment_modes" -gt 1 ]; then
    echo "Select exactly one payment provider or private Live workbench." >&2
    exit 2
fi
if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
    case "$PREVIEW_EXPECTED_SHA" in
        *[!0-9a-f]*|'') echo "Private Live workbench requires an exact lowercase 40-character SHA." >&2; exit 2 ;;
    esac
    [ "${#PREVIEW_EXPECTED_SHA}" -eq 40 ] || {
        echo "Private Live workbench requires an exact lowercase 40-character SHA." >&2
        exit 2
    }
elif [ -n "$PREVIEW_EXPECTED_SHA" ]; then
    echo "LISTENER_UI_PREVIEW_EXPECTED_SHA is valid only for the private Live workbench." >&2
    exit 2
fi

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
    ssh "$PREVIEW_HOST" "REMOTE_SOURCE='$REMOTE_SOURCE' REMOTE_NEXT='$REMOTE_NEXT' DEV_CONTAINER='$DEV_CONTAINER' RELEASE_CONTAINER='$RELEASE_CONTAINER' PREVIEW_FREE_FOR_ALL='$PREVIEW_FREE_FOR_ALL' PREVIEW_REACTIVE_FIELD_LAB='$PREVIEW_REACTIVE_FIELD_LAB' PREVIEW_DROPIN_EN_PATH='$PREVIEW_DROPIN_EN_PATH' PREVIEW_PAYPAL_CHECKOUT='$PREVIEW_PAYPAL_CHECKOUT' PREVIEW_MERCADO_PAGO_CHECKOUT='$PREVIEW_MERCADO_PAGO_CHECKOUT' PREVIEW_LIVE_WORKBENCH='$PREVIEW_LIVE_WORKBENCH' PREVIEW_EXPECTED_SHA='$PREVIEW_EXPECTED_SHA' LIVE_WORKBENCH_ENV_FILE='$LIVE_WORKBENCH_ENV_FILE' PREVIEW_ORIGIN='$PREVIEW_ORIGIN' bash -s" <<'REMOTE'
set -euo pipefail

if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
    image="harmonic-beacon/earlybirds-preview-listener:${PREVIEW_EXPECTED_SHA}"
    docker image inspect "$image" >/dev/null
    docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
        grep -Fqx "BEACON_GIT_SHA=$PREVIEW_EXPECTED_SHA"
else
    image="$(docker inspect "$RELEASE_CONTAINER" --format '{{.Config.Image}}')"
fi
env_file="$(mktemp /tmp/listener-ui-dev-env.XXXXXX)"
workbench_container_started=0
workbench_validated=0
cleanup() {
    rm -f "$env_file"
    if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ] &&
       [ "$workbench_container_started" = 1 ] &&
       [ "$workbench_validated" != 1 ]; then
        docker rm -f "$DEV_CONTAINER" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
umask 077
docker inspect "$RELEASE_CONTAINER" | jq -r '.[0].Config.Env[]' > "$env_file"

set_env_file_value() {
    key="$1"
    value="$2"
    sed -i "/^${key}=/d" "$env_file"
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
}

if [ -n "$PREVIEW_DROPIN_EN_PATH" ]; then
    set_env_file_value EARLY_BIRDS_DROPIN_EN_PATH "$PREVIEW_DROPIN_EN_PATH"
fi

install -d -m 0755 "$REMOTE_NEXT"
sudo chown 1001:1001 "$REMOTE_NEXT"
sudo install -m 0644 -o 1001 -g 1001 /dev/null "$REMOTE_NEXT/next-env.d.ts"

if docker container inspect "$DEV_CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$DEV_CONTAINER" >/dev/null
fi

runtime_args=()
command_args=()
if [ "$PREVIEW_PAYPAL_CHECKOUT" = 1 ] || [ "$PREVIEW_MERCADO_PAGO_CHECKOUT" = 1 ] || [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
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
    # Turbopack can stall indefinitely while compiling source bind-mounted
    # from the remote preview volume. Webpack is slower to cold-start but is
    # deterministic for this disposable network-mounted UI loop.
    command_args=(npm run dev -- --webpack --hostname 0.0.0.0 --port 3000)
fi

if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
    test "$(sudo stat -c '%u:%g:%a' "$LIVE_WORKBENCH_ENV_FILE")" = "0:0:600"
    sudo awk -F= '
        BEGIN { good=1 }
        /^[[:space:]]*$/ { next }
        $1 == "BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED" ||
        $1 == "BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID" ||
        $1 == "BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER" ||
        $1 == "BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET" { seen[$1]++; next }
        { good=0 }
        END {
            required[1]="BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED"
            required[2]="BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID"
            required[3]="BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER"
            required[4]="BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET"
            for (i=1; i<=4; i++) if (seen[required[i]] != 1) good=0
            exit good ? 0 : 1
        }
    ' "$LIVE_WORKBENCH_ENV_FILE"
    sudo cat "$LIVE_WORKBENCH_ENV_FILE" >> "$env_file"
    set_env_file_value EARLY_BIRDS_FREE_FOR_ALL 0
    set_env_file_value BEACON_LISTENER_FREE_FOR_ALL 0
    set_env_file_value BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED 0
    set_env_file_value BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED 0
    set_env_file_value BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED 0
    set_env_file_value BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED 0
    set_env_file_value BEACON_LISTENER_AUTH_BASE_URL "$PREVIEW_ORIGIN"
    set_env_file_value EARLY_BIRDS_AUTH_BASE_URL "$PREVIEW_ORIGIN"
    # The inherited release env would otherwise override the selected image's
    # baked provenance with the persistent 13000 release SHA.
    set_env_file_value BEACON_GIT_SHA "$PREVIEW_EXPECTED_SHA"
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
    -e BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED="$PREVIEW_REACTIVE_FIELD_LAB" \
    -e BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED="$PREVIEW_PAYPAL_CHECKOUT" \
    -e BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED="$PREVIEW_MERCADO_PAGO_CHECKOUT" \
    --network earlybirds_preview_db_internal \
    -p 127.0.0.1:13001:3000 \
    --volumes-from "$RELEASE_CONTAINER:ro" \
    "${runtime_args[@]}" \
    "$image" \
    "${command_args[@]}" >/dev/null
if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
    workbench_container_started=1
fi

docker network connect earlybirds_preview_listener_egress "$DEV_CONTAINER"
docker network connect earlybirds_authority_private "$DEV_CONTAINER"
docker network connect earlybirds_stream_control_internal "$DEV_CONTAINER"

for _ in $(seq 1 90); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:13001/api/health >/dev/null &&
       curl --fail --silent --max-time 3 http://127.0.0.1:13001/api/health/ready >/dev/null; then
        if [ "$PREVIEW_LIVE_WORKBENCH" = 1 ]; then
            running_sha="$(docker inspect "$DEV_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^BEACON_GIT_SHA=//p')"
            test "$running_sha" = "$PREVIEW_EXPECTED_SHA"
            test "$(docker port "$DEV_CONTAINER" 3000/tcp)" = "127.0.0.1:13001"
            workbench_validated=1
        fi
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
