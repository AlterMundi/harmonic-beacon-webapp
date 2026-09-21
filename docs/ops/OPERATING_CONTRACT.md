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
scripts/hb.mjs change-impact --deployed-state current-state.json --head HEAD --json
```

`doctor` is read-only. A skipped or unreachable check means unknown, not
healthy. `change-impact` compares every service from its recorded deployed
source, not only the latest merge base. It emits explicit UI, functional and
critical matrices plus exact Live pull/replace actions. Unknown paths expand
coverage. Labels can only add risk. Missing, failed, cancelled or skipped
selected checks reject the candidate.

### Catalog evidence semantics

Schema version 2 supersedes every schema version 1 catalog interpretation and any older prose that treated a named runner, staging URL, alert sentence, or runbook as proof by itself.

This slice is catalog truth only; it is not delivery, alert-recipient, staging-drill, or recovery proof. It adds no workflow, helper, deploy adapter, recovery execution, production mutation, or product behavior. A `verified` artifact fingerprint requires a kind-compatible immutable digest or revision. Every kind-bearing evidence object uses the same verified-kind rule: `unknown` is never verified/OK, and verification requires concrete kind-compatible value or evidence. Verified recipient delivery, recovery exercise, and staging drill proof each require a bounded typed successful outcome: enclosing service identifier, globally unique receipt/run identifier, UTC observation time, an exact member of that proof's references, and SHA-256 binding for that referenced content. References or prose alone cannot establish verified proof. A `verified` field means that specific catalog fact has current evidence; it does not promote the whole service to delivered. `documented` produces a doctor warning, `unresolved`, `external`, and `unavailable` produce errors, and `not-applicable` is skipped. Network-disabled endpoint checks are also skipped rather than inferred healthy.

Catalog qualification is intentionally bounded before online checks or report output: UTF-8 input is at most 1,048,576 bytes; at most 64 services; at most 32 health endpoints, 32 staging environments, and 32 unresolved requirements per service; at most 1,024 aggregate endpoint/environment/requirement checks; and at most 2,048 doctor report entries. These conservative ceilings are above the current catalog and are mirrored by the schema's `x-runtimeLimits` contract plus enforceable `maxItems` keywords. Draft 2020-12 cannot express serialized byte size, nested aggregate sums, cross-object outcome identity, or equality between an outcome service/reference and its enclosing object; runtime validation enforces those limits and bindings before inspection.

Account and Listen remain separate services even though they share the webapp repository: both integrate through `main`, both currently deliver through `early-birds`, and each retains its own scripts and operational gaps. Analytics integrates through `main`, but its last documented deployment lane is `release`; its current deployed revision and artifact fingerprint remain unresolved. Authority/PMP owner-repository access remains external and unresolved. Home retains its repository-owned `main:/` Pages contract while its absent staging, recipient proof, and recovery exercise remain explicit gaps.

### Impact-scoped release and recovery (OPS-E)

Before preparing, promoting or recovering a release, read the applicable
[delivery invariants](DELIVERY_INVARIANTS.md). They remain mandatory and cover
selected-service replacement, migration compatibility and recovery ownership.
A documentation edit or read-only diagnosis does not require that release
rehearsal.

### Proportionate governance checks

A change limited to `.github/CODEOWNERS` and documentation remains a critical
governance change and receives owner review, with adversarial assistance only
when warranted by concrete risk. It does not qualify application artifacts: CI runs
the diff, bounded CODEOWNERS integrity, impact-selection, workflow-contract and
required-check evaluator checks, and records `deployment.deploy=false`.

The local validator checks only UTF-8 integrity and GitHub's documented 3 MiB
file ceiling. GitHub's exact-head CODEOWNERS errors API owns pattern and owner
semantics, while branch protection owns independent approval; an unavailable
online result is unknown rather than proof. Mixing ownership edits
with workflow, runtime, audio, authentication, unknown or other executable
paths selects the complete applicable profile for those paths.

## Change and release flow

The host-independent working procedure is [OPERATOR_LOOP.md](OPERATOR_LOOP.md).
It defines review scope, evidence reuse, CI continuation and handoff for both
Codex and Hermes. The linked delivery invariants remain part of this contract.

1. Resolve the owner repository, lane, candidate, deployed revision, active
   operators/worktrees, and overlapping pull requests.
2. Develop with focused checks and hot reload where appropriate. Keep
   unrelated services out of the build and restart set.
3. At the integrated boundary, run the profile selected by change impact plus
   contract-specific checks. Failed gates block promotion but do not end
   authorized diagnosis and repair.
4. The task owner reviews the integrated diff once and proceeds autonomously.
   External/GitHub approval is not required. Use an adversarial subagent only
   for a concrete risk or unresolved uncertainty that warrants it, especially
   around permissions, payments, migrations or recovery. Do not automatically
   request a reviewer for every change or create reviewer chains. Resolve
   substantive findings before delivery; applicable automated checks remain.
5. Promote the exact reviewed candidate through its configured workflow. Do
   not develop directly on a production lane or substitute a direct host
   command for an available reviewed path.
6. Read back exact deployed provenance, health/readiness, private boundaries,
   service-specific behavior, and recovery target.

The detailed [delivery authority and OCI transition contract](DELIVERY_INVARIANTS.md#delivery-authority-and-oci-transition)
is mandatory before changing CI authority, deployment helpers, protected
lanes, release admission or production state. Its requirements are unchanged;
they are loaded at those boundaries instead of repeated in every diagnosis.

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
