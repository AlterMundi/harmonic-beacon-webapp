#!/usr/bin/env bash
# Regenerate db/test-fixture.sql from scratch.
#
# Spins up a throwaway Postgres container, applies migrations, seeds the
# shared test fixtures with the pinned test-only pepper (see db/README.md),
# and rewrites db/test-fixture.sql. Safe to run anytime — it only touches
# its own container and the committed dump file.
set -euo pipefail

cd "$(dirname "$0")/.."

CONTAINER="beacon-fixture-regen"
PORT="55433"
PEPPER="test-fixture-pepper-not-for-production"
DB_URL="postgresql://postgres:fixture@localhost:${PORT}/postgres?schema=public"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=fixture -p "${PORT}:5432" postgres:16-alpine >/dev/null
echo "Waiting for Postgres..."
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

DATABASE_URL="$DB_URL" npx prisma migrate deploy
DATABASE_URL="$DB_URL" TICKET_CODE_PEPPER="$PEPPER" npx tsx prisma/seed-test-fixtures.ts

docker exec "$CONTAINER" pg_dump -U postgres --no-owner --no-privileges postgres > db/test-fixture.sql
echo "Wrote db/test-fixture.sql ($(wc -l < db/test-fixture.sql) lines)."
