# Harmonic Beacon — Documentation Index

*Draft · 2026-04-12 · pending validation*

This directory holds the living documentation of the product, the policies it enforces, and the long-term development project. It is meant to be read, edited, and questioned — the word "pending validation" at the top of each document is real.

## How the docs fit together

```
VISION.md                ← what Harmonic Beacon is and is not
PRODUCT_PRINCIPLES.md    ← standing rules for making decisions
..
BUSINESS_RULES.md        ← canonical policy (root-level)
├── MONETIZATION.md      ← patronage, donations, provider economy, institutional licensing
├── RESEARCH_PROTOCOL.md ← consent, surveys, ethics, data handling
├── CONTENT_POLICY.md    ← what providers may publish, moderation workflow
├── TRUST_AND_SAFETY.md  ← threat model, controls, incident playbooks
└── SLO.md               ← the Covenant of Continuity, uptime targets, client contract
..
ROADMAP.md               ← long-term development project, phases 1–4+
└── phases/
    ├── PHASE_1_CREDIBILITY.md
    ├── PHASE_2_PARTICIPATION.md
    ├── PHASE_3_MOBILE_RESEARCH_GA.md
    └── PHASE_4_CERTIFICATION_AND_BEYOND.md
```

## Reading order

**First time through the repo** — read in this order:

1. [VISION.md](./VISION.md) — 10 minutes, the frame.
2. [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) — 5 minutes, the rules.
3. [BUSINESS_RULES.md](../BUSINESS_RULES.md) — 15 minutes, the policy spine.
4. [ROADMAP.md](./ROADMAP.md) — 10 minutes, where we are going.

The detail docs and phase docs are reference material; read them when you need the specifics.

## Editing these docs

- These docs are living. A policy change ships with a docs change.
- Substantive changes should be discussed in a PR with reviewers drawn from the affected surface (e.g. moderation changes get a Steward or Admin reviewer).
- Preserve the "Draft · YYYY-MM-DD · pending validation" note until the product lead signs off; after validation, update to "Ratified · YYYY-MM-DD" and keep a changelog section in the doc.
- Keep the tone and register consistent with the brand — careful, precise, confident, non-salesy.

## What goes where

| If you are working on... | Edit first... |
|---|---|
| Roles, capabilities, lifecycle states | BUSINESS_RULES.md |
| Patronage tiers, pricing, Provider payouts | MONETIZATION.md |
| Surveys, consent, data, IRB posture | RESEARCH_PROTOCOL.md |
| Provider guidelines, moderation rules, appeals | CONTENT_POLICY.md |
| Security controls, reports, incidents | TRUST_AND_SAFETY.md |
| Uptime, source states, client behaviour under degradation | SLO.md |
| Product identity, voice, refusals | VISION.md or PRODUCT_PRINCIPLES.md |
| Work sequencing, milestones, goals | ROADMAP.md or a phase doc |

## Open threads

Live questions the team needs to resolve, in rough priority order:

- **Ethics-review partner**: an institution to back the research protocol ([RESEARCH_PROTOCOL.md §8](./RESEARCH_PROTOCOL.md)).
- **Named Principal Investigator** for research.
- **Counsel engagement** for Privacy, Terms, Provider Content Agreement, DUA templates.
- **Marketing site decision**: rebuild in the repo vs. enhance the Hostinger site ([PHASE_1_CREDIBILITY.md §2.2](./phases/PHASE_1_CREDIBILITY.md)).
- **Tax advisor** engagement before Phase 2 launch.
- **First institutional pilot** named prospect.
- **Constellation charter draft** (Phase 4+, but worth starting to shape earlier).

These threads belong in the team's issue tracker, not in these docs, but they are noted here so they are not forgotten when the docs are reviewed.
