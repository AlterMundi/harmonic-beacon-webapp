---
name: harmonic-beacon-operations
description: "Operate Harmonic Beacon from authoritative live state."
license: Apache-2.0
metadata:
  version: "0.1.0"
  author: "Nicolás Echániz, Codex, CompAII"
  platforms: ["linux", "macos", "windows"]
  hermes:
    tags: ["harmonic-beacon", "operations", "release", "incident-response"]
    category: "devops"
    related_skills: ["fast-forward-mode", "review-agent"]
---

# Harmonic Beacon Operations

Operate, diagnose, release, or recover Harmonic Beacon without reconstructing
the platform from old conversations. This skill applies to work involving
production, staging, deploys, incidents, service health, release provenance,
rollback, or operational takeover in the Harmonic Beacon ecosystem.

It does not grant production authority. The user's current authorization and
the repository's operating contract still control every external mutation.

## When to Use

Use this skill for Harmonic Beacon production or staging operations, deploys,
release promotion, incident diagnosis, recovery, health checks, operational
handoffs, and verification of the platform's live state. Do not use it for an
ordinary local product edit that has no environmental or release concern.

## Start from authoritative state

1. Locate the repository root and read `AGENTS.md` and
   `docs/ops/OPERATING_CONTRACT.md` completely.
2. Run `scripts/hb.mjs doctor` before planning an operational mutation. Use
   `--offline` only when network checks are genuinely unavailable, and record
   what remains unknown.
3. Treat `deploy/platform-services.json`, current Git/GitHub state, workflow
   runs, service health responses, and exact deployed provenance as current
   evidence. Plans, issue comments, handoff reports, memories, and old
   worktrees are historical until verified.
4. Inspect concurrent worktrees and operators. Preserve their work and keep a
   single accountable owner for each mutable environment and worktree.

## Route the change

Run `scripts/hb.mjs change-impact --base <comparison-ref>` for a proposed
change. Use its output as a conservative starting point, then add any checks
required by the actual risk. Never remove a required gate merely because the
classifier did not recognize a path.

Keep service releases independent unless a shared contract requires an
ordered rollout. A Live change does not imply an Account, Listener, Home,
Analytics, payment-authority, tapestry, or playlist deployment. Follow the
owner repository, lane, workflow, and recovery document in the service
catalog.

## Mutating environments

- Use reviewed GitHub workflows and the restricted deployment helper named by
  the operating contract. Do not replace them with direct Compose, Docker,
  root shell, database, or host edits merely because those commands are
  technically reachable.
- Resolve the exact candidate SHA, artifact or image digest, current deployed
  revision, recovery target, active-session state, migration compatibility,
  and required gates immediately before promotion.
- A failed check blocks promotion, not in-scope diagnosis and repair. Repair
  the same candidate line and rerun the evidence invalidated by the change.
- Never expose secrets, tokens, cookies, payment identifiers, participant
  data, environment-file contents, or signed URLs in logs, chat, issues, or
  receipts.
- Do not touch DNSExit unless the user explicitly creates a separate scope for
  that exact DNS change. Do not exercise real payments as an operational
  smoke. Keep Apple disabled until its external material exists.

## Incidents and recovery

Prefer containment that preserves evidence and customer state. Identify the
affected service, current revision, user-visible impact, last known healthy
revision, queue or migration compatibility, and rollback contract. Do not
perform a destructive rollback, delete ledgers, downgrade schemas, or abandon
writers/workers across an incompatible boundary.

For alerts, distinguish a durable business job failure from an abandoned
checkout or expected user behavior. Stop retry or notification storms only
through the owning queue/runbook contract; do not hide a real unresolved
failure by muting the alert.

## Completion and handoff

After every external mutation, read back the exact target. Record one compact
receipt containing: objective, owner, repository/lane, base, candidate/digest,
gate and run identifiers, staging evidence, previous/current production
revision, recovery target, concrete blocker if any, and next safe command.

Do not declare an operation complete from a green workflow alone. Confirm the
real deployed provenance, health/readiness, required private boundaries,
service-specific smoke, and recoverability. If another operator takes over,
they must be able to reproduce current state with `hb doctor` rather than
trusting the receipt blindly.
