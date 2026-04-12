# Phase 3 — Mobile & Research GA

*Draft · 2026-04-12 · author: product design, pending validation*

**Duration**: ~8 weeks
**North star**: *app stores live, research protocol running for real.*

Phase 3 ships two deferred promises as a single 1.0 release. The mobile apps land on Play Store and App Store, in production, not beta. The research protocol moves from scaffolding (Phase 1) to active enrollment, preregistration, and published aggregates. They ship together because the research narrative is much stronger with mobile parity and because the mobile apps are where most longitudinal participants will actually live.

A note on sequencing: if one track is clearly ahead of the other entering Phase 3, the ahead-track ships first as a point release, and the second follows inside the same phase window. We do not hold one back for the other.

---

## 1. Scope of the phase

Three tracks.

1. **Mobile** — land the Flutter migration on `main`, ship store listings in EN/ES, wire in-app patronage on both stores, handle platform edge cases, release 1.0.
2. **Research** — finalize IRB-equivalent coverage, name a Principal Investigator, preregister the launch protocol, turn on consent + pre/post surveys + follow-ups, publish the first readout.
3. **Shared** — multi-region LiveKit fallback, chaos drill, 1.0 launch comms.

---

## 2. Deliverables — Mobile track

### 2.1 Land the Flutter migration

- [ ] Review `feat/flutter-migration` against current business rules (post-Phase-1/2 additions)
- [ ] Merge-ready PR: resolve any drift from the webapp API contracts since the PoC
- [ ] Address every "pending validation" note left during the PoC (audio session re-apply, token refresh, background lifecycle across device matrix)
- [ ] Merge to `main` with the Expo shell retired or archived as a separate directory

### 2.2 Store listings

- [ ] Google Play Store:
  - Internal → closed → open beta → production, with test groups at each gate
  - Store listing in EN and ES
  - Screenshots, feature graphic, promo video (optional)
  - Privacy labels ("Data safety" section) truthful and complete
  - Content rating honest (not medical, but involves live audio and user-generated content)
- [ ] Apple App Store:
  - TestFlight internal → external → App Store
  - Store listing in EN and ES
  - Screenshots on all required device sizes
  - Privacy labels truthful and complete
  - App Store Review notes: explain the live-beacon + user-overlay architecture, the subscription model, and the research surface (adds scrutiny but pre-empts rejection)
- [ ] App Tracking Transparency on iOS (declare no tracking where true)
- [ ] Deep links from the marketing site (universal links / app links)

### 2.3 In-app patronage

- [ ] iOS: StoreKit-based subscription for Threshold / Resonant / Kindred tiers (Hearth remains web-only given Apple's one-price-per-tier constraint)
- [ ] Android: Play Billing equivalent tiers
- [ ] Entitlement bridge: the platform's `Patronage` entitlement model is source of truth; mobile-purchased entitlements sync in via StoreKit / Play webhooks
- [ ] Restore purchases flow (iOS requirement)
- [ ] Cancellation instructions link to the platform's native cancel flow on each store (Apple and Google rules; we respect them)
- [ ] Web patrons who open the app see their web entitlement respected (link via email verification)

### 2.4 Platform edge cases

- [ ] Background audio on iOS: validated across iOS 17/18/19, audio-session category `.playback` with mixWithOthers, lock-screen controls, Now Playing info
- [ ] Background audio on Android: foreground service, MediaSession, notification controls, Doze-mode behaviour
- [ ] CarPlay / Android Auto: basic playback controls (stretch goal)
- [ ] Interruption handling: phone calls, navigation, other audio
- [ ] Low-bandwidth behaviour: graceful degradation, no crashes, honest UI state
- [ ] Battery impact: measured on reference devices, documented

### 2.5 Mobile telemetry

- [ ] Crash reporter (Sentry / Firebase Crashlytics) with sourcemaps / symbols
- [ ] Non-PII usage metrics: app start, session starts, session completes, source state transitions, tier upgrade, cancel
- [ ] Error reporting with PII scrubbing
- [ ] Release tracking: which app version is reporting each event, so regressions are localizable

---

## 3. Deliverables — Research track

### 3.1 Ethics and governance

- [ ] IRB-equivalent coverage confirmed: either through an institutional partner, a private IRB engagement, or an ethics committee within a partnering university
- [ ] Principal Investigator named publicly with consent
- [ ] First preregistered protocol posted to OSF or equivalent public registry
- [ ] Informed-consent copy finalized, reviewed by the ethics body, translated EN/ES
- [ ] Participant advisory: an accessible contact path for questions about research participation

### 3.2 Consent and enrollment

- [ ] Consent UI: presented after signup (opt-in, skippable), re-presentable on demand
- [ ] Version-tagged consent records stored in `ConsentRecord` (scaffolded in Phase 1)
- [ ] Enrollment creates a `ResearchParticipant` with a new `rpid` separate from the user
- [ ] Withdraw UI: one-click, choice of erase-all or retain-pseudonymized
- [ ] Audit log captures consent events with timestamp and version

### 3.3 Instruments

- [ ] Pre-session short-form survey (final instrument TBD per IRB, likely POMS-SF + STAI-6)
- [ ] Post-session short-form survey (likely POMS-SF repeat + brief reflection)
- [ ] Weekly follow-up (likely WHO-5)
- [ ] Instruments versioned; responses tagged with the version answered
- [ ] Accessibility: each survey passes WCAG 2.2 AA; screen-reader parity tested

### 3.4 Data pipeline

- [ ] Automated pseudonymization: identifiable → pseudonymized records in separate schema
- [ ] Aggregate rollup job: K-anonymized bucketed statistics
- [ ] Export jobs:
  - Individual participant export (included in user data export)
  - Researcher export under data-use agreement (to be used only after Phase 4 RESEARCHER role launches; framework ready)
- [ ] Retention: identifiable purged within 30 days of withdrawal-with-erasure; pseudonymized retained indefinitely unless withdrawn; aggregates always retained

### 3.5 Public transparency

- [ ] `/research` dashboard with real numbers:
  - Enrollment count
  - Sessions contributing to research
  - Distributions on published scales (aggregated)
  - Current preregistered protocols
- [ ] First readout post: "The T0 of the Beacon protocol" — who enrolled, what we captured, what we haven't yet claimed
- [ ] Publish negative or null findings as readily as positive ones; start the norm now

### 3.6 Researcher role (scaffolded)

- [ ] `BEAC_RESEARCHER` role in Zitadel
- [ ] Middleware gating for `/api/research/*`
- [ ] Data-use agreement flow (signed click-through tied to role grant)
- [ ] Read-only exports, no identifiable access
- [ ] Not yet broadly issued; intended for Phase 4+ onboarding of research partners

---

## 4. Deliverables — Shared

### 4.1 Multi-region fallback

- [ ] Second LiveKit server in a different region for read-only fallback
- [ ] Client-side region selection: connect to closest, fall back to alternate on persistent failure
- [ ] Source-state UI reflects region transition honestly

### 4.2 Chaos drills and continuity

- [ ] Quarterly chaos drill executed during the phase: deliberate primary-region failure, confirm fallback behaviour on web + iOS + Android
- [ ] Incident-simulation tabletop exercise on S0 scenarios (data exposure, extended beacon dark)
- [ ] SLO review: based on Phase 2 data, tighten the beacon-audibility target if warranted; document changes

### 4.3 1.0 launch comms

- [ ] Press kit: logos, screenshots, team bios, one-page product overview, technical FAQ, research FAQ
- [ ] Partner statements: research partner, at least one institutional pilot, a notable Provider
- [ ] Launch post on the marketing site
- [ ] Coordinated social (once Instagram / X are claimed in Phase 1 / 2)
- [ ] Target: friendly press first (podcasts, contemplative-science newsletters, aligned publications); not TechCrunch

---

## 5. Success criteria

Phase 3 is done when:

1. The Flutter app is in production on both Play Store and App Store, not in beta, with no open P0 or P1 regressions.
2. A patron can subscribe on iOS, Android, and web and see the same entitlement respected across all three.
3. The research protocol has at least 100 enrolled participants with consent records on file.
4. The `/research` dashboard reflects real, aggregated numbers updated at least weekly.
5. The first research readout has been published, regardless of whether the result flatters us.
6. Multi-region fallback has been tested in a drill and survived without user-visible disruption beyond the source-state UI change.
7. No Phase 1 or Phase 2 commitment has regressed.
8. The platform's SLO is being met or exceeded.

---

## 6. Non-scope (explicit)

- No Constellation charter, no federation of beacons.
- No Seal certification process.
- No hardware product.
- No retreats or in-person events (out-of-band AlterMundi activity may run, but not under this roadmap).
- No generative-AI-produced content on the platform.
- No geographic expansion beyond EN/ES regions.
- No open-source / self-hostable release of the platform.

---

## 7. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apple App Store review rejects subscription model citing medical or health-app rules | Med | Submit early TestFlight, engage App Review proactively via Review notes, have alternate copy framings ready (remove any clinical verbs in store copy first) |
| Google Play rejects for user-generated live audio without adequate moderation evidence | Med | Moderation tooling from Phase 2 provides the evidence; prepare a written policy summary for review |
| IRB turnaround stretches past Phase 3 window | Med-High | Begin engagement in Phase 1; negotiate a phased approval (low-risk instruments first) if needed; do not launch research without coverage |
| Flutter migration reveals issues not seen in the PoC | Med | Allocate 2 weeks in the phase for "adverse discovery" buffer; be willing to ship research-only first if mobile slips |
| Research participants drop off at the consent screen | Med | Treat consent as a UX design problem, not a legal one; A/B test copy under IRB approval; measure enrollment funnel |
| Revshare reconciles with mobile IAP messy because of 15–30% store cuts | High | Document the cut clearly in Provider statements; do not attempt to push cut onto Providers; absorb at the platform level |
| Multi-region adds bandwidth cost and complexity | Med | Second region is for fallback only, not load-balancing; keep scope minimal (one region, one SFU, no cross-region publishing) |

---

## 8. Capacity assumptions

- 1 senior full-stack engineer (backend, entitlement bridge, research pipeline)
- 1 Flutter engineer (mobile track primary)
- 1 design / frontend engineer (mobile UI, research UI)
- 1 ops / infrastructure engineer (multi-region, chaos drills)
- 1 research / writing (IRB liaison, instrument finalization, readout authorship)
- 1 product / comms (launch)
- Access to legal counsel (store policies, DUA templates)

Budget additions: second LiveKit region, chaos drill effort, PR tools if applicable, localization review.

---

## 9. Entry to Phase 4+

Phase 4+ is optional and strategic, not automatic. The conditions for starting it deliberately:

- Phase 3 has run for at least one quarter in production and metrics are healthy.
- The team has signal on which trajectory (Constellation, Seal, hardware, retreats, scholarly partnerships, geographic expansion, open protocol) the community and research demand most.
- Finances are stable enough to invest in a multi-month initiative without risking operational commitments.
- The roadmap is re-reviewed in public with a summary of learnings from Phases 1–3.

If those conditions aren't met, the right move is to stay on Phase 3 maintenance and operate the instrument, which is a valid permanent state.
