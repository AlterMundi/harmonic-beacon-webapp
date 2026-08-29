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
  : "${BEACON_ACCOUNT_MAIL_WORKER_PRODUCTION_ENV_FILE:?missing production mail worker env path}"
  : "${BEACON_ACCOUNT_MAIL_WORKER_STAGING_ENV_FILE:?missing staging mail worker env path}"
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
  account_require_private_file "$BEACON_ACCOUNT_MAIL_WORKER_PRODUCTION_ENV_FILE"
  account_require_private_file "$BEACON_ACCOUNT_MAIL_WORKER_STAGING_ENV_FILE"
  account_require_private_file "$BEACON_ACCOUNT_STAGING_DB_ENV_FILE"
  test "$BEACON_ACCOUNT_BACKUP_DIR" = /mnt/beacon-data/backups/account ||
    account_fail 'unexpected backup directory'
  command -v mountpoint >/dev/null 2>&1 || account_fail 'mountpoint command is unavailable'
  mountpoint -q /mnt/beacon-data ||
    account_fail '/mnt/beacon-data must be a mounted filesystem'
  test "$(findmnt -n -o TARGET --target /mnt/beacon-data 2>/dev/null)" = /mnt/beacon-data ||
    account_fail '/mnt/beacon-data mount identity is invalid'
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
  image="harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG"
  docker image inspect "$image" >/dev/null 2>&1 ||
    account_fail "missing exact Account image for validation: $image"
  docker run --rm --network none --read-only --cap-drop ALL --user 0:0 \
    --security-opt no-new-privileges \
    --mount "type=bind,src=$BEACON_ACCOUNT_PRODUCTION_ENV_FILE,dst=/run/account-production.env,readonly" \
    --mount "type=bind,src=$BEACON_ACCOUNT_STAGING_ENV_FILE,dst=/run/account-staging.env,readonly" \
    --mount "type=bind,src=$BEACON_ACCOUNT_STAGING_DB_ENV_FILE,dst=/run/account-staging-database.env,readonly" \
    --mount "type=bind,src=$BEACON_ACCOUNT_MAIL_WORKER_PRODUCTION_ENV_FILE,dst=/run/account-mail-worker-production.env,readonly" \
    --mount "type=bind,src=$BEACON_ACCOUNT_MAIL_WORKER_STAGING_ENV_FILE,dst=/run/account-mail-worker-staging.env,readonly" \
    --entrypoint node "$image" /app/ops/beacon-account/validate.mjs \
      /run/account-production.env /run/account-staging.env \
      /run/account-staging-database.env \
      /run/account-mail-worker-production.env \
      /run/account-mail-worker-staging.env
}

account_require_internal_mail_network() {
  environment=$1
  network="beacon_account_mail_$environment"
  metadata=$(docker network inspect "$network" --format '{{.Name}} {{.Driver}} {{.Internal}}' 2>/dev/null) ||
    account_fail "missing pre-created internal mail network: $network"
  test "$metadata" = "$network bridge true" ||
    account_fail "$network must be an exact internal bridge"
}

account_container_name() {
  case "$1" in
    production) echo beacon-account-account-production-1 ;;
    staging) echo beacon-account-account-staging-1 ;;
    *) account_fail 'environment must be production or staging' ;;
  esac
}

account_mail_worker_container_name() {
  case "$1" in
    production) echo beacon-account-account-mail-worker-production-1 ;;
    staging) echo beacon-account-account-mail-worker-staging-1 ;;
    *) account_fail 'environment must be production or staging' ;;
  esac
}

account_wait_healthy() {
  account_wait_container=$1
  account_wait_attempts=0
  while [ "$account_wait_attempts" -lt 60 ]; do
    state=$(docker inspect "$account_wait_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
    [ "$state" = healthy ] && return 0
    [ "$state" = exited ] && account_fail "$account_wait_container exited before readiness"
    account_wait_attempts=$((account_wait_attempts + 1))
    sleep 2
  done
  account_fail "$account_wait_container did not become healthy"
}

account_verify_running() {
  environment=$1
  expected_sha=${2:-$BEACON_ACCOUNT_GIT_SHA}
  expected_image_tag=${3:-$BEACON_ACCOUNT_IMAGE_TAG}
  expected_worker_present=${4:-1}
  case "$expected_worker_present" in 0|1) ;; *) account_fail 'expected worker presence must be 0 or 1' ;; esac
  container=$(account_container_name "$environment")
  worker=$(account_mail_worker_container_name "$environment")
  account_wait_healthy "$container"
  if [ "$expected_worker_present" -eq 1 ]; then
    account_wait_healthy "$worker"
  else
    worker_state=$(docker inspect "$worker" --format '{{.State.Status}}' 2>/dev/null || true)
    case "$worker_state" in
      ''|created|exited|dead) ;;
      *) account_fail 'Account mail worker must not be running for this image' ;;
    esac
  fi
  image=$(docker inspect "$container" --format '{{.Config.Image}}')
  test "$image" = "harmonic-beacon/account:$expected_image_tag" || account_fail 'running image mismatch'
  running_sha=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$running_sha" = "$expected_sha" || account_fail 'running SHA mismatch'
  published=$(docker inspect "$container" --format '{{json .HostConfig.PortBindings}}')
  expected_port=13002
  [ "$environment" = staging ] && expected_port=13003
  echo "$published" | grep -Fq "127.0.0.1" || account_fail 'Account must bind loopback only'
  echo "$published" | grep -Fq "$expected_port" || account_fail 'Account port mismatch'
  if [ "$expected_worker_present" -eq 1 ]; then
    worker_image=$(docker inspect "$worker" --format '{{.Config.Image}}')
    test "$worker_image" = "harmonic-beacon/account:$expected_image_tag" ||
      account_fail 'running mail worker image mismatch'
    worker_sha=$(docker inspect "$worker" --format '{{range .Config.Env}}{{println .}}{{end}}' |
      sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
    test "$worker_sha" = "$expected_sha" || account_fail 'running mail worker SHA mismatch'
    worker_published=$(docker inspect "$worker" --format '{{json .HostConfig.PortBindings}}')
    test "$worker_published" = null || test "$worker_published" = '{}' ||
      account_fail 'Account mail worker must not publish ports'
  fi
}

account_check_production_migrations() (
  mode=$1
  work=$(mktemp -d /run/beacon-account-migration-check.XXXXXX)
  trap 'rm -rf "$work"' EXIT HUP INT TERM
  account_write_production_admin_env "$work/admin.env"
  docker run --rm --network earlybirds_preview_db_internal --read-only --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges --env-file "$work/admin.env" \
    -e "BEACON_ACCOUNT_EXPECTED_PENDING_MIGRATIONS=$BEACON_ACCOUNT_EXPECTED_PENDING_MIGRATIONS" \
    -e "BEACON_ACCOUNT_SCHEMA_VERSION=$BEACON_ACCOUNT_SCHEMA_VERSION" \
    --entrypoint node "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" \
    /app/scripts/beacon-account/check-migrations.mjs "$mode"
  rm -rf "$work"
  trap - EXIT HUP INT TERM
)

account_write_production_admin_env() {
  target=$1
  container=earlybirds-preview-postgres-1
  state=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  test "$state" = healthy || account_fail 'production PostgreSQL is not healthy'
  networks=$(docker inspect "$container" --format '{{range $name,$value := .NetworkSettings.Networks}}{{println $name}}{{end}}')
  echo "$networks" | grep -Fxq earlybirds_preview_db_internal ||
    account_fail 'production PostgreSQL is outside its exact internal network'
  work=$(dirname -- "$target")
  inspect_file="$work/postgres-inspect.json"
  docker inspect "$container" > "$inspect_file"
  chmod 0600 "$inspect_file"
  docker run --rm --network none --read-only --cap-drop ALL --user 0:0 \
    --security-opt no-new-privileges \
    --mount "type=bind,src=$inspect_file,dst=/run/postgres-inspect.json,readonly" \
    --entrypoint node "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" -e '
      const fs = require("node:fs");
      const inspected = JSON.parse(fs.readFileSync("/run/postgres-inspect.json", "utf8"));
      if (!Array.isArray(inspected) || inspected.length !== 1) throw new Error("invalid PostgreSQL inspection");
      const values = new Map((inspected[0].Config?.Env ?? []).map((line) => {
        const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)];
      }));
      const user = values.get("POSTGRES_USER");
      const password = values.get("POSTGRES_PASSWORD");
      const database = values.get("POSTGRES_DB");
      if (user !== "earlybirds_preview" || database !== "earlybirds_preview" ||
          !password || password.length < 32) throw new Error("unexpected PostgreSQL authority identity");
      const url = new URL("postgresql://earlybirds-preview-postgres/earlybirds_preview?schema=public");
      url.username = user; url.password = password;
      process.stdout.write(`DATABASE_URL=${url.toString()}\n`);
    ' > "$target"
  rm -f "$inspect_file"
  chmod 0600 "$target"
  test "$(wc -l < "$target")" -eq 1 || account_fail 'migration database environment is invalid'
}

account_migrate_production() (
  work=$(mktemp -d /run/beacon-account-migrate.XXXXXX)
  trap 'rm -rf "$work"' EXIT HUP INT TERM
  account_write_production_admin_env "$work/admin.env"
  docker run --rm --network earlybirds_preview_db_internal --read-only --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges --env-file "$work/admin.env" \
    "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" npx prisma migrate deploy
)

account_provision_production_role() (
  work=$(mktemp -d /run/beacon-account-role.XXXXXX)
  trap 'rm -rf "$work"' EXIT HUP INT TERM
  account_write_production_admin_env "$work/admin.env"
  sed -n '/^DATABASE_URL=/p' "$BEACON_ACCOUNT_PRODUCTION_ENV_FILE" > "$work/runtime.env"
  chmod 0600 "$work/runtime.env"
  test "$(wc -l < "$work/runtime.env")" -eq 1 || account_fail 'production runtime DATABASE_URL is missing or duplicated'
  docker run --rm --network earlybirds_preview_db_internal --read-only --tmpfs /tmp \
    --cap-drop ALL --user 0:0 --security-opt no-new-privileges \
    --env-file "$work/admin.env" \
    --mount "type=bind,src=$work/runtime.env,dst=/run/account-runtime.env,readonly" \
    --entrypoint node "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" \
    /app/scripts/beacon-account/provision-production-role.mjs /run/account-runtime.env
)

account_provision_production_authority() {
  docker run --rm --network earlybirds_preview_db_internal --read-only --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges \
    --env-file "$BEACON_ACCOUNT_PRODUCTION_ENV_FILE" \
    "harmonic-beacon/account:$BEACON_ACCOUNT_IMAGE_TAG" npm run account:provision
}

account_backup_production() (
  root=$(account_repo_root)
  backup_dir=$BEACON_ACCOUNT_BACKUP_DIR
  test -d "$backup_dir" || account_fail "missing backup directory: $backup_dir"
  test "$(stat -c '%U:%G:%a' "$backup_dir")" = root:root:700 ||
    account_fail "$backup_dir must be root:root 0700"
  backup_name="account-pre-${BEACON_ACCOUNT_GIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
  test ! -e "$backup_dir/$backup_name" || account_fail 'production backup target already exists'
  backup_work=$(mktemp -d /run/beacon-account-backup.XXXXXX)
  chmod 0700 "$backup_work"
  database_env="$backup_work/database.env"
  dump_fifo="$backup_work/dump.fifo"
  : > "$database_env"
  mkfifo -m 0600 "$dump_fifo"
  chmod 0600 "$database_env"
  trap 'rm -rf "$backup_work"; rm -f "$backup_dir/$backup_name"' EXIT HUP INT TERM
  account_write_production_admin_env "$database_env"
  docker run --rm --network earlybirds_preview_db_internal --env-file "$database_env" \
    --mount "type=bind,src=$root/scripts/beacon-account/production-pg-dump.sh,dst=/usr/local/bin/beacon-account-production-pg-dump,readonly" \
    postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 \
    /usr/local/bin/beacon-account-production-pg-dump > "$dump_fifo" &
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

account_backup_staging() (
  backup_dir=$BEACON_ACCOUNT_BACKUP_DIR
  test -d "$backup_dir" || account_fail "missing backup directory: $backup_dir"
  test "$(stat -c '%U:%G:%a' "$backup_dir")" = root:root:700 ||
    account_fail "$backup_dir must be root:root 0700"
  container=beacon-account-account-staging-postgres-1
  state=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  test "$state" = healthy || account_fail 'staging PostgreSQL is not healthy'
  backup_name="account-staging-pre-provider-${BEACON_ACCOUNT_GIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
  test ! -e "$backup_dir/$backup_name" || account_fail 'staging backup target already exists'
  backup_work=$(mktemp -d /run/beacon-account-staging-backup.XXXXXX)
  chmod 0700 "$backup_work"
  dump_fifo="$backup_work/dump.fifo"
  mkfifo -m 0600 "$dump_fifo"
  trap 'rm -rf "$backup_work"; rm -f "$backup_dir/$backup_name"' EXIT HUP INT TERM
  docker exec "$container" sh -ec \
    'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
    > "$dump_fifo" &
  dump_pid=$!
  if ! openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass "file:$BEACON_ACCOUNT_BACKUP_KEY_FILE" -in "$dump_fifo" -out "$backup_dir/$backup_name"; then
    kill "$dump_pid" >/dev/null 2>&1 || true
    wait "$dump_pid" >/dev/null 2>&1 || true
    account_fail 'staging backup encryption failed'
  fi
  wait "$dump_pid" || account_fail 'staging pg_dump failed'
  rm -rf "$backup_work"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass "file:$BEACON_ACCOUNT_BACKUP_KEY_FILE" -in "$backup_dir/$backup_name" |
    docker run --rm -i postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777 \
      pg_restore --list >/dev/null || account_fail 'encrypted staging backup verification failed'
  trap - EXIT HUP INT TERM
  test -s "$backup_dir/$backup_name" || account_fail 'staging backup is empty'
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

account_capture_previous_worker() {
  environment=$1
  previous_sha=$2
  worker=$(account_mail_worker_container_name "$environment")
  if ! docker inspect "$worker" >/dev/null 2>&1; then
    printf '0\n'
    return 0
  fi
  test -n "$previous_sha" || account_fail 'mail worker exists without prior Account runtime'
  worker_tag=$(docker inspect "$worker" --format '{{.Config.Image}}' | sed 's#^harmonic-beacon/account:##')
  worker_sha=$(docker inspect "$worker" --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^BEACON_GIT_SHA=//p' | tail -n 1)
  test "$worker_tag" = "$previous_sha" || account_fail 'previous mail worker image differs from app'
  test "$worker_sha" = "$previous_sha" || account_fail 'previous mail worker SHA differs from app'
  printf '1\n'
}

account_image_supports_mail_worker() {
  sha=$1
  docker run --rm --entrypoint sh "harmonic-beacon/account:$sha" -ec \
    'test -f scripts/process-account-mail-outbox.ts && node -e "const p=require(\"./package.json\");if(!p.scripts?.[\"account:mail-worker\"])process.exit(1)"' \
    >/dev/null 2>&1
}

account_image_supports_navigation_asset() {
  sha=$1
  docker image inspect "harmonic-beacon/account:$sha" \
    --format '{{range .Config.Env}}{{println .}}{{end}}' |
    grep -Fxq 'BEACON_ACCOUNT_NAV_ASSET=1'
}

account_restore_previous_runtime() {
  environment=$1
  previous_sha=$2
  previous_worker_present=${3:-1}
  container=$(account_container_name "$environment")
  worker=$(account_mail_worker_container_name "$environment")
  if [ -z "$previous_sha" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker rm -f "$worker" >/dev/null 2>&1 || true
    return 0
  fi
  if [ "$previous_worker_present" -eq 1 ]; then
    BEACON_ACCOUNT_IMAGE_TAG=$previous_sha BEACON_ACCOUNT_GIT_SHA=$previous_sha \
      account_compose up -d --no-deps --no-build \
        "account-mail-worker-$environment" "account-$environment"
    account_wait_healthy "$worker"
  else
    docker rm -f "$worker" >/dev/null 2>&1 || true
    BEACON_ACCOUNT_IMAGE_TAG=$previous_sha BEACON_ACCOUNT_GIT_SHA=$previous_sha \
      account_compose up -d --no-deps --no-build "account-$environment"
  fi
  account_wait_healthy "$container"
}
