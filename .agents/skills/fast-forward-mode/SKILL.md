---
name: fast-forward-mode
description: Deliver verified project batches with minimal ceremony.
metadata:
  hermes:
    tags: [delivery, execution, batching, verification]
    category: productivity
---

# Fast Forward Mode Skill

Move substantial project work to a runnable or releasable outcome in coherent
batches. It compresses ceremony and repeated coordination, never scope,
evidence, safety, or authorization boundaries.

## When to Use

Use this skill when the user asks to accelerate execution, fast-forward to a
milestone, bundle related changes, reduce token-heavy narration, or stop
cycling through tiny implementation and review steps.

Do not activate it merely because a task is large. Do not use it to bypass a
required external review, production authorization, safety constraint, or
acceptance criterion.

## Prerequisites

- The requested outcome and its scope are sufficiently clear to make progress.
- The current environment provides the normal tools needed by the project.
- Any action that changes external or production state remains subject to the
  user's existing authorization contract.

No additional software, service, or credential is required by this skill.

## How to Run

Invoke `$fast-forward-mode` with the project outcome. The agent should first
inspect authoritative current state and then select the nearest meaningful
runnable or releasable milestone.

Apply the host agent's normal tool, safety, and communication rules. This skill
changes work granularity, not permissions.

## Quick Reference

| Prefer | Avoid |
|---|---|
| One owner through the outcome | Author/reviewer/fixer handoff chains |
| Large safe coherent batches | Stopping after every small edit |
| Relevant proof at batch boundaries | Repeating already-valid evidence |
| Repair and continue after a failed gate | Treating a failed gate as a new permission request |
| Durable decisions and concise status | Narrating every command or creating many status files |
| A real end-to-end slice | Extra scaffolding that does not unlock use |

## Procedure

1. Inspect authoritative current state. Distinguish live state from historical
   reports, plans, memories, and stale worktrees.
2. Name the nearest meaningful runnable or releasable milestone and its
   definition of done.
3. Derive the dependency path. Keep genuine prerequisites; defer improvements
   that do not block the milestone.
4. Group compatible code, contracts, migrations, documentation, fixtures, and
   tests into the largest safe coherent batch.
5. Implement the batch without stopping for approvals already granted by the
   user's scope. Make reasonable, reversible assumptions when they do not
   materially alter intent.
6. Validate at the batch boundary with evidence proportional to the claim.
   Reuse still-valid proof and rerun checks invalidated by the new change.
7. If a gate fails, diagnose it, repair within scope, and continue. A failure
   blocks promotion or completion; it does not by itself end the work.
8. Review the integrated diff and behavior adversarially once. Use an
   independent review only when the user, project contract, or risk actually
   requires it. Do not create recursive review loops or reviewer quotas.
9. Persist only the decisions, receipts, and deferred work needed for another
   operator to resume. Prefer the project's canonical tracker and one compact
   state pointer over parallel journals.
10. Report completed milestones, material decisions, changed risk, external
    blockers, proof, and the next executable milestone.

## Pitfalls

- “Fast” does not mean skipping tests, concealing failures, weakening a
  security boundary, or declaring success from intent.
- Do not let support tooling, generalized cleanup, or documentation become a
  new critical path unless the milestone truly cannot be delivered safely
  without it.
- Do not repeatedly freeze, hash, copy, or review unrelated state after every
  edit. Protect the actual candidate and the evidence it invalidates.
- Do not ask the user to reauthorize safe and reversible actions already
  covered by the request. Stop for a genuinely missing credential, authority,
  destructive decision, production risk, or scope-changing product choice.
- Waiting for CI is not a blocker. A technical failure is work to repair. An
  external dependency that cannot be obtained autonomously is a blocker.
- Never broaden a terminal instruction such as “finish” into permission for
  unrelated external changes.

## Verification

Before claiming the milestone complete, confirm:

- The delivered result matches the full requested scope for that milestone.
- Evidence covers the breadth and risk of the claim.
- Relevant regressions, recovery, or rollback behavior were checked where
  applicable.
- Failed or skipped required gates are visible and unresolved ones block the
  completion claim.
- External state, if changed, matches the intended version or outcome.
- The final report distinguishes completed work, remaining scope, and genuine
  blockers.
