# Delivery invariants

These requirements are part of [OPERATING_CONTRACT.md](OPERATING_CONTRACT.md),
moved verbatim from its detailed release sections. Read the relevant section
before release preparation, promotion, recovery or changes to delivery
authority. Moving them does not change authorization or implementation.

### Impact-scoped release and recovery (OPS-E)

- Documentation-only changes have no Live deployment action. A bounded CSS
  change selects the UI matrix and app only; it never inspects/migrates the
  database or restarts the worker, tapestry or playlist bot.
- Audio, authentication, grants, payments and data always retain their named
  critical matrices. Shared application-runtime dependencies expand to every
  actual consumer, including the commerce reconciler. CI derives required job
  conclusions from the selected services and matrices; the always-run aggregator
  fails if a required surface is missing, failed, cancelled, or skipped.
  Analytics remains on its separate owning deployment lane.
- The root-owned transaction computes the plan from per-service deployed source
  SHAs, pulls only selected candidate artifacts, replaces only selected services
  and advances only those service release records. A retry checkpoints each
  replacement; current-state CAS prevents an older candidate from overwriting a
  newer release. Before replacement, the helper establishes a host entry fence,
  stops both request/data writers, repeats DB-session and LiveKit participant/audio
  continuity checks, and retains the fence through every selected replacement.
  Failure cleanup restores the request and worker containers and removes the
  fence; an operation-order receipt is validated before the phase advances.
- Migration paths trigger a read-only comparison of candidate migration
  directories with `_prisma_migrations`. Each database record must carry the
  lowercase SHA-256 Prisma stores for the exact raw `migration.sql` bytes;
  missing, mismatched, duplicate, conflicting, failed, or unexpected records
  fail closed. No pending migration means no quiesce and no migration. Pending
  migration first establishes the entry/writer fence and repeats continuity,
  then creates a new attempt-specific dump. SQL comments, dynamic execution,
  destructive DDL/DML, and statements outside the explicit additive allowlist
  fail the forward-only gate; generated additive migrations must therefore have
  comments removed before qualification.
- The fresh post-fence dump is restored into an isolated database and migrated
  by the candidate. The exact prior app image must boot and pass bounded health
  and schema checks against that candidate-migrated restore, and the exact prior
  commerce worker image must boot and heartbeat against it. Root-owned typed
  evidence binds the run/attempt, dump digest, candidate/prior refs and image
  IDs, migration-state/checksum digests, and quiescence receipt before production
  migration. Retry after any interrupted migration creates a new fence, dump,
  and proof rather than reusing pre-fence evidence. Code-only rollback verifies
  prior exact images and canonical config instead. Local hosts without Docker
  can verify only the deterministic command-boundary/order state machine; a
  hosted run with Docker, PostgreSQL, LiveKit, and the loopback entry-fence
  facility remains mandatory and must emit `hostedRuntimeDrill=passed` before
  production migration.
- Runtime public-config changes reuse the deployed app image and replace app
  only to apply the canonical profile; they do not rebuild an application.
  The bounded OPS-E schedule rehearsal uses one root-owned closed JSON request
  through `hb-deploy schedule-apply`; the in-image tool requires
  `scope=synthetic-rehearsal`, an enabled Admin, a non-public `isTest` session,
  an `ops-e-rehearsal-*` room, compare-and-set time, bounded reason and one audit
  row. A concurrent or repeated request cannot duplicate effects. This does not
  authorize a real-user schedule mutation. Free-form SQL, arbitrary script paths
  and ad-hoc container commands are not alternatives.
- Before replacement, the helper fails closed on a database session in `LIVE`
  state, any real LiveKit participant, or published user audio. The passive bed
  bot alone is the only exception. Incident Commander owns defer/abort; the
  recovery target is the untouched current release, not a forced restart.

Recovery ownership is explicit: the Incident Commander owns go/no-go and target
selection; the root helper only executes its closed transaction. Code/config
targets are exact prior per-service images and profile bytes. Migration recovery
targets the forward schema with the exact prior compatible app/worker; the fresh
dump is first restored only to `hb_restore_<run-id>` and is never automatically
written over Live Postgres. No measured production RTO or real restore drill is
claimed by this repository change.

## Delivery authority and OCI transition

Live delivery has one stable aggregate context, `delivery-gate`. The
lifecycle wrapper at
[`.github/workflows/delivery-gate-dispatch.yml`](../../.github/workflows/delivery-gate-dispatch.yml)
is intentionally unable to write commit statuses: it has only the permissions
needed to resolve a protected PR and dispatch
[`.github/workflows/delivery-gate.yml`](../../.github/workflows/delivery-gate.yml)
at that PR's current `main` or `release` target ref. The dispatched workflow is
the sole status-writing authority. Before its first status write, it requires
its own `GITHUB_SHA` and `GITHUB_REF_NAME` to equal the PR's exact live base SHA
and ref; a branch movement between resolution and dispatch therefore fails
closed. The lifecycle wrapper may be loaded from the default branch for
`pull_request_target` or `workflow_run`, but it cannot authorize a candidate.
Its operator-facing manual mode requests only `delivery-gate-shadow`.

The exact-base authority checks out only that same base SHA and runs the
fail-closed evaluator at
[`scripts/ci/required-checks.mjs`](../../scripts/ci/required-checks.mjs). It
rejects any event, evaluator, constituent suite, workflow run, workflow attempt,
job, or check identity bound to another PR head, base ref, or base SHA. Required
checks must come from the exact GitHub Actions App and expected workflow path on
the pull-request event. Check, suite, workflow-run-attempt, and exact-attempt job
pages are fetched as one complete stable evidence snapshot. Evidence JSON travels
through stdin/file descriptors rather than command-line arguments, without
truncation; file-backed values are parsed as complete JSON, not accepted as a
prefix or silently replaced with empty evidence. The mapping in
[`scripts/ci/check-evidence.jq`](../../scripts/ci/check-evidence.jq) binds each
accepted check ID to the one job whose `check_run_url` identifies it, then binds
that job to the exact run ID and attempt record. Checks or jobs timestamped
before that attempt started are rejected. The entire evidence snapshot is
refetched again immediately before success.

Changed-file classification includes both sides of renames and rejects
incomplete GitHub file listings or multiple protected PRs sharing one head SHA.
The PR and retarget timeline are also reread immediately before success, which
is published on the current synthetic merge commit rather than the reusable
head commit. Neither authority nor dispatcher checks out or executes candidate
bytes. Constituent CI/E2E/audio lifecycle events can request reevaluation, but
their default-branch `workflow_run` wrapper has no status-writing permission.
Per-context, PR, and exact-base concurrency coalesces duplicate evaluators;
final live-PR and evidence revalidation prevents an obsolete evaluator from
winning. Manual dispatcher mode emits only `delivery-gate-shadow`, never the
required context. A direct invocation of the internal exact-base authority is
not a bypass: the same live PR/base binding and complete check evaluation still
apply.

`main` and `release` require pull requests, zero external approving reviews,
no mandatory CODEOWNER or last-push approval, an up-to-date head, and
`delivery-gate` bound to GitHub Actions
App ID `15368`, with force pushes and deletion disabled. `release`
remains the promotion branch and [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
plus [`deploy/hb-deploy-root`](../../deploy/hb-deploy-root) remain the reviewed
production mutation path. `early-birds` is a separate Account/Listener lane: it
must be independently protected and must never be merged, reset or folded into
Live reconciliation. Branch-qualified source routes and unresolved Home/PMP
authority are recorded without guessing in
[`deploy/platform-services.json`](../../deploy/platform-services.json); `hb doctor`
fails or warns when those mechanical contracts are absent.

During the main/release transition, `HB_RELEASE_LANE_STATE=legacy-shadow`
permits only OCI shadow preparation on an already reconciled OCI v4 host. The dedicated `release` workflow is on
a fail-closed security safety hold; legacy source-build mutation is disabled.
See `.github/workflows/deploy.yml` and `deploy/README.md`. Only the single `oci-production` state, set after accepted
shadow/rollback/forward-repair evidence and root-state reconciliation, changes
that routing. The restricted `/usr/local/sbin/hb-deploy` path remains the
production mutation boundary. OCI artifact operations are rooted in one
verified transaction and publish one atomic current-state object only after
actual digest, health, public provenance and private-boundary readback.
Production preparation requires authenticated measured transition evidence from
its same-run/attempt hosted rehearsal and a protected delivery authorization
binding the exact aggregate bytes. For promote, a read-only root verb first
exports the current publication and Live service-release bases; Mona computes
an unprivileged impact plan, and the protected hosted signer independently
reproduces it from protected main. Authorization v2 binds both inert file
digests. Root descriptor-admits them and rejects a changed publication,
service-release high-water, plan digest, source SHA, or deployed-base mapping;
it never executes Git, tracked scripts, or runner-workspace Compose.
Root admits the fixed evidence inventory
into the new transaction before validation or effects. A manual transition-evidence
directory cannot enable it. Every artifact invocation binds a signed protected delivery run/attempt; markerless
committed rollback needs a fresh hosted rollback authorization and exact current
publication match. See `deploy/README.md` for the command argument contract.
The sole current-state schema is `harmonic-beacon.current-state.v4`, a closed
OCI-production manifest plus exact digest-bound Compose, overlay and reviewed
production public-config bytes. Existing legacy/v2/v3 hosts deliberately block
both shadow and production preparation until a separately reviewed root-owned
reconciliation proves the exact OCI live runtime and installs v4. No generic
root fallback or helper migration shortcut exists. Preparation verifies that
runtime against the high-water before activation, and migration repeats the
verification before its phase change or first Compose/runtime mutation. The
manual Compose section in older runbooks is emergency historical guidance, not
ordinary authorization.

Account/Listener, Home, Analytics, and payment authority have separate release
ownership. Do not assume a Live deployment updates them. Shared-contract
changes require explicit ordered compatibility, not an all-services rebuild.
