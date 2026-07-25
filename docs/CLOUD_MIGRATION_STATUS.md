# Cloud Migration — Provisioning & Verification Status

Living record for the `feat/cloud-migration` branch. Companion to
`docs/CLOUD_MIGRATION_PLAN.md` (the plan) — this file tracks what is actually
provisioned and what has actually been *verified by running it*, as opposed to
what research claimed.

The distinction matters: `.claude/AGENT_POLICY.md` §3 requires that research
findings driving an R0/R1 decision be re-verified first-hand. Everything in the
"Verified" column below was executed, not read about.

Last updated: 2026-07-25

---

## Provisioned resources

| Service | Identifier | Details |
|---------|-----------|---------|
| **Neon** project | `curly-pond-28868892` | `HarmonicBeacon-web-app-back`, region `aws-us-east-2`, **PostgreSQL 18.4** |
| Neon branch (prod) | `br-falling-wave-ayize0vn` | `production` — default, **untouched so far** |
| Neon branch (test) | `br-still-shadow-ayo270a8` | `migrate-test` — created for the migration rehearsal below |
| Neon database | `neondb` | owner `neondb_owner` |
| **LiveKit Cloud** project | `p_3cmow8umq6m` | `harmonicbeacon-web-app` → `wss://harmonicbeacon-web-app-qdy6k7s6.livekit.cloud` |
| **Cloudflare** account | `85194301c81e4f873c1d96a8e9daf336` | wrangler 4.114.0 authenticated |
| **Cloudflare R2** | — | ⏳ **not yet enabled** — must be turned on via the dashboard before a bucket can be created |

Neon compute settings observed on the project: autoscale 0.25–2 CU,
`suspend_timeout_seconds: 0` (platform default → scale-to-zero after ~5 min idle,
not disableable on Free), storage limit 512 MB per branch.

## Verification log

| Claim | Status | How it was verified |
|-------|--------|---------------------|
| `prisma migrate deploy` works against Neon | ✅ **VERIFIED** | All 5 migrations in `prisma/migrations/` applied cleanly to branch `migrate-test` over the **direct (non-pooled)** connection. No advisory-lock failure — the historical PgBouncer incompatibility is genuinely fixed |
| Neon pooled connection serves runtime queries | ✅ **VERIFIED** | `pg` client against the `-pooler` host: `SELECT version()` → PostgreSQL 18.4; 11 tables in `public` (10 models + `_prisma_migrations`); 5 rows in `_prisma_migrations` |
| Schema is PG-18 compatible | ✅ **VERIFIED** | Implied by the clean migration run above. Plan only required 15+ |
| LiveKit Cloud project reachable | ✅ **VERIFIED** | `lk project list` returns the project and its wss URL |
| R2 Range requests on presigned GETs | ⏳ **BLOCKED** | Needs R2 enabled. This is the test that decides whether R2 is viable at all — audio seeking depends on it |
| R2 payment-method requirement | ⏳ **PENDING** | Research sources disagreed. The dashboard enable flow will answer it definitively |
| Northflank Sandbox caps / worker sockets | ❌ **UNVERIFIED** | The linchpin of the $0 path and still the least-verified claim in the research set. Only matters if we pursue the free-tier compute route over Hetzner |
| Neon long-idle *project* deletion policy | ❌ **UNVERIFIED** | Compute suspension is documented and benign. Project deletion was neither confirmed nor ruled out |
| LiveKit Cloud egress minutes on Build tier | ❌ **UNVERIFIED** | Research says 60 min/month recording. Needs confirming against actual expected usage before relying on it |

### Two connection strings, two purposes

Neon exposes a pooled and a direct endpoint on the same compute:

```
direct : ep-rapid-queen-aykcwn2w.c-5.us-east-2.aws.neon.tech          → migrations
pooled : ep-rapid-queen-aykcwn2w-pooler.c-5.us-east-2.aws.neon.tech   → app runtime
```

Both were verified working. Prisma's `directUrl` (migrations) and `url` (runtime)
must be wired to these respectively — see Plan §5 task 2.3.

## Findings not in the original plan

**`pg` 8.18 emits an `sslmode=require` deprecation warning.** Neon's connection
strings use `sslmode=require`, and node-postgres now warns that this will change
meaning to `verify-full` in a future major. Today it connects fine, but this is a
forward-compatibility trap: a routine `pg` upgrade could start rejecting the
connection on certificate verification. Decide explicitly — either pin the intent
with `sslmode=verify-full` (and ensure the CA chain resolves) or
`uselibpqcompat=true&sslmode=require` to keep current behaviour. Do not leave it
implicit.

**The test suite is a usable regression baseline.** 46 files / 365 tests, all
passing, enforced by a husky pre-commit hook. Any storage refactor breakage in
Phase 1 will show up immediately, which lowers the risk of that phase
considerably.

**Errors reached logs before they reached the response.** *(Landed on `main` —
see below.)* The readiness probe
originally logged its raw error. A `pg` authentication failure puts the entire
connection string, password included, into `error.message` — so on the current
host that wrote the DB password into a local log file, and in the cloud target it
would ship it to a third-party aggregator. Fixed by `src/lib/redact.ts`, which
also strips the SigV4 signature from presigned R2 URLs. That second case is not
hypothetical: presigned URLs are bearer tokens in a query string, and Phase 1
will be generating them on every audio request. Redaction had to exist before
that code does, not after.

**The ~108 pre-existing TypeScript errors were three fixes, not a backlog.**
*(Landed on `main`, `726e821`.)* Nearly all of them — 104 — came from one line:
`mockParams` in `src/__tests__/helpers.ts` declared its return as
`Promise<Record<string, string>>`, erasing the specific key each dynamic route
requires. Making it generic fixed every one. A second line in the same file typed
`createRequest`'s init as the DOM `RequestInit` where `NextRequest` takes its own,
and `middleware.test.ts` called the middleware with one argument where the real
`auth()` wrapper takes two. `npx tsc --noEmit` is now at zero.

Three further errors were phantoms: `tsconfig.json` includes `.next/types` and
`.next/dev/types`, and a stale build still had validators referencing
`src/app/moods`, `src/app/signup` and `src/app/auth/callback` — all deleted
routes. So a local error count moves with build state and not only with source,
which is worth knowing before reading meaning into a delta. An earlier note here
reported "110 on main vs 108 on the branch" as if it were a real difference; it
was not, it was `.next`.

`next build` never surfaced any of this because it does not typecheck test files.
Getting to zero matters for what comes next: Phase 1 rewrites every storage call
site, and `tsc` is the cheapest way to find one that was missed.

## Next actions

1. **Enable R2** in the Cloudflare dashboard, then run the Range smoke test —
   this is the gate on the whole storage decision (D4).
2. Land Phase 0 (health endpoints ✅ in progress, build-arg extraction, migration
   step split, `process.cwd()` fallback removal, structured logging).
3. Design the storage driver interface (Plan §4.1) — R1, critical path.
4. Decide compute: Hetzner CX22 (~€3.79/mo, verified-by-reputation) vs Northflank
   Sandbox ($0, unverified). Requires action 1 to be settled first.

## What already landed on `main`

Work that fixes or improves the current deploy independently of this migration was
ported to `main` while this branch was still small — deliberately, because Phase 1
rewrites the storage routes and their tests, and the same port attempted afterwards
would conflict in exactly those files.

| Commit | Content |
|--------|---------|
| `726e821` | The three TypeScript fixes; `tsc` at zero |
| `38023db` | Health probes, `src/lib/redact.ts`, and the three health-check retargets |
| `d86dadd` | `AGENT_POLICY.md`, the five agent definitions, vendored Neon skills |

This branch now carries only migration-specific content: the two planning docs,
`.env.cloud.example`, `scripts/verify-r2.mjs`, and the wrangler / AWS SDK
devDependencies.

**Follow-up owed on `main`:** 15 call sites outside tests still log raw errors
(`src/lib/auth-config.ts` among them). `redactError` exists now; routing those
through it is a separate, self-contained change.

## Cleanup done

- Neon branch `migrate-test` (`br-still-shadow-ayo270a8`) deleted after the
  migration rehearsal. Only `production` remains.
