# Long-term Development Project

*Draft · 2026-04-12 · author: product design, pending validation*

This is the multi-horizon roadmap for Harmonic Beacon. It sits above the individual Phase docs in `docs/phases/` and below the [VISION.md](./VISION.md) compass trajectories.

Four phases, each roughly 8 weeks, plus a long-horizon section (Phase 4+) that is open-ended and reactive to what Phases 1–3 produce.

---

## Compass (restated)

Three long-horizon trajectories from [VISION.md](./VISION.md). Every phase is legible as movement toward one or more of them:

1. **The Beacon** — the operating instrument.
2. **The Constellation** — a federation of aligned local beacons.
3. **The Seal** — *Harmonically Aware Technology* as a certification mark.

Phases 1–3 build The Beacon as a credible, sustainable, monetizable product. Phase 4+ opens the door to The Constellation and The Seal.

---

## At a glance

| Phase | Name | Duration | North star | Shipping target |
|---|---|---|---|---|
| 1 | Credibility | ~8 weeks | We could let strangers in tomorrow and be proud, not embarrassed. | Public beta |
| 2 | Participation | ~8 weeks | People can support the work. Providers can contribute without drama. | Monetization live |
| 3 | Mobile + Research GA | ~8 weeks | App stores live. Research protocol running for real. | 1.0 release |
| 4+ | Constellation & Seal | open | Others can run beacons. The Seal has meaning. | Strategy-dependent |

Durations are optimistic estimates assuming a small, focused team. They are not contracts.

---

## Phase 1 — Credibility (weeks 1–8)

**See [phases/PHASE_1_CREDIBILITY.md](./phases/PHASE_1_CREDIBILITY.md) for detail.**

The product already works for a specific circle. Phase 1 makes it presentable to a wider circle without scaling the wider circle yet. It is almost entirely about the things that are embarrassing to not have, rather than the things that are exciting to have.

Key outcomes:

- Real marketing site with Theory, Experience, Analysis, and meaningful links.
- Published Privacy, Terms, Content Policy, Community Guidelines, mental-health disclaimer.
- Observability: Sentry, structured logs, uptime, basic metrics, audit log.
- Warm-standby upstream (`beacon02`) wired.
- Status page live.
- Abuse report endpoint and moderation tooling with SLAs.
- Research consent and survey schema in DB (instruments not yet collecting).
- Public research/transparency pages (placeholders with real structure).
- CDN + object storage in front of uploads.
- Postgres backup/restore demonstrated.
- i18n infrastructure across the Next.js app (EN/ES).

What Phase 1 is **not**: no Stripe, no app-store submission, no research data actually collected. Those are Phases 2–3.

**Exit criteria**: someone unfamiliar with the product could be handed the URL and get a coherent, credible picture of what this is, what it is not, and how to participate, without accidentally finding a broken link, a legal placeholder, or a feature that crashes.

---

## Phase 2 — Participation (weeks 9–16)

**See [phases/PHASE_2_PARTICIPATION.md](./phases/PHASE_2_PARTICIPATION.md) for detail.**

Phase 1 makes the product legitimate. Phase 2 makes it sustainable. Two distinct surfaces come online: patronage (money in) and structured Provider participation (content in, with proper rails).

Key outcomes:

- Stripe Billing + Checkout live for patronage tiers and donations.
- Stripe Connect Express live for Provider payouts (revshare model).
- Entitlement model in DB; patron-only benefits shipping.
- Hearth page live (opt-in public gratitude roll).
- Provider application flow (public form → Admin review queue).
- Provider onboarding: signed Content Agreement, tier selection, first-content submission.
- Moderation tooling: review queue, rejection reasons, appeal flow.
- Steward role in code (ADMIN-lite for community moderation, not yet widely issued).
- Sittings: scheduled synchronous listening events (no host, silent co-presence) in app.
- Resonance Journal (MVP): private notes per session.
- Transactional email provider wired (Resend/Postmark) for receipts, welcome, report acknowledgements.
- Lifecycle email foundations (welcome series only at this phase).
- Institutional licensing collateral: one-page pitch, sample DUA template, one named pilot institution.

What Phase 2 is **not**: no app-store listings, no research data collection, no production-grade scale-out. Still on the single-host architecture, with CDN + object storage from Phase 1.

**Exit criteria**: the platform is taking recurring money from patrons in at least three countries; at least three revshare Providers are earning payouts; at least one institutional pilot is in active conversation or contracted.

---

## Phase 3 — Mobile & Research GA (weeks 17–24)

**See [phases/PHASE_3_MOBILE_RESEARCH_GA.md](./phases/PHASE_3_MOBILE_RESEARCH_GA.md) for detail.**

Phase 3 turns two deferred promises into delivered features: a real mobile presence, and a real research instrument. Both need their own runway; they are separate tracks inside Phase 3 that ship together as 1.0.

Key outcomes (mobile track):

- Flutter migration from `feat/flutter-migration` finished, reviewed, landed.
- Release pipeline for Android (Play Store internal → closed → open beta → production).
- Release pipeline for iOS (TestFlight → App Store).
- Privacy labels, store descriptions, screenshots, localized in EN/ES.
- In-app patronage (IAP on iOS, Play Billing on Android) with a bridge to the web entitlement model.
- Graceful handling of platform-specific audio session edge cases at GA quality.
- Mobile-first flows: session notifications, background playback, lock-screen controls verified across device matrix.

Key outcomes (research track):

- IRB-equivalent review completed (partner institution or private IRB).
- Named Principal Investigator.
- First preregistered protocol (the launch protocol) posted publicly.
- Consent flow live, pre/post surveys live, follow-up scheduling live.
- Research data pipeline: identifiable → pseudonymized → aggregate, automated.
- Public `/research` dashboard with real aggregate numbers.
- First readout publishable: enrollment, retention, baseline distributions. No causal claims yet — this is the T0 of the longitudinal protocol.

Key outcomes (shared):

- Multi-region fallback for LiveKit (Phase 3 continuity step).
- Quarterly chaos drill executed and documented.
- SLO review and tightening as merited.
- Marketing push for 1.0: press kit, partner statements, readout of what it took to get here.

**Exit criteria**: the apps are on Play Store and App Store, in production (not internal beta); the research protocol is actively enrolling with at least 100 participants; the public dashboard reflects real data; no active P0 or P1 defects.

---

## Phase 4+ — Constellation, Seal, and Hardware (open-ended)

**See [phases/PHASE_4_CERTIFICATION_AND_BEYOND.md](./phases/PHASE_4_CERTIFICATION_AND_BEYOND.md) for detail.**

After 1.0, the product has a working instrument, a participation economy, a research pipeline, and an operational rhythm. Phase 4+ is about deciding which of the three long-horizon trajectories to invest in, in what order, and with what resources. This is explicitly not a pre-planned phase; it is a phase of deliberate strategic choice.

Candidate initiatives (each is a large undertaking, months to years of work):

- **Constellation Charter** — the protocol and governance by which aligned communities run local beacons that federate with the canonical app. Technical: node directory, cross-node auth and discovery, content federation rules. Governance: charter, signatory process, stewardship body.
- **The Seal** — Harmonic Awareness as a certification mark for devices, environments, and systems. Technical: audit methodology, test harness, public registry. Business: certification fee structure or membership model. Requires significant research credibility first; not before Phase 3 outcomes.
- **Hardware beacon** — a physical device (stand-alone, networked) that plays the stream ambient-room style. Likely an ESP32 / Raspberry-Pi-class SBC with a DAC and a quiet speaker. Speculative; informed by user demand.
- **Retreats & in-person events** — commercial and community events that bring the frame into shared physical space. Revenue and community-building.
- **Scholarly partnerships** — co-authored papers with named research partners; integration of Harmonic Beacon protocol into third-party research programs.
- **Geographic expansion** — structured rollout in additional language and regulatory regions (PT, FR, DE, JA), each with its own compliance and content partner workload.
- **Open protocol publication** — publishing a versioned, implementation-independent protocol spec for the beacon experience so that others can build compatible clients.

Phase 4+ should not start until Phase 3 has run long enough to produce signal about which of the above the community and the research demand most. A likely order based on alignment with the brand:

1. **Open protocol publication** (first — cheap, high-trust-impact).
2. **Scholarly partnerships** (naturally follows protocol).
3. **Retreats** (compounds with the community built in Phases 1–3).
4. **Constellation** (needs the protocol and the community).
5. **The Seal** (needs all of the above to have meaning).
6. **Hardware** (only if demand is clearly there and a partner relationship makes it feasible).

---

## Cross-cutting threads

Some work belongs to every phase rather than any single one:

- **Accessibility**: WCAG 2.2 AA progress reviewed every phase. A defect in accessibility is triaged at the same priority as a security defect.
- **i18n**: EN/ES are baseline from Phase 1; other languages added only when a content partner commits to carrying them.
- **Security**: quarterly review; dependency audit; secrets rotation per the schedule in [TRUST_AND_SAFETY.md §6](./TRUST_AND_SAFETY.md).
- **Observability**: each new surface ships with its own metrics; regression if a surface in prod has no observability.
- **Documentation**: VISION, PRINCIPLES, BUSINESS_RULES, and the policy docs are living documents. A policy change without a doc update is a bug.
- **Finance hygiene**: monthly review of runway, burn, grant pipeline, patronage growth; adjustments to the roadmap if the financial situation materially shifts.

---

## What this roadmap is not

- Not a Gantt chart. Dates are rough estimates; sequencing is the important part.
- Not a feature list. The north stars matter more than the bullet points; if a bullet ends up irrelevant we drop it, and if a new bullet fits a north star we add it.
- Not a commitment calendar to investors; AlterMundi's operating model and Harmonic Beacon's monetization (patronage + grants + institutional) make this a mission calendar, not a growth-hacking calendar.
- Not versioned by "v1, v2, v3 features." The beacon has one version, which evolves. Features are added or retired; the promise stays.

---

## Revision

This roadmap is reviewed at the boundary between phases and whenever external events change the operating context (major funding, major incident, major opportunity). Revision is public: the prior version is preserved in git history, and a summary of the change is posted to the community.
