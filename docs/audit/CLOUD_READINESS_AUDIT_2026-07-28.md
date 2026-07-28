# Cloud Readiness Audit — Reduced Distributed Version

*Audit date: 2026-07-28 · Repository state: `main@faf5f13` · Status: no-go for cloud release; suitable refactor baseline*

## Executive verdict

`main@faf5f13` is a healthy source baseline, but it is not presently deployable as
a reduced distributed cloud version.

The application gates pass and the removal of go2rtc materially reduced the
system. The remaining blocker is not general code quality: it is the set of
single-host assumptions that still connects the web app, LiveKit Egress,
playlist-bot, and durable audio through one filesystem. Authentication,
dependency security, data migration, release engineering, and legal provenance
also have unresolved release gates.

The decision is therefore:

- **Go**: use current `main` as the branch point for a reduced-cloud refactor.
- **No-go**: deploy current `main` as a distributed or public cloud release.
- **No-go**: merge `feat/cloud-migration` as-is. Its plan remains useful, but the
  branch forked before 34 subsequent commits on `main` and must be ported onto a
  fresh branch.

## Scope and method

This audit examined:

- the exact local and remote `main` ref;
- the commands used as source-quality gates;
- the root app and playlist-bot dependency/runtime surfaces;
- storage and media call sites;
- Zitadel claim handling and authorization boundaries;
- Prisma/Neon connection and migration assumptions;
- CI, deployment, health checks, rollback, and secret handling;
- the unmerged cloud plan, provisioning record, and R2 viability probe;
- licensing and Provider-content prerequisites.

It did not deploy, migrate a production database, enable R2, change Zitadel, or
send external communications.

## Verified baseline

The worktree was clean and `main`, `origin/main`, and `origin/HEAD` all pointed to
`faf5f13`.

The following commands were executed from a clean dependency install:

| Gate | Result |
|---|---|
| `npm ci` | pass |
| `npm run lint` | pass, 18 warnings and 0 errors |
| `npm run test:coverage` | 63 files, 624 tests passed |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |
| playlist-bot `npm ci` + `tsc --noEmit` | pass |
| playlist-bot production dependency audit | 0 vulnerabilities |

Root coverage was 75.05% statements, 71% branches, 70.94% functions, and 75.57%
lines. This is useful regression coverage, but there is no configured coverage
threshold. The report also showed 0% coverage for `src/lib/auth-config.ts`,
`src/lib/db.ts`, and `src/context/AudioContext.tsx`: the three integrations most
affected by this migration are not exercised end-to-end by the suite.

## Release blockers

### CR-1 — Durable state still lives on one host filesystem

**Severity: blocker**

The app cannot be replicated safely while these call sites remain:

- `src/app/api/meditations/upload/route.ts` buffers the multipart file into an
  `arrayBuffer()` and writes it with `writeFile`.
- `src/app/api/admin/meditations/[id]/route.ts` publishes with `rename`, falling
  back to `copyFile` plus `unlink`.
- public and Admin playback read local files.
- `src/app/api/provider/sessions/[id]/cuts/route.ts` executes ffmpeg against local
  recording paths and writes a local output.
- LiveKit recording starts with `DirectFileOutput({ filepath })`.
- playlist-bot scans `/data/beacon-records` from a bind mount.
- session lifecycle and recording-stop logic use `existsSync` on local paths.

The Compose file confirms the coupling through four host-mounted directories:
meditations, uploads, recordings, and beacon-records.

Consequences:

- two app replicas do not see the same files;
- LiveKit Cloud cannot write into the app container's filesystem;
- local fallbacks can appear to work and then lose data on redeploy;
- a cloud load balancer can route a follow-up request to a replica without the
  file created by the first request.

**Release condition:** no durable call site imports `fs` directly. Meditations,
uploads, recordings, and playlist source objects must use one object-store key
model. LiveKit Egress must upload directly to S3-compatible storage, and the bot
must consume the same storage.

### CR-2 — The upload boundary is not enforced in application code

**Severity: high**

`MAX_UPLOAD_SIZE_MB=100` appears in `.env.example` and Compose but is not read by
the application. The upload route calls `request.formData()` and then copies the
entire file into a second in-memory buffer before writing it. File acceptance is
based on MIME or filename extension; failure to inspect the audio with ffprobe is
explicitly accepted.

This is tolerable only behind the current host's nginx body limit and trusted
Provider role. It is not a sound cloud boundary.

**Release condition:** issue short-lived, key-scoped presigned PUTs; track upload
state; verify object size, checksum, and allowed media type before marking an
upload complete; reap abandoned rows/objects; and enforce rate limits independently
of the edge provider.

### CR-3 — Runtime dependencies contain release-relevant advisories

**Severity: blocker**

`npm audit` reported 32 advisories in the complete root install and 18 with
development dependencies omitted. Some are build-tool transitive findings and do
not enter the standalone runtime, but two direct packages are material:

- `next@16.1.2` is below the patched line for several App Router and
  middleware/proxy authorization bypasses and denial-of-service issues.
- `next-auth@5.0.0-beta.30` is below `5.0.0-beta.32`, which fixes a critical
  fail-open configuration error and related Auth.js findings.

The application already avoids the exact bare-`auth` fail-open pattern: middleware
checks `session?.user`, while route guards require `session.user.id`. That reduces
exposure to that specific Auth.js finding; it does not justify shipping vulnerable
framework versions.

**Release condition:** upgrade at least to the patched versions reported by the
audit (`next@16.2.12`, matching `eslint-config-next`, and
`next-auth@5.0.0-beta.32`), then rerun all gates and the real Zitadel flow.

### CR-4 — Zitadel is authoritative only at sign-in, not at revocation time

**Severity: blocker for public release**

The role claim is copied into a JWT only when `account && user`, and the JWT session
can live for seven days. Removing an ADMIN or PROVIDER grant in Zitadel therefore
does not remove privileges from an already-issued session until it expires or is
otherwise invalidated.

The identity sync also searches for an existing user by `zitadelId OR email` and
then rewrites the row's Zitadel subject. The code does not read `email_verified`,
and `User.isVerified` is never synchronized. Whether this can become an account
re-association issue depends on the instance's signup and email-uniqueness
configuration, which has not been inspected. It must be treated as unsafe until
verified.

The documented CAPTCHA, email verification, signup rate limiting, and two-Admin
role-change control are likewise unverified in the Zitadel instance.

**Release condition:**

1. consume `email_verified` and fail closed for first listen and any email-based
   account reconciliation;
2. verify the exact project role claim and legacy `certified_provider` migration;
3. define and test role-revocation/session-invalidation semantics;
4. record callback, logout, CORS, PKCE, role, signup, and audit settings from the
   actual Zitadel console;
5. run anonymous, Listener, Provider, Admin, revoked-role, and forged-header tests
   against the deployed instance.

Email verification is not an age gate. The 18+ affirmation is a separate feature
and can be excluded from a reduced staging release only if research enrollment is
also explicitly excluded.

### CR-5 — CI does not enforce the claimed release gates on `main`

**Severity: high**

`.github/workflows/ci.yml` runs only for pull requests targeting `release`. It does
not run for pushes or pull requests to `main`. It also lacks an explicit root
`tsc --noEmit`, dependency audit, coverage threshold, and playlist-bot install/build.

The bot happens to build now, but its compilation occurs only inside its Dockerfile
during the deploy's Compose build. A green root CI can therefore precede a failed
production image build.

**Release condition:** one required workflow on the protected integration branch
must install deterministically and run lint, tests with thresholds, root typecheck,
Next build, bot typecheck/build, dependency policy, and image build.

### CR-6 — The deploy workflow is host-specific and cannot roll back

**Severity: blocker**

The production workflow:

- triggers from `release`, not `main`;
- runs migrations against `localhost` on the self-hosted runner;
- bakes `NEXT_PUBLIC_LIVEKIT_URL` into the image;
- writes long-lived secrets into `/etc/sai-harmonic-beacon/production.env`;
- builds images on the deployment host rather than publishing an immutable artifact;
- validates only `/api/health`, so it can succeed with the database unavailable;
- labels `docker compose down && docker compose up -d` as rollback even though it
  restarts the same newly-built images;
- cannot roll back a migration already applied before an image/build failure.

The liveness endpoint reports package version `0.1.0`, not the deployed git SHA.
Structured logs, request IDs, error aggregation, metrics, and external uptime checks
are absent.

**Release condition:** build once, publish by git SHA and deploy by immutable digest;
use a secret store; separate direct migration credentials from pooled runtime
credentials; gate rollout on readiness plus a functional smoke test; expose the
release SHA; and retain the previous digest and a documented database-compatible
rollback path.

### CR-7 — Neon verification is stale relative to current `main`

**Severity: blocker**

The unmerged provisioning record says five migrations were applied successfully to
a temporary Neon branch. Current `main` contains eight migrations: user deletion,
audit/reports, and meditation takedown were added after that rehearsal. The temporary
branch was deleted and the Neon production branch was recorded as untouched.

The rehearsal created schema; it did not prove migration of existing production data,
referential integrity after restore, application queries under realistic data, backup
retention, or a restore.

**Release condition:** on a new Neon branch, apply all eight migrations through the
direct endpoint, restore a sanitized production-shaped dataset, run the app through
the pooled endpoint, compare counts and critical invariants, and rehearse restore and
cutover. Production migrations must remain a single, separately gated release step.

### CR-8 — R2 is provisionally selected but not operationally verified

**Severity: blocker**

Cloudflare's current documentation explicitly supports Range on its S3 API and
presigned GET/PUT URLs. Browser use still requires bucket CORS. This removes Range
support as an architectural unknown, but the Harmonic Beacon account still needs an
enabled bucket, credentials, CORS configuration, object lifecycle policy, and a real
smoke test.

The probe on `feat/cloud-migration` is not safe as a gate. `finish()` exits nonzero
only when a failed check's name contains `Range`. An initial SDK PUT failure returns
through `finish()` with exit code 0; a broken presigned PUT or full GET also yields a
"VIABLE, with configuration gaps" verdict. Only CORS was intended to be soft.

**Release condition:** fix the probe so SDK PUT, full GET integrity, both Range reads,
presigned PUT, and cleanup are hard failures; keep CORS as either a hard staging gate
or an explicitly classified configuration failure. Run it against the real bucket
from the production origin.

### CR-9 — Public release rights remain unresolved

**Severity: blocker for public distribution; not a technical staging blocker**

The repository records 21 historical commits from AnnieScigliano made before the
Apache-2.0 license landed. A one-time written agreement covering those contributions,
or written confirmation of an applicable assignment/employment basis, is still owed.

Provider audio has a separate gap: the Provider Content Agreement is undrafted, no
acceptance is recorded, and the intended license term is unresolved. A private
technical staging environment can use synthetic or clearly AlterMundi-owned audio.
A public service must not infer rights to third-party audio from the code license.

## Target-specific readiness

### Private reduced staging

A private cloud staging release may exclude:

- research enrollment and the 18+ affirmation;
- patronage and transactional email;
- Provider uploads, scheduled-session recording, and cuts, if those routes are
  explicitly disabled rather than merely hidden;
- third-party Provider audio.

If upload, recording, cuts, or playlist fallback remain in scope, their full object
storage path remains a blocker. Calling a release "reduced" does not deactivate an
API endpoint or remove its operational obligations.

### Public reduced release

In addition to all technical gates, a public release needs:

- Annie's contribution agreement or equivalent written rights basis;
- documented rights for every audio object served;
- the relevant Zitadel signup and identity controls;
- external monitoring and an incident contact path;
- an explicit statement of which roadmap/policy commitments are out of scope.

### Highly available distributed release

The recommended single-VM app-plus-bot test stack distributes managed services
across providers but still has one compute host. It is not highly available.

Claiming a distributed/HA web tier requires at least two stateless app replicas,
proof that no request depends on local disk, load-balanced readiness, and a tested
failure of one replica. Playlist-bot is deliberately a singleton because two copies
would double-publish; continuity therefore needs supervised restart or a leader
election design rather than an unconstrained second replica.

## Required acceptance gates for the refactor

The future refactor plan should not be considered complete until all applicable
gates below are evidenced:

1. **Scope gate** — the reduced feature set and explicitly disabled routes are named.
2. **Security gate** — patched dependencies and zero unaccepted high/critical runtime
   findings.
3. **Identity gate** — real Zitadel login, logout, verification, roles, and revocation.
4. **Storage gate** — R2 PUT/GET/Range/CORS, checksums, abandoned-upload cleanup, and
   no durable local paths.
5. **Database gate** — all migrations plus data restore on a disposable Neon branch.
6. **Media gate** — live join, playlist fallback, and any retained Egress/cut workflow.
7. **Replica gate** — two app replicas pass the same functional smoke test while one
   is terminated mid-run.
8. **Release gate** — immutable artifact, direct migrations, pooled runtime, readiness,
   release SHA, secrets, rollback, logs, metrics, and external uptime.
9. **Cutover gate** — upload/approve/play/seek/takedown and role revocation verified on
   the public origin; old system retained recoverably for the agreed rollback window.
10. **Rights gate** — code and content provenance resolved for any public release.

## Work explicitly outside the critical path

These are valid cleanup tasks but must not displace the release blockers above:

- remove vestigial `Meditation.streamName` and its unique index in a dedicated
  migration;
- add a "superseded by" note to the dated June audit rather than rewriting its
  historical findings;
- clear the 18 current lint warnings;
- genericise or move the public single-host deploy runbook;
- revise the old cloud branch's stale counts and provider notes when its useful
  content is ported.

## External references checked on 2026-07-28

- [Auth.js critical advisory GHSA-8fpg-xm3f-6cx3](https://github.com/advisories/GHSA-8fpg-xm3f-6cx3)
- [Next.js middleware bypass GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv)
- [Next.js App Router segment-prefetch bypass GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [LiveKit Egress outputs and S3-compatible storage](https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/)
- [Zitadel OIDC claims](https://zitadel.com/docs/apis/openidoauth/claims)
- [Zitadel project-role retrieval](https://zitadel.com/docs/guides/integrate/retrieve-user-roles)
