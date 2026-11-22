#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: start.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
exec 9>/run/lock/listener-identity-staging.lock
flock -n 9 || listener_staging_fail 'another Listener staging operation is active'
listener_staging_assert_checkout
listener_staging_compose config --quiet
test "$#" -le 2 || listener_staging_fail 'unexpected staging arguments'
prepared_image=${2:-}
image="harmonic-beacon/listener-identity-staging:$LISTENER_IDENTITY_STAGING_IMAGE_TAG"
if test -z "$prepared_image"; then
  listener_staging_compose build app
  prepared_image=$(docker image inspect "$image" --format '{{.Id}}')
fi
listener_staging_assert_image_id "$image" "$prepared_image"
listener_staging_verify_image
# Mona intentionally has no host Node runtime. Validate the protected files
# with the exact reviewed image, before any database or runtime mutation.
listener_staging_validate_image
listener_staging_assert_dependencies
listener_staging_assert_port
protected_before=$(listener_staging_fingerprint_protected)
listener_staging_capture_previous
listener_staging_compose up -d postgres
listener_staging_wait_postgres
listener_staging_backup

cutover_started=0
rollback_on_error() {
  status=$?
  trap - EXIT HUP INT TERM
  if test "$status" -ne 0 && test "$cutover_started" = 1; then
    flock -u 9 || true
    "$(dirname -- "$0")/rollback.sh" "$deploy_file" || true
  fi
  exit "$status"
}
trap rollback_on_error EXIT HUP INT TERM

# Keep the public disposable runtime serving throughout validation, build and
# backup. Stop it only at the last reversible boundary before binding 13001.
if test "$(listener_staging_port_owner)" = listener-ui-dev; then
  docker stop listener-ui-dev >/dev/null
  cutover_started=1
fi

# Compose runs the exact-image, forward-only migration and starts the app only
# after migration exits successfully. It never targets the production project.
cutover_started=1
listener_staging_assert_image_id "$image" "$prepared_image"
listener_staging_compose up -d --no-build app
test "$(docker inspect listener-identity-staging-app --format '{{.Image}}')" = "$prepared_image" ||
  listener_staging_fail 'running staging image differs from the prepared image'
listener_staging_wait_healthy
"$(dirname -- "$0")/health-smoke.sh" "$deploy_file"
"$(dirname -- "$0")/edge-smoke.sh" "$deploy_file"
protected_after=$(listener_staging_fingerprint_protected)
test "$protected_before" = "$protected_after" ||
  listener_staging_fail 'a protected Listener production/event container changed during staging cutover'

listener_staging_publish_current "$image" "$prepared_image"

cutover_started=0
trap - EXIT HUP INT TERM
echo "Listener identity staging is healthy at exact SHA $LISTENER_IDENTITY_STAGING_GIT_SHA."
