# Harmonic Beacon operating contract

This is the stable entry contract for engineering and operations across
`*.harmonicbeacon.com`. It routes an operator to current evidence; it is not a
deployment transcript and intentionally contains no current SHA, credential,
participant identity, or mutable production value.

## Authority and ownership

- The user's current request defines scope. Technical access does not expand
  it.
- One operator owns each mutable environment and candidate at a time. Other
  agents may inspect or review from separate worktrees but do not mutate the
  same worktree or environment concurrently.
- GitHub `maintain`, host SSH, sudo, Docker, database, payment-provider, DNS,
  or secret-store access are independent capabilities. Verify only the
  capability required for the operation.
- DNSExit is outside ordinary Beacon operations. Apple remains hidden until
  its external developer material is available. Real payments are never a
  smoke test.

## Current-state sources

Use these in descending order of authority for the fact they expose:

1. The exact target: service health/provenance response, database or queue
   state through a reviewed diagnostic, GitHub ref/check/run, deployed image
   digest, runner/helper readback, or provider read-only API.
2. [`deploy/platform-services.json`](../../deploy/platform-services.json) for
   service ownership, lanes, workflows, endpoints, and recovery routing.
3. Current versioned runbooks and executable workflow/helper code.
4. Plans, issues, reviews, receipts, memories, chat, and old worktrees only as
   historical leads that must be reverified.

Run from a clean checkout:

```bash
scripts/hb.mjs doctor
scripts/hb.mjs change-impact --base upstream/main
```

`doctor` is read-only. A skipped or unreachable check means unknown, not
healthy. `change-impact` returns a conservative minimum profile; the operator
must add checks for risks the classifier cannot infer.

## Change and release flow

1. Resolve the owner repository, lane, candidate, deployed revision, active
   operators/worktrees, and overlapping pull requests.
2. Develop with focused checks and hot reload where appropriate. Keep
   unrelated services out of the build and restart set.
3. At the integrated boundary, run the profile selected by change impact plus
   contract-specific checks. Failed gates block promotion but do not end
   authorized diagnosis and repair.
4. Review the integrated diff once. Security boundaries, payments,
   permissions, migrations, privileged helpers, frozen audio paths, and
   rollback compatibility receive independent review when their contract
   requires it.
5. Promote the exact reviewed candidate through its configured workflow. Do
   not develop directly on a production lane or substitute a direct host
   command for an available reviewed path.
6. Read back exact deployed provenance, health/readiness, private boundaries,
   service-specific behavior, and recovery target.

Live delivery has one stable aggregate context, `delivery-gate`, implemented by
[`.github/workflows/delivery-gate.yml`](../../.github/workflows/delivery-gate.yml)
and the fail-closed evaluator at
[`scripts/ci/required-checks.mjs`](../../scripts/ci/required-checks.mjs). The gate
first resolves the exact current target commit, checks out the evaluator from
that commit only, and rejects any event, evaluator, constituent suite, or
workflow-run identity bound to another PR head, base ref, or base SHA. Required
checks must come from the exact GitHub Actions App and expected workflow path on
the pull-request event. Check pages are refetched to a stable complete snapshot,
deduplicated by ID, ordered by workflow start and rerun attempt, and refetched
again before success. Changed-file classification includes both sides of
renames and rejects incomplete GitHub file listings or multiple protected PRs
sharing one head SHA. The PR, retarget timeline, and check snapshot are reread
immediately before success, which is published on the current synthetic merge
commit rather than the reusable head commit. The monitor never checks out or
executes candidate bytes.
Constituent CI/E2E/audio workflow lifecycle events re-evaluate newer reruns;
per-head concurrency keeps obsolete candidates and manual runs isolated.
Manual mode emits only `delivery-gate-shadow`, never the required context.

`main` and `release` must require pull requests, at least one code-owner
approval, stale-review dismissal, approval of the current push by someone other
than its pusher, an up-to-date head, and `delivery-gate` bound to GitHub Actions
App ID `15368`, with force pushes and deletion disabled. `release`
remains the promotion branch and [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
plus [`deploy/hb-deploy-root`](../../deploy/hb-deploy-root) remain the reviewed
production mutation path. `early-birds` is a separate Account/Listener lane: it
must be independently protected and must never be merged, reset or folded into
Live reconciliation. Branch-qualified source routes and unresolved Home/PMP
authority are recorded without guessing in
[`deploy/platform-services.json`](../../deploy/platform-services.json); `hb doctor`
fails or warns when those mechanical contracts are absent.

Account/Listener, Home, Analytics, and payment authority have separate release
ownership. Do not assume a Live deployment updates them. Shared-contract
changes require explicit ordered compatibility, not an all-services rebuild.

## Safety invariants

- Resolve exact refs and targets; never deploy from a dirty checkout, mutable
  tag, unreviewed override, or guessed host path.
- Before migrations or destructive recovery, verify a current backup and the
  documented restore/compatibility path. Do not delete ledgers, pending jobs,
  grants, memberships, or canonical business data to make a check green.
- Preserve rollback images and manifests required by the active operation.
  Prune only artifacts demonstrated unreferenced; never use broad Docker or
  volume deletion.
- Do not print environment files, tokens, cookies, OAuth material, signed URLs,
  ticket codes, email addresses, payment identifiers, or raw request bodies.
- Do not claim browser, network, payment, backup-restore, or production
  behavior from a unit test or a green workflow that did not exercise it.
- During an active event, prefer observation and reversible runtime controls;
  do not deploy or restart unless the user explicitly accepts the live impact.

## Incidents and alerts

Identify the owning service and runbook, current/deployed revision, first and
last failure, user-visible impact, queue/retry state, and last known healthy
target. Expected abandonment—such as opening a payment provider and returning
without approval—must become a terminal non-error state rather than a durable
failure loop. Do not silence an alert until the underlying state is either
healthy or deliberately terminal and the alert condition has cleared.

Rollback only across a demonstrated compatible app/worker/schema boundary.
When compatibility is uncertain, contain new writes, preserve evidence, keep
the compatible worker draining if required, and roll forward.

## Completion receipt

Persist one compact receipt in the canonical pull request, issue, workflow
artifact, or deployment record:

```text
objective; owner; repo/lane; base; candidate/digest; required gates + run IDs;
staging evidence; production previous/current; recovery target; blocker; next safe command
```

A handoff is successful when the next operator can reproduce the state with
`hb doctor`, not merely when they can read the receipt. Never create parallel
journals containing subtly different current-state claims.
