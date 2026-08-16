#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/rehearse-migration.sh /secure/preview.env}
require_synthetic_env "$env_file"
preview_compose_command "$env_file" up -d postgres
# The migration service has no immutable image tag of its own. Build it from
# this exact release before running so Compose cannot reuse a migrator created
# from an older checkout and silently report that the new migration is absent.
preview_compose_command "$env_file" build migration
preview_compose_command "$env_file" run --rm migration
echo 'Preview-only Prisma migrate deploy passed. Rollback is kill-switch/route disable plus an additive forward migration.'
