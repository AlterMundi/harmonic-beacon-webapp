#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"
env_file=${1:?usage: scripts/early-birds-preview/rehearse-migration.sh /secure/preview.env}
require_synthetic_env "$env_file"
preview_compose_command "$env_file" up -d postgres
preview_compose_command "$env_file" --profile migration run --rm migration-rehearsal
echo 'Preview-only Prisma migration rehearsal passed. Prisma migrations are forward-only; rollback is route/origin disable plus additive data retention.'
