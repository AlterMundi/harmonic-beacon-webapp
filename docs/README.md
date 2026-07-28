# Harmonic Beacon — Documentation Index

> **Status: Draft — pending validation.** Nothing in this corpus is ratified.
> These documents describe both what Harmonic Beacon does today and what it
> commits to building; the two are distinguished per the convention in
> [§Describing what is not built yet](#describing-what-is-not-built-yet).

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
└── integrations/        ← evaluated external systems and implementation boundaries
    └── UNIVERSE.md      ← ticketing checkout, payments, webhooks, and API
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

## Describing what is not built yet

The 2026-06-09 audit ([audit/](./audit/)) found that this corpus systematically
described an aspirational product in the present tense: controls, endpoints and
guarantees asserted as facts that do not exist in code. For a wellness-adjacent
platform that invites vulnerable users, asserting a safety control you do not
have is worse than not having it — it converts an absence into a
misrepresentation.

[VISION.md](./VISION.md) promise 7 already states the standard: *"'We believe'
and 'we hope to prove' are never replaced with 'we have proven' without
evidence."* This section applies that standard to the documents themselves.

**The rule.** A claim about a system, control, endpoint, page or guarantee that
does not exist in `main` must be written in the future tense **and** carry a
phase tag:

> Every administrative action will be written to the audit log.
> **[Planned — Phase 1]**

Not `is written` with a tag appended — a present-tense claim beside a "planned"
marker contradicts itself and a reader will believe the sentence, not the
marker. Change the tense, then tag.

**Tags.** Exactly one of:

| Tag | Meaning |
|---|---|
| `**[Planned — Phase N]**` | Committed, gated on that phase |
| `**[Planned — unscheduled]**` | Intended, no phase assigned |
| `**[Aspiration]**` | Directional; no defined scope, no commitment |
| `**[Delegated — <system>]**` | Real, but provided outside this codebase (e.g. Zitadel). Name where, so it can be verified |

`[Aspiration]` is not a softer `[Planned]`. Use it only where no one is owed
delivery — vision-level statements. If a user, provider or regulator could
reasonably read a promise into it, it is `[Planned]`.

**Naming routes and pages.** Do not name a URL or endpoint that returns 404 as
though it were live. Either tag it, or describe the capability without the
address.

**Numbers become obligations.** An SLA, a percentage, a retention window or a
response time is quasi-contractual once published. Do not publish one that is
not measured — say "target" and tag it, or leave it out.

**Grepping the tags.** `grep -rn '\[Planned\|\[Aspiration\|\[Delegated' docs/
BUSINESS_RULES.md` lists every outstanding commitment. When a phase ships, the
tags it closes are the checklist. A tag removed without the corresponding code
merged is the same bug this convention exists to prevent.

## What goes where

| If you are working on... | Edit first... |
|---|---|
| Roles, capabilities, lifecycle states | BUSINESS_RULES.md |
| Patronage tiers, pricing, Provider payouts | MONETIZATION.md |
| Surveys, consent, data, IRB posture | RESEARCH_PROTOCOL.md |
| Provider guidelines, moderation rules, appeals | CONTENT_POLICY.md |
| Security controls, reports, incidents | TRUST_AND_SAFETY.md |
| Uptime, source states, client behaviour under degradation | SLO.md |
| External checkout, payment, webhook, or API integration | integrations/ |
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
