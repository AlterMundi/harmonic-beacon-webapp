# Shared operator loop

Codex and CompAII/Hermes use this same procedure. The user appoints the owner
of a delivery; the model, machine and tool access do not appoint one. This
document supplies the working loop; [OPERATING_CONTRACT.md](OPERATING_CONTRACT.md)
routes to the mandatory delivery invariants at release boundaries. Proposed
changes to those invariants must be implemented and reviewed before use.

## Start and continue

1. Resolve the canonical repository from `deploy/platform-services.json`.
   Inspect Git remotes: `origin` may be a personal fork. Read `AGENTS.md` from
   the canonical protected base, preserve existing work, and use a clean worktree.
2. Locate the issue/PR that owns the requested outcome and its dependencies.
   Record the owner and next action there when a handoff or long wait needs it.
   Do not create another journal, issue hierarchy or status service for the task.
3. Before environmental mutation, run `node scripts/hb.mjs doctor --service ID`.
   Classify its findings by relevance to that operation. An unrelated service's
   missing credential does not block this service; a missing required deploy
   adapter or recovery target does. An unavailable check stays unknown.
4. Develop and repair in a coherent batch with focused tests. At integration,
   use `change-impact` plus checks required by the actual risk. Reuse unaffected
   evidence; required hosted checks still have to qualify the candidate.
5. Review the integrated result as the task owner and
   deliver through the service's reviewed workflow. Read back the deployed
   artifact and relevant behavior. A merged PR is an intermediate outcome.

A failed test continues the repair loop. External GitHub approval is not a
prerequisite. Automated checks and production authorization still apply.
A new human instruction can pause or change the work;
previous callbacks do not override it.

## Owner review, adversarial assistance when warranted

The owner reviews and delivers autonomously. Use an adversarial subagent only
for a concrete risk or unresolved uncertainty; not every PR, commit or repair.
Resolve substantive findings before promotion. Never switch credentials to
manufacture independent approval or create a reviewer-of-the-reviewer chain.

| Change | Editing loop | Integration/review | Release |
| --- | --- | --- | --- |
| Documentation or bounded presentation | Diff, appropriate render/check | Owner review | Only selected surfaces; no unrelated runtime work |
| Product behavior | Focused regression; local behavior | Selected subsystem/browser checks; owner review | Artifact smoke on affected service |
| Audio, identity, permissions, payments | Causal reproduction and focused checks | Named critical matrix; adversarial review when risk warrants it | Real behavior, provenance, compatible recovery |
| Data migration or privileged delivery | Failure/recovery tests | Review authority, compatibility and failure paths together | Required isolated restore/rehearsal and host admission |

After a finding, the owner repairs and the reviewer checks the fix and its
interactions. Reopen the whole review only when the repair changes its scope or
assumptions. Do not restart independent review for each commit or harmless text
edit. Never add a reviewer-of-the-reviewer chain by default.

Keep one meaning for each result: local tests, hosted qualification, source
approval, merge eligibility, artifact readiness and production verification are
distinct. Report whichever has actually been established.

## Diagnose the delivery boundary

```bash
node scripts/hb.mjs delivery-status --pr 554 --json
```

This GET-only diagnostic checks the canonical repository by default and shows
head, base and merge identities, observations of checks and the gate on both
refs, GitHub review state, and unavailable sources. Exit 0 means the diagnostic
was complete and the PR identity did not change; it does **not** mean admission
or production readiness. Exit 2 means incomplete or changing observations.

Read the failed run before changing code. Distinguish product defect, fixture
defect, runner failure, missing evidence and stale gate target. Two runs of one
test can fail for different reasons. The gate belongs on the head under the
target branch's context, not on GitHub's regenerated synthetic merge. Investigate
missing or wrong-context evidence before recompiling the application.
The protected evaluator remains the authority for trusted required evidence.

Evidence can carry forward only for what it proves. A diagnostic reproduction
does not expire because a README changed; a review of a security boundary does
not cover newly changed authorization logic. Equivalent source trees can guide
revalidation, but do not permit copying a status to a new ref or bypassing the
configured head/base/attempt checks.

## Waiting, handoff and recovery after interruption

Use the existing issue/PR for one compact continuation record:

```text
Outcome and authorized scope:
Owner and service/environment:
Canonical repo; branch/PR; head/base; artifact if built:
Phase: repair | checking | review | release | verification | blocked | done
Latest relevant run/attempt or deployment receipt:
Next action; specific blocker if any:
```

Do not store credentials or customer identities in this record. After a crash,
query the actual refs, runs and deployment transaction before deciding whether
to resume or repeat an action. A stale receipt is a pointer, not permission.

The active owner retains the task while CI runs. Use the harness's existing
wait/background notification mechanism; if it cannot resume a task reliably,
use a bounded status wait in that active task and checkpoint before stopping.
An infinite polling loop is not required. A pending run is not evidence of a
failed task or a reason to request permission to continue.

For asynchronous completion, associate the callback with owner/task, repo,
PR, head, base, run ID and attempt. Re-read current state when it arrives.
Ignore superseded runs for action; coalesce duplicate callbacks; a cancelled
old attempt must not launch a second fixer. These are harness obligations,
not functionality supplied by installing a Markdown skill.

A handoff requires the outgoing owner to stop launching writes and the incoming
owner to inspect in-flight mutations. A comment alone is not a distributed lock.
The workflow/helper's environment lock and current-state comparison remain the
execution fence. If the old owner is offline, verify no transaction is running
before taking over. Distinct environments may have distinct owners.

## Host adapters and acceptance

`AGENTS.md` and versioned repo procedures are the common entry point. The
`harmonic-beacon-operations` skill is a short router, generated for both hosts
from one source. `review-agent` applies when reviewing code. `fast-forward-mode`
is optional delivery guidance, never a prerequisite for ordinary competent work.
Historical incident skills are references loaded for a matching incident,
not a second standing policy. Remove arbitrary repair-round limits from active
host instructions. Explicit user instructions retain priority.

For Hermes, expose the repository's generated skill in its active catalog or
explicitly read the repository entry point if discovery is absent. Validate
this in Telegram, CLI and delegated worktrees separately. Do not copy private
skills, credentials or memory wholesale. Do not overwrite a host's unrelated
configuration to install Beacon instructions.

Both operators pass the same exercise: resume a task with an obsolete run,
diagnose a real failure, repair, review, merge, release to staging,
verify recovery and hand it back with one continuation record. A subsequent
authorized production delivery demonstrates production operation. Record where
human action was required and why. Neither Codex nor Hermes is presumed capable
solely from previous experience or a well-written skill.
