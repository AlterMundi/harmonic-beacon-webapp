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

Invoke the skill through the host agent's syntax: `/fast-forward-mode` in
Hermes or `$fast-forward-mode` in Codex. Give it the requested project outcome,
not merely the next task. The agent should inspect authoritative current state
and select the nearest meaningful milestone on the dependency path to that
outcome.

Apply the host agent's normal tool, safety, and communication rules. This skill
changes work granularity, not permissions.

## Quick Reference

| Prefer | Avoid |
|---|---|
| One accountable owner, with safe parallel work | Author/reviewer/fixer handoff chains |
| Large safe coherent batches | Stopping after every small edit |
| Relevant proof at batch boundaries | Repeating already-valid evidence |
| Repair and continue after a failed gate | Treating a failed gate as a new permission request |
| Durable decisions and concise status | Narrating every command or creating many status files |
| A real end-to-end slice | Extra scaffolding that does not unlock use |
| Continue through successive milestones | Stopping at the first green intermediate milestone |

## Procedure

1. Inspect authoritative current state. Distinguish live state from historical
   reports, plans, memories, and stale worktrees. Check the branch and base,
   dirty and untracked files, concurrent worktrees or operators, and relevant
   live processes. Preserve pre-existing user work and distinguish it from the
   batch.
2. Define the requested outcome and its definition of done. Name the nearest
   meaningful runnable or releasable milestone on the path to that outcome.
3. Derive the dependency path. Keep genuine prerequisites; defer improvements
   that do not block the milestone.
4. Group compatible code, contracts, migrations, documentation, fixtures, and
   tests into the largest safe coherent batch. "Largest safe" means reviewable,
   recoverable, and bounded by real ownership and side-effect boundaries, not
   the largest possible diff.
5. Batch independent reads, searches, and verification calls. Parallelize
   genuinely independent work under one accountable owner, but never let
   multiple agents edit the same worktree concurrently.
6. Implement the batch without stopping for approvals already granted by the
   user's scope. Make reasonable, reversible assumptions when they do not
   materially alter intent.
7. Validate at the appropriate boundary with evidence proportional to the
   claim. Reuse still-valid proof and rerun checks invalidated by the new
   change.
8. If a gate fails, inspect its evidence and identify the most likely causal
   failure before changing code. For a behavioral regression, add or strengthen
   a deterministic focused regression test when practical. If deterministic
   reproduction is not practical, preserve the strongest reproducible evidence,
   repair the defect, and add the strongest feasible coverage before completing
   the batch. Rerun every check invalidated by the repair, then continue. A
   failure blocks promotion or completion; it does not by itself end the work.
9. Review the integrated diff and behavior adversarially once. Use an
   independent review only when the user, project contract, or risk actually
   requires it. Do not create recursive review loops or reviewer quotas.
10. After any external mutation, read back the exact target and verify the
    resulting version, record, configuration, or observable behavior.
11. Persist only the decisions, receipts, and deferred work needed for another
    operator to resume. Prefer the project's canonical tracker and one compact
    state pointer over parallel journals.
12. After a milestone passes, continue immediately to the next unblocked
    milestone while requested scope remains. Stop only when the requested
    outcome is complete or a genuine blocker or authorization boundary is
    reached. Then report completed milestones, material decisions, changed
    risk, external blockers, proof, and any explicitly deferred scope.

## Verification Speeds

| Boundary | Evidence |
|---|---|
| Edit loop | Changed-file checks, focused regression tests, and a local behavior smoke |
| Batch boundary | Relevant subsystem suites, contracts or integration checks, and the integrated diff |
| Release or external-state boundary | Every configured required gate, the real artifact and environment, health, and rollback or recovery where applicable |

Risk-specific project contracts override this table. A fast edit loop is not
release evidence, and a heavyweight release rehearsal is not required after
every safe local edit.

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
- Pending CI is not a reason to hand control back to the user: monitor it or
  continue independent work. Required CI must still pass before promotion or
  completion. A technical failure is work to repair. An external dependency
  that cannot be obtained autonomously is a blocker.
- Never broaden a terminal instruction such as “finish” into permission for
  unrelated external changes.

## Verification

Before claiming the requested outcome complete, confirm:

- The delivered result matches the full requested scope.
- Evidence covers the breadth and risk of the claim.
- Relevant regressions, recovery, or rollback behavior were checked where
  applicable.
- Failed or skipped required gates are visible and unresolved ones block the
  completion claim.
- External state, if changed, was read back from the exact target and matches
  the intended version or outcome.
- Any remaining requested scope is explicitly deferred by the user or blocked
  by a named external condition or authorization boundary.
- The final report distinguishes completed work, remaining scope, and genuine
  blockers.
