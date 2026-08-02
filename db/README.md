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
| `facilitator@altermundi.net` | FACILITATOR |
| `operator1@altermundi.net` | OPERATOR |
| `operator2@altermundi.net` | OPERATOR |
| `admin@altermundi.net` | ADMIN |

### Sessions (Saturday 2026-08-08, both `SCHEDULED`)

| Language | Room | Time (Costa Rica) |
|---|---|---|
| SPANISH | `weekend-test-spanish` | 08:30 |
| ENGLISH | `weekend-test-english` | 14:00 |

### Ticket codes (6 per session)

Near-identical on purpose for easy manual typing: `TEST-TEST-TEST-TES` + one
letter for Spanish, `TEST-TEST-TEST-TEN` + one letter for English.

| Spanish session | English session | State | Notes |
|---|---|---|---|
| `TEST-TEST-TEST-TESA` | `TEST-TEST-TEST-TENA` | ISSUED | log in with any email (binds on first use) |
| `TEST-TEST-TEST-TESB` | `TEST-TEST-TEST-TENB` | ISSUED | |
| `TEST-TEST-TEST-TESC` | `TEST-TEST-TEST-TENC` | ISSUED | |
| `TEST-TEST-TEST-TESD` | `TEST-TEST-TEST-TEND` | BOUND | email must be `asistente@altermundi.net` / `attendee@altermundi.net` |
| `TEST-TEST-TEST-TESE` | `TEST-TEST-TEST-TENE` | REVOKED | login must fail |
| `TEST-TEST-TEST-TESF` | `TEST-TEST-TEST-TENF` | ISSUED | COMP tier |

ES last-fours start with `TES`, EN with `TEN`, so operator last-four lookups
stay unambiguous. (A bare `test` code is impossible by design: the login
route and `digestTicketCode` require ≥16 characters, and `codeDigest` is
unique across the whole table.)

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
