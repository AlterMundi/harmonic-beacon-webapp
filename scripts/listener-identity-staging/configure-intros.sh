#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/lib.sh"

deploy_file=${1:?usage: configure-intros.sh /etc/harmonic-beacon/listener-identity-staging.deploy.env}
listener_staging_load "$deploy_file"
exec 9>/run/lock/listener-identity-staging.lock
flock -n 9 || listener_staging_fail 'another Listener staging operation is active'
listener_staging_assert_dependencies

manifest_entry() {
  language=$1
  awk -v marker="-$language-" '
    index($2, marker) { count += 1; value = $2 }
    END { if (count != 1) exit 1; print value }
  ' "$listener_staging_intro_manifest" ||
    listener_staging_fail "intro manifest has no unique $language artifact"
}

desired_es="/media/artifacts/$(manifest_entry es)"
desired_en="/media/artifacts/$(manifest_entry en)"
temporary=$(mktemp "${LISTENER_IDENTITY_STAGING_APP_ENV_FILE}.tmp.XXXXXX")
if ! awk -v desired_es="$desired_es" -v desired_en="$desired_en" '
  /^EARLY_BIRDS_DROPIN_ES_PATH=/ { es += 1; print "EARLY_BIRDS_DROPIN_ES_PATH=" desired_es; next }
  /^EARLY_BIRDS_DROPIN_EN_PATH=/ { en += 1; print "EARLY_BIRDS_DROPIN_EN_PATH=" desired_en; next }
  { print }
  END { if (es != 1 || en != 1) exit 1 }
' "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE" > "$temporary"; then
  rm -f "$temporary"
  listener_staging_fail 'could not install the reviewed intro paths atomically'
fi
chown root:root "$temporary"
chmod 0600 "$temporary"
mv "$temporary" "$LISTENER_IDENTITY_STAGING_APP_ENV_FILE"
echo 'Listener identity staging intro paths now select the two reviewed mounted artifacts; restart only through the reviewed lifecycle.'
