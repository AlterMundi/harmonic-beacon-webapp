---
name: review-agent
description: "Review code changes read-only and report concrete defects."
license: Apache-2.0
metadata:
  version: "0.1.0"
  author: "OpenAI, Nicolás Echániz, Codex"
  platforms: ["linux", "macos", "windows"]
  hermes:
    tags: ["review", "code-review", "quality", "read-only"]
    category: "development"
    related_skills: ["fast-forward-mode"]
---

# Review Agent

Perform a read-only, defect-first review of a specified uncommitted change,
base-branch diff, commit, or pull-request candidate. Return every actionable
finding the author would likely fix.

Do not modify files, create commits, push branches, post review comments, or
delegate the review. A separate user request may authorize publishing the
finished review after the read-only pass is complete.

## When to Use

Use this skill when the user or another agent requests review of a diff,
branch, commit, pull request, or uncommitted change. Do not activate it for an
implementation request merely because reviewing one's own integrated diff is
part of normal engineering work.

## Review the change

1. Read the applicable repository instructions, including every `AGENTS.md`
   governing the changed paths.
2. Resolve the requested target. For a base-branch review, use the change that
   would actually merge: prefer an up-to-date configured upstream, compute
   `git merge-base HEAD <comparison-ref>`, and inspect the diff from that
   merge base. If a named local ref is absent, try its configured remote ref
   before declaring it unavailable.
3. Inspect the complete diff and enough surrounding code, tests, schemas,
   callers, configuration, and migration or rollback paths to understand each
   changed behavior.
4. Identify concrete regressions introduced by the change. Continue through
   the whole diff after finding the first issue.
5. Use focused read-only checks when they materially distinguish a defect from
   speculation. Do not mutate external systems or production data as review
   evidence.

Flag a finding only when all of these are true:

- It affects correctness, security, performance, operability, or
  maintainability in a meaningful way.
- It is discrete and actionable.
- It was introduced by the reviewed change.
- The affected scenario or call path can be demonstrated from the code or
  reproducible evidence.
- The author would probably fix it if they knew about it.

Do not flag style nits, intentional behavior changes, pre-existing defects,
generic hardening wishes, or concerns unsupported by an affected path. Missing
tests are findings only when they leave a concrete changed behavior unsafe or
incorrect, not merely because coverage could be broader.

## Write the result

Present findings first, ordered by severity. Use one entry per issue:

`[P1] Imperative finding title — path/to/file.ts:line`

Follow it with one short paragraph that names the affected scenario and why
the behavior is wrong. Cite the smallest useful changed-line range.

- `P0`: universal release blocker or critical failure.
- `P1`: urgent defect that should be fixed next.
- `P2`: ordinary defect that should be fixed.
- `P3`: low-impact defect that is still worth fixing.

If no issue qualifies, say `No findings.` Then give a brief overall assessment
and name material test gaps or residual risks without converting them into
invented findings.
