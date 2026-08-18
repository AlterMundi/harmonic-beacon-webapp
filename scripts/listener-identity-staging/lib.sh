#!/usr/bin/env sh
set -eu

listener_staging_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
listener_staging_compose="$listener_staging_root/ops/listener-identity-staging/compose.yml"
listener_staging_nginx_source="$listener_staging_root/ops/early-birds-preview/nginx/earlybirds-staging.harmonicbeacon.com.conf.template"
listener_staging_nginx_target=/etc/nginx/sites-available/earlybirds-staging.harmonicbeacon.com
listener_staging_nginx_enabled=/etc/nginx/sites-enabled/earlybirds-staging.harmonicbeacon.com

listener_staging_fail() {
  echo "listener-identity-staging: $*" >&2
  exit 2
}

listener_staging_require_root() {
  test "$(id -u)" = 0 || listener_staging_fail 'run through the reviewed root wrapper (sudo), not with exported secrets'
}

listener_staging_require_private_file() {
  private_file=$1
  test -f "$private_file" || listener_staging_fail "missing protected file: $private_file"
  test "$(stat -c '%U:%G:%a' "$private_file")" = root:root:600 ||
    listener_staging_fail "$private_file must be root:root 0600"
}

listener_staging_load() {
  LISTENER_IDENTITY_STAGING_DEPLOY_FILE=$1
  export LISTENER_IDENTITY_STAGING_DEPLOY_FILE
  listener_staging_require_root
  listener_staging_require_private_file "$LISTENER_IDENTITY_STAGING_DEPLOY_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$LISTENER_IDENTITY_STAGING_DEPLOY_FILE"
  set +a
  : "${LISTENER_IDENTITY_STAGING_APP_ENV_FILE:?missing app env path}"
  : "${LISTENER_IDENTITY_STAGING_DATABASE_ENV_FILE:?missing database env path}"
  listener_staging_require_private_file "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE"
  listener_staging_require_private_file "$LISTENER_IDENTITY_STAGING_DATABASE_ENV_FILE"
  : "${LISTENER_IDENTITY_STAGING_IMAGE_TAG:?missing immutable image tag}"
  : "${LISTENER_IDENTITY_STAGING_GIT_SHA:?missing reviewed git SHA}"
}

listener_staging_compose() {
  docker compose --project-name listener-identity-staging \
    --env-file "$LISTENER_IDENTITY_STAGING_DEPLOY_FILE" \
    -f "$listener_staging_compose" "$@"
}

listener_staging_account_enabled() {
  awk -F= '
    $1 == "BEACON_LISTENER_ACCOUNT_ENABLED" { count += 1; value = $2 }
    END {
      if (count != 1 || (value != "0" && value != "1")) exit 1
      print value
    }
  ' "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE" ||
    listener_staging_fail 'Account enablement must be one exact 0/1 assignment in the protected app env'
}

listener_staging_restore_account_enabled() {
  previous_file="$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-account-enabled"
  test -f "$previous_file" || return 0
  previous=$(sed -n '1p' "$previous_file")
  test "$previous" = 0 || test "$previous" = 1 ||
    listener_staging_fail 'recorded rollback Account mode is invalid'
  test -z "$(sed -n '2p' "$previous_file")" ||
    listener_staging_fail 'recorded rollback Account mode has unexpected content'

  current=$(listener_staging_account_enabled)
  test "$current" != "$previous" || return 0
  temporary=$(mktemp "${LISTENER_IDENTITY_STAGING_APP_ENV_FILE}.tmp.XXXXXX")
  if ! awk -v desired="$previous" '
    /^BEACON_LISTENER_ACCOUNT_ENABLED=/ {
      count += 1
      print "BEACON_LISTENER_ACCOUNT_ENABLED=" desired
      next
    }
    { print }
    END { if (count != 1) exit 1 }
  ' "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE" > "$temporary"; then
    rm -f "$temporary"
    listener_staging_fail 'could not restore the prior Account mode atomically'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE"
  test "$(listener_staging_account_enabled)" = "$previous" ||
    listener_staging_fail 'restored app env does not match the prior Account mode'
}

listener_staging_assert_checkout() {
  test "$(git -C "$listener_staging_root" rev-parse HEAD)" = "$LISTENER_IDENTITY_STAGING_GIT_SHA" ||
    listener_staging_fail 'release checkout does not match the reviewed SHA'
  test -z "$(git -C "$listener_staging_root" status --porcelain)" ||
    listener_staging_fail 'release checkout is dirty'
}

listener_staging_assert_dependencies() {
  for network in earlybirds_stream_control_internal earlybirds_authority_private; do
    metadata=$(docker network inspect "$network" --format '{{.Name}} {{.Driver}} {{.Internal}}' 2>/dev/null) ||
      listener_staging_fail "missing reviewed external network: $network"
    test "$metadata" = "$network bridge true" ||
      listener_staging_fail "$network must remain an internal bridge"
  done
  for path in "$BEACON_STREAM_ARTIFACTS_HOST_PATH" "$BEACON_LISTENER_GEOIP_HOST_PATH"; do
    test -e "$path" || listener_staging_fail "required read-only artifact is absent: $path"
  done

  if docker network inspect listener_identity_staging_database >/dev/null 2>&1; then
    metadata=$(docker network inspect listener_identity_staging_database \
      --format '{{.Driver}} {{.Internal}} {{index .Labels "com.docker.compose.project"}}')
    test "$metadata" = 'bridge true listener-identity-staging' ||
      listener_staging_fail 'dedicated database network exists outside the reviewed project'
  fi
  if docker network inspect listener_identity_staging_egress >/dev/null 2>&1; then
    metadata=$(docker network inspect listener_identity_staging_egress \
      --format '{{.Driver}} {{.Internal}} {{index .Labels "com.docker.compose.project"}}')
    test "$metadata" = 'bridge false listener-identity-staging' ||
      listener_staging_fail 'dedicated egress network exists outside the reviewed project'
  fi
  if docker volume inspect listener-identity-staging-postgres >/dev/null 2>&1; then
    project=$(docker volume inspect listener-identity-staging-postgres \
      --format '{{index .Labels "com.docker.compose.project"}}')
    test "$project" = listener-identity-staging ||
      listener_staging_fail 'dedicated PostgreSQL volume exists outside the reviewed project'
  fi
}

listener_staging_port_owner() {
  docker ps --filter publish=13001 --format '{{.Names}}' | sed -n '1p'
}

listener_staging_assert_port() {
  owner=$(listener_staging_port_owner)
  test -z "$owner" || test "$owner" = listener-identity-staging-app || test "$owner" = listener-ui-dev ||
    listener_staging_fail "loopback 13001 is owned by an unexpected container: $owner"
}

listener_staging_fingerprint_protected() {
  for container in \
    earlybirds-preview-listener-1 earlybirds-preview-postgres-1 \
    beacon-app beacon-postgres beacon-livekit beacon-playlist-bot beacon-tapestry; do
    docker inspect "$container" --format '{{.Name}} {{.Id}} {{.Config.Image}}' 2>/dev/null ||
      listener_staging_fail "protected container is absent: $container"
  done
}

listener_staging_wait_healthy() {
  attempts=0
  while test "$attempts" -lt 60; do
    state=$(docker inspect listener-identity-staging-app \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    test "$state" = healthy && return 0
    test "$state" != exited || listener_staging_fail 'application exited before readiness'
    attempts=$((attempts + 1))
    sleep 2
  done
  listener_staging_fail 'application did not become healthy'
}

listener_staging_wait_postgres() {
  attempts=0
  while test "$attempts" -lt 30; do
    state=$(docker inspect listener-identity-staging-postgres \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    test "$state" = healthy && return 0
    test "$state" != exited || listener_staging_fail 'PostgreSQL exited before readiness'
    attempts=$((attempts + 1))
    sleep 2
  done
  listener_staging_fail 'PostgreSQL did not become healthy'
}

listener_staging_capture_previous() {
  install -d -o root -g root -m 0700 "$LISTENER_IDENTITY_STAGING_STATE_DIR"
  # Rollback state describes only the runtime observed at the start of this
  # attempt. Never inherit a failed candidate from an earlier attempt.
  rm -f "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-image" \
    "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-account-enabled" \
    "$LISTENER_IDENTITY_STAGING_STATE_DIR/legacy-runtime"
  if docker inspect listener-identity-staging-app >/dev/null 2>&1; then
    running=$(docker inspect listener-identity-staging-app --format '{{.State.Running}}')
    health=$(docker inspect listener-identity-staging-app \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
    if test "$running" = true && test "$health" = healthy; then
      previous=$(docker inspect listener-identity-staging-app --format '{{.Config.Image}}')
      printf '%s\n' "$previous" | grep -Eq '^harmonic-beacon/listener-identity-staging:[0-9a-f]{40}$' ||
        listener_staging_fail 'healthy staging app is not an immutable Listener image'
      printf '%s\n' "$previous" > "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-image"
      previous_account=$(docker inspect listener-identity-staging-app \
        --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '
          $1 == "BEACON_LISTENER_ACCOUNT_ENABLED" { count += 1; value = $2 }
          END {
            if (count != 1 || (value != "0" && value != "1")) exit 1
            print value
          }
        ') || listener_staging_fail 'accepted staging app has an invalid Account mode'
      printf '%s\n' "$previous_account" > \
        "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-account-enabled"
      chmod 0600 "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-image" \
        "$LISTENER_IDENTITY_STAGING_STATE_DIR/previous-account-enabled"
    fi
  fi
  if docker inspect listener-ui-dev >/dev/null 2>&1; then
    docker inspect listener-ui-dev --format '{{.Id}} {{.Config.Image}}' \
      > "$LISTENER_IDENTITY_STAGING_STATE_DIR/legacy-runtime"
    chmod 0600 "$LISTENER_IDENTITY_STAGING_STATE_DIR/legacy-runtime"
  fi
  test -f "$listener_staging_nginx_target" || listener_staging_fail 'public staging vhost is absent'
  test -L "$listener_staging_nginx_enabled" || listener_staging_fail 'public staging vhost is not enabled'
  test "$(readlink -f "$listener_staging_nginx_enabled")" = "$listener_staging_nginx_target" ||
    listener_staging_fail 'public staging vhost symlink targets an unexpected file'
  cp --preserve=mode,ownership,timestamps "$listener_staging_nginx_target" \
    "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.conf"
  sha256sum "$listener_staging_nginx_target" | awk '{print $1}' \
    > "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.sha256"
  chmod 0600 "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.conf" \
    "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.sha256"
}

listener_staging_restore_edge() {
  previous="$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.conf"
  test -f "$previous" || return 0
  expected=$(sed -n '1p' "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-previous.sha256")
  test "$(sha256sum "$previous" | awk '{print $1}')" = "$expected" ||
    listener_staging_fail 'backed-up staging vhost checksum mismatch'
  install -o root -g root -m 0644 "$previous" "$listener_staging_nginx_target"
  nginx -t
  systemctl reload nginx
}

listener_staging_install_edge() {
  test -f "$listener_staging_nginx_source" || listener_staging_fail 'reviewed staging vhost template is absent'
  install -o root -g root -m 0644 "$listener_staging_nginx_source" "$listener_staging_nginx_target"
  if ! nginx -t; then
    listener_staging_restore_edge || true
    listener_staging_fail 'reviewed staging vhost failed nginx validation'
  fi
  if ! systemctl reload nginx; then
    listener_staging_restore_edge || true
    listener_staging_fail 'nginx reload failed and the prior staging vhost was restored'
  fi
  expected=$(sha256sum "$listener_staging_nginx_source" | awk '{print $1}')
  test "$(sha256sum "$listener_staging_nginx_target" | awk '{print $1}')" = "$expected" ||
    listener_staging_fail 'installed staging vhost checksum differs from the reviewed template'
  printf '%s\n' "$expected" > "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-current.sha256"
  chmod 0600 "$LISTENER_IDENTITY_STAGING_STATE_DIR/nginx-current.sha256"
}

listener_staging_backup() {
  install -d -o root -g root -m 0700 "$LISTENER_IDENTITY_STAGING_BACKUP_DIR"
  backup="$LISTENER_IDENTITY_STAGING_BACKUP_DIR/pre-${LISTENER_IDENTITY_STAGING_GIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  listener_staging_compose exec -T postgres pg_dump \
    --username listener_identity_staging --dbname listener_identity_staging --format custom > "$backup"
  chmod 0600 "$backup"
  docker exec -i listener-identity-staging-postgres pg_restore --list < "$backup" >/dev/null
  printf '%s\n' "$backup" > "$LISTENER_IDENTITY_STAGING_STATE_DIR/last-backup"
  chmod 0600 "$LISTENER_IDENTITY_STAGING_STATE_DIR/last-backup"
}

listener_staging_verify_image() {
  image="harmonic-beacon/listener-identity-staging:$LISTENER_IDENTITY_STAGING_IMAGE_TAG"
  actual=$(docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$actual" = "$LISTENER_IDENTITY_STAGING_GIT_SHA" ||
    listener_staging_fail 'image provenance does not match its immutable tag'
}

listener_staging_validate_image() {
  image="harmonic-beacon/listener-identity-staging:$LISTENER_IDENTITY_STAGING_IMAGE_TAG"
  docker run --rm \
    --user 0:0 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:size=16m,mode=1777 \
    --mount "type=bind,src=$LISTENER_IDENTITY_STAGING_DEPLOY_FILE,dst=/run/listener-deploy.env,readonly" \
    --mount "type=bind,src=$LISTENER_IDENTITY_STAGING_APP_ENV_FILE,dst=/run/listener-app.env,readonly" \
    --mount "type=bind,src=$LISTENER_IDENTITY_STAGING_DATABASE_ENV_FILE,dst=/run/listener-database.env,readonly" \
    --entrypoint node \
    "$image" \
    /app/ops/listener-identity-staging/validate.mjs \
    /run/listener-deploy.env /run/listener-app.env /run/listener-database.env
}
