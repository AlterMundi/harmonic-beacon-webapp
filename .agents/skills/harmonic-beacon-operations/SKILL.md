---
name: harmonic-beacon-operations
description: "Operate Harmonic Beacon from authoritative live state."
license: Apache-2.0
metadata:
  version: "0.2.0"
  author: "Nicolás Echániz, Codex, CompAII"
  platforms: ["linux", "macos", "windows"]
  hermes:
    tags: ["harmonic-beacon", "operations", "release", "incident-response"]
    category: "devops"
    related_skills: ["fast-forward-mode", "review-agent"]
---

# Harmonic Beacon Operations

Use for operating, releasing, recovering or taking over a Harmonic Beacon
service. Ordinary local product edits do not require a platform audit.

## Enter through the repository

Resolve the canonical owner repository in `deploy/platform-services.json`;
`origin` can be a personal fork. In that repository read `AGENTS.md`,
`docs/ops/OPERATING_CONTRACT.md` and `docs/ops/OPERATOR_LOOP.md`. Those versioned
files contain the common procedure for Codex and Hermes, including required
release/recovery checks. This skill is a router, not a second policy copy.
Existing user authorization defines scope; installing a skill grants none.

Use a clean worktree and check for another owner or in-flight deployment.
Before operational mutation, run `node scripts/hb.mjs doctor --service ID` for
the affected service. Investigate relevant unknowns rather than interpreting
the platform's aggregate error count as a universal stop. Preserve unrelated
work and keep one owner per mutable target.

## Choose the next action

- Product failure: inspect the actual failure and repair with focused tests.
- PR/CI blockage: `node scripts/hb.mjs delivery-status --pr NUMBER --json`
  identifies current head/base/merge, observed gate, reviews and unknowns.
  It is diagnostic, not admission authority; do not treat its exit 0 as ready
  to deploy. Revalidate old callbacks against current PR/run/attempt.
- Qualification: use `change-impact` and the required risk-specific checks at
  the integrated boundary. A failed gate blocks promotion; continue authorized
  repairs. Carry forward evidence only for unchanged behavior and inputs.
- Promotion/recovery: use the owning service's reviewed workflow and restricted
  helper. Read the catalog's relevant runbook and verify the actual candidate,
  environment, recovery path and result. Shell access is not extra authority.
- Missing reviewer/access: name the actual dependency, preserve the candidate
  and continue independent in-scope work. Do not change identities or weaken
  branch protection to manufacture independent approval.

Keep one continuation record in the owning issue/PR with owner, objective,
candidate, phase, relevant runs, blocker and next action. Do not copy secrets,
customer data or private skill history into it. After interruption, consult the
target before repeating an action. Completion requires the requested deployed
behavior and readback, not merely a report, merged PR or green CI.
