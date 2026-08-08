#!/usr/bin/env sh
set -eu

target=${1:?usage: install-geoip-country.sh /absolute/path/dbip-country-lite-2026-07.mmdb}
case "$target" in
  /*/dbip-country-lite-2026-07.mmdb) ;;
  *) echo 'refusing: target must be the absolute reviewed July 2026 MMDB path' >&2; exit 2 ;;
esac

url=https://download.db-ip.com/free/dbip-country-lite-2026-07.mmdb.gz
archive_sha256=989c57a9ad1c1c93032e28acc643afdf03597ea28480520f6f1c76ea6420507f
database_sha256=881e0b274fc0cc801fa7c33687a69810be605f80593769287cde10bdb9ee8bde
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

curl --fail --silent --show-error --location --max-time 120 "$url" \
  --output "$temporary/country.mmdb.gz"
printf '%s  %s\n' "$archive_sha256" "$temporary/country.mmdb.gz" | sha256sum --check --status
gzip -dc "$temporary/country.mmdb.gz" > "$temporary/country.mmdb"
printf '%s  %s\n' "$database_sha256" "$temporary/country.mmdb" | sha256sum --check --status

mkdir -p -- "$(dirname -- "$target")"
install -m 0444 "$temporary/country.mmdb" "$target"
echo "Installed reviewed DB-IP Country Lite MMDB at $target"
