#!/usr/bin/env sh
set -eu

account_fail() {
  echo "beacon-account: $*" >&2
  exit 1
}

account_repo_root() {
  CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd
}

account_require_private_file() {
  file=$1
  test -f "$file" || account_fail "missing required file: $file"
  owner_mode=$(stat -c '%U:%G:%a' "$file")
  test "$owner_mode" = root:root:600 || account_fail "$file must be root:root 0600"
}

account_load_deploy_env() {
  deploy_file=$1
  account_require_private_file "$deploy_file"
  set -a
  # The deploy file contains only non-secret coordinates and is validated below.
  # shellcheck disable=SC1090
  . "$deploy_file"
  set +a
  : "${COMPOSE_PROJECT_NAME:?missing COMPOSE_PROJECT_NAME}"
  : "${BEACON_ACCOUNT_IMAGE_TAG:?missing BEACON_ACCOUNT_IMAGE_TAG}"
  : "${BEACON_ACCOUNT_GIT_SHA:?missing BEACON_ACCOUNT_GIT_SHA}"
  : "${BEACON_ACCOUNT_BUILD_TIME:?missing BEACON_ACCOUNT_BUILD_TIME}"
  : "${BEACON_ACCOUNT_SCHEMA_VERSION:?missing BEACON_ACCOUNT_SCHEMA_VERSION}"
  : "${BEACON_ACCOUNT_EXPECTED_PENDING_MIGRATIONS:?missing reviewed migration list}"
  : "${BEACON_ACCOUNT_PRODUCTION_ENV_FILE:?missing production env path}"
  : "${BEACON_ACCOUNT_STAGING_ENV_FILE:?missing staging env path}"
  : "${BEACON_ACCOUNT_STAGING_DB_ENV_FILE:?missing staging database env path}"
  : "${BEACON_ACCOUNT_BACKUP_DIR:?missing production backup directory}"
  : "${BEACON_ACCOUNT_BACKUP_KEY_FILE:?missing production backup encryption key file}"
  test "$COMPOSE_PROJECT_NAME" = beacon-account || account_fail 'unexpected Compose project'
  test "$BEACON_ACCOUNT_IMAGE_TAG" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'image tag and git SHA differ'
  echo "$BEACON_ACCOUNT_GIT_SHA" | grep -Eq '^[0-9a-f]{40}$' || account_fail 'git SHA must be exact sha40'
  test "${BEACON_ACCOUNT_PRODUCTION_PORT:-13002}" = 13002 || account_fail 'production port must be 13002'
  test "${BEACON_ACCOUNT_STAGING_PORT:-13003}" = 13003 || account_fail 'staging port must be 13003'
  account_require_private_file "$BEACON_ACCOUNT_PRODUCTION_ENV_FILE"
  account_require_private_file "$BEACON_ACCOUNT_STAGING_ENV_FILE"
  account_require_private_file "$BEACON_ACCOUNT_STAGING_DB_ENV_FILE"
  test "$BEACON_ACCOUNT_BACKUP_DIR" = /var/backups/harmonic-beacon/account ||
    account_fail 'unexpected backup directory'
  account_require_private_file "$BEACON_ACCOUNT_BACKUP_KEY_FILE"
  test "$(wc -c < "$BEACON_ACCOUNT_BACKUP_KEY_FILE")" -ge 48 || account_fail 'backup key is too short'
}

account_compose() {
  root=$(account_repo_root)
  docker compose --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ACCOUNT_DEPLOY_FILE" \
    -f "$root/ops/beacon-account/compose.yml" "$@"
}

account_validate() {
  root=$(account_repo_root)
  node "$root/ops/beacon-account/validate.mjs" \
    "$BEACON_ACCOUNT_PRODUCTION_ENV_FILE" "$BEACON_ACCOUNT_STAGING_ENV_FILE" \
    "$BEACON_ACCOUNT_STAGING_DB_ENV_FILE"
}

account_container_name() {
  case "$1" in
    production) echo beacon-account-account-production-1 ;;
    staging) echo beacon-account-account-staging-1 ;;
    *) account_fail 'environment must be production or staging' ;;
  esac
}

account_wait_healthy() {
  container=$1
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    state=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    [ "$state" = healthy ] && return 0
    [ "$state" = exited ] && account_fail "$container exited before readiness"
    attempts=$((attempts + 1))
    sleep 2
  done
  account_fail "$container did not become healthy"
}

account_verify_running() {
  environment=$1
  container=$(account_container_name "$environment")
  account_wait_healthy "$container"
  image=$(docker inspect "$container" --format '{{.Config.Image}}')
  test "$image" = "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" || account_fail 'running image mismatch'
  running_sha=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$running_sha" = "$BEACON_ACCOUNT_GIT_SHA" || account_fail 'running SHA mismatch'
  published=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')
  expected_port=13002
  [ "$environment" = staging ] && expected_port=13003
  echo "$published" | grep -Fq "127.0.0.1" || account_fail 'Account must bind loopback only'
  echo "$published" | grep -Fq "$expected_port" || account_fail 'Account port mismatch'
}

account_check_production_migrations() {
  mode=$1
  account_compose run --rm --no-deps account-production \
    node scripts/beacon-account/check-migrations.mjs "$mode"
}

account_backup_production() (
  backup_dir=$BEACON_ACCOUNT_BACKUP_DIR
  test -d "$backup_dir" || account_fail "missing backup directory: $backup_dir"
  test "$(stat -c '%U:%G:%a' "$backup_dir")" = root:root:700 ||
    account_fail "$backup_dir must be root:root 0700"
  backup_name="account-pre-${BEACON_ACCOUNT_GIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
  backup_work=$(mktemp -d /run/beacon-account-backup.XXXXXX)
  chmod 0700 "$backup_work"
  database_env="$backup_work/database.env"
  dump_fifo="$backup_work/dump.fifo"
  : > "$database_env"
  mkfifo -m 0600 "$dump_fifo"
  chmod 0600 "$database_env"
  trap 'rm -rf "$backup_work"; rm -f "$backup_dir/$backup_name"' EXIT HUP INT TERM
  sed -n '/^DATABASE_URL=/p' "$BEACON_ACCOUNT_PRODUCTION_ENV_FILE" > "$database_env"
  test "$(wc -l < "$database_env")" -eq 1 || account_fail 'production DATABASE_URL is missing or duplicated'
  docker run --rm --network earlybirds_preview_db_internal --env-file "$database_env" \
    postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 \
    sh -ec 'pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"' > "$dump_fifo" &
  dump_pid=$!
  if ! openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass "file:$BEACON_ACCOUNT_BACKUP_KEY_FILE" -in "$dump_fifo" -out "$backup_dir/$backup_name"; then
    kill "$dump_pid" >/dev/null 2>&1 || true
    wait "$dump_pid" >/dev/null 2>&1 || true
    account_fail 'production backup encryption failed'
  fi
  wait "$dump_pid" || account_fail 'production pg_dump failed'
  rm -rf "$backup_work"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass "file:$BEACON_ACCOUNT_BACKUP_KEY_FILE" -in "$backup_dir/$backup_name" |
    docker run --rm -i postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 \
      pg_restore --list >/dev/null || account_fail 'encrypted backup verification failed'
  trap - EXIT HUP INT TERM
  test -s "$backup_dir/$backup_name" || account_fail 'production backup is empty'
  chmod 0600 "$backup_dir/$backup_name"
  printf '%s\n' "$backup_dir/$backup_name"
)

account_capture_previous_runtime() {
  environment=$1
  container=$(account_container_name "$environment")
  if ! docker inspect "$container" >/dev/null 2>&1; then
    printf '\n'
    return 0
  fi
  previous_tag=$(docker inspect "$container" --format '{{.Config.Image}}' | sed 's#^harmonic-beacon/account:##')
  previous_sha=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  echo "$previous_sha" | grep -Eq '^[0-9a-f]{40}$' || account_fail 'previous Account SHA is invalid'
  test "$previous_tag" = "$previous_sha" || account_fail 'previous Account image/SHA mismatch'
  printf '%s\n' "$previous_sha"
}

account_restore_previous_runtime() {
  environment=$1
  previous_sha=$2
  container=$(account_container_name "$environment")
  if [ -z "$previous_sha" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
    return 0
  fi
  BEACON_ACCOUNT_IMAGE_TAG=$previous_sha BEACON_ACCOUNT_GIT_SHA=$previous_sha \
    account_compose up -d --no-deps --no-build "account-$environment"
  account_wait_healthy "$container"
}
