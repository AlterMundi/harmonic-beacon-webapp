# Shared test database fixture

`test-fixture.sql` is a complete PostgreSQL dump (schema + data) of a
ready-to-use testing database. It is the shared baseline every developer can
restore locally to try the full app without touching production data or
secrets. **The real database is never committed — this file is the only
database in the repo, and it is regenerated from `prisma/seed-test-fixtures.ts`.**

## What's inside

### Staff users — password is `test` for all

| Email | Role |
|---|---|
| `facilitator@test.beacon` | FACILITATOR |
| `operator1@test.beacon` | OPERATOR |
| `operator2@test.beacon` | OPERATOR |
| `admin@test.beacon` | ADMIN |

### Sessions (Saturday 2026-08-01, both `SCHEDULED`)

| Language | Room | Time (Costa Rica) |
|---|---|---|
| SPANISH | `weekend-test-spanish` | 08:30 |
| ENGLISH | `weekend-test-english` | 12:30 |

### Ticket codes (6 per session)

| Spanish session | English session | State | Notes |
|---|---|---|---|
| `TEST-ES-0001-000A` | `TEST-EN-0001-001A` | ISSUED | log in with any email (binds on first use) |
| `TEST-ES-0002-000B` | `TEST-EN-0002-001B` | ISSUED | |
| `TEST-ES-0003-000C` | `TEST-EN-0003-001C` | ISSUED | |
| `TEST-ES-0004-000D` | `TEST-EN-0004-001D` | BOUND | email must be `asistente@test.beacon` / `attendee@test.beacon` |
| `TEST-ES-0005-000E` | `TEST-EN-0005-001E` | REVOKED | login must fail |
| `TEST-ES-0006-000F` | `TEST-EN-0006-001F` | ISSUED | COMP tier |

ES and EN tickets use distinct last-fours (`000x` vs `001x`) so operator
last-four lookups stay unambiguous.

## Restore it

```bash
createdb beacon_test
psql beacon_test < db/test-fixture.sql
```

Then point your `.env.local` at it and use the pinned test-only pepper — the
ticket digests inside the dump were computed with exactly this value:

```bash
DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/beacon_test?schema=public"
TICKET_CODE_PEPPER="test-fixture-pepper-not-for-production"
```

That pepper is deliberately public: it exists only so this shared fixture
works on every machine. Never use it outside local testing.

## Alternative: seed your own database

If you already have a database and your own `TICKET_CODE_PEPPER`, generate
the same fixtures with your pepper instead of restoring the dump:

```bash
npm run db:seed:test
```

Idempotent — safe to re-run, and re-running refreshes ticket expiry (the
fixture tickets expire 24 h after the event date).

## Keeping the fixture up to date

When the schema or the fixture data changes, regenerate the dump:

```bash
scripts/regenerate-test-fixture.sh
```

The script spins up a throwaway Postgres container, applies migrations,
runs `prisma/seed-test-fixtures.ts` with the pinned test pepper, and
rewrites `db/test-fixture.sql`. Commit the updated dump together with the
change that required it.
