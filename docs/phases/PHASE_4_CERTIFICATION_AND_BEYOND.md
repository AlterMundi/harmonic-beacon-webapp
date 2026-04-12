# Phase 4+ — Constellation, Seal, and Beyond

*Draft · 2026-04-12 · author: product design, pending validation*

**Duration**: open-ended
**North star**: *the instrument endures. What else can the frame carry?*

Phase 4+ is deliberately open-ended. It begins only after Phase 3 has run in production for at least one quarter and the team has real signal — from patrons, Providers, researchers, and institutions — about which of the long-horizon trajectories the community and the work actually want to be carried further.

This document is not a plan. It is a catalogue of candidate initiatives, each sketched deeply enough to be chosen from, with honest notes on what each one requires, what it risks, and what it unlocks.

---

## 1. Framing choice

Three long-horizon trajectories from [VISION.md](../VISION.md):

1. **The Beacon** — maintained, operated, refined. Permanent state, not a phase.
2. **The Constellation** — a federation of aligned local beacons.
3. **The Seal** — *Harmonically Aware Technology* as a certification mark.

Plus additional initiatives that extend or complement the above:

4. Open protocol publication.
5. Scholarly partnerships.
6. Retreats & in-person events.
7. Hardware beacon.
8. Geographic expansion.

Each is a multi-month to multi-year undertaking. The team should pick at most **two** to pursue in parallel, and only after the decision to pursue each is deliberate, funded, and aligned with the brand.

---

## 2. Initiative catalogue

### 2.1 Open protocol publication

**Summary**: Publish a versioned, implementation-independent specification of the beacon experience — source hierarchy, mixing contract, session lifecycle, consent framework — so that other organizations can build compatible clients, beacons, and research instruments.

**Why this fits the brand**: Decentralized science is real only if the platform is legibly a protocol, not a proprietary service. Publishing the spec is the most concrete way to make the "decentralized" word not cosmetic.

**What it requires**:

- A spec editor (role, not just a person) and a canonical repository.
- A versioning policy (semantic, with compatibility ranges).
- Reference implementations (clients, beacons) kept in sync.
- A governance model for spec evolution — at minimum a public RFC process.

**Dependencies**: Phase 3 produces the shape; formalization can begin any time after.

**Risks**:

- Protocol publication invites implementations we don't control. We lose some ability to shape UX; we gain ecosystem reach.
- A splinter implementation may emerge that uses the spec for purposes against the brand.

**Unlocks**: Constellation (§2.2), scholarly partnerships (§2.5), credibility for the Seal (§2.3).

**Rough shape**: 3–6 months to first published spec.

---

### 2.2 The Constellation

**Summary**: A framework for aligned communities, institutions, and organizations to run their own local beacons, each a node that federates with the canonical app. A Listener can discover and tune into any node in the Constellation. Each node is operated by its stewards, under a shared charter.

**Why this fits the brand**: The theory is about resonance at many scales. A single centralized beacon is a contradiction in frame. A Constellation makes the product shape-consistent with the idea.

**What it requires**:

- **Charter**: a short document of commitments a node's stewards agree to (brand rules, no-therapeutic-claims, moderation SLA, etc.). Public, versioned.
- **Technical**: a node registry, a federation protocol (nodes publish stream endpoints, metadata, sitting schedules; clients discover and select). Bundled with §2.1.
- **Governance**: a stewardship body — at minimum an advisory council — that adjudicates charter disputes and admits new nodes.
- **Branding**: a clear visual language for "Constellation node" in clients without letting third-party nodes impersonate the canonical beacon.
- **Legal**: charter-as-license (not open-source exactly, more like a trademark license); node operators accept by signing the charter.

**Dependencies**: Open protocol (§2.1) is a prerequisite. Phase 2 participation model gives us the operational experience to design governance.

**Risks**:

- A charter-breaking node becomes visible and requires revocation — a painful first-use of the governance mechanism. Plan for it.
- Free-rider nodes that benefit from the Constellation brand without contributing.
- Quality variance: a low-quality node degrades the overall experience.

**Unlocks**: Scale without centralizing. Community building. Longer-term sustainability.

**Rough shape**: 6–12 months from start (charter drafting, protocol extensions, first-cohort onboarding).

---

### 2.3 The Seal (Harmonically Aware Technology)

**Summary**: A certification mark awarded to devices, environments, systems, or experiences that meet defined criteria of Harmonic Awareness — not producing harmonic harm, respecting the ambient audio environment, supporting contemplative states.

**Why this fits the brand**: The public site frames this as an explicit long-horizon ambition: *"Harmonically Aware Technology can become a quality stamp that ensures no harmonic harm is produced by a device or technology."*

**What it requires**:

- **Criteria**: a public, evolving rubric of what "Harmonically Aware" means, operationalized. This is a research output as much as a product choice. Probably requires its own working group.
- **Audit methodology**: a reproducible measurement protocol that a third-party auditor can run on a device or environment.
- **Registry**: public directory of Sealed products, with version, audit date, and auditor.
- **Governance body**: an organization (Harmonic Beacon, a spun-off non-profit, or a consortium) that owns the mark and the process.
- **Legal**: trademark registration for the Seal, license terms for its use.
- **Business model**: certification fee, membership, or non-commercial — chosen once the mark's demand is known.

**Dependencies**: Requires research credibility that only Phase 3 can produce. Requires an independent governance body that Phase 4+ establishes. Not before we have visible evidence that our claims are held up by data.

**Risks**:

- **Credibility-collapse risk**: a Sealed product that turns out to produce harm retroactively invalidates the mark. Stricter-than-seems-necessary processes required from the start.
- **Governance capture**: the body running the mark gets captured by commercial interests. Structural remedies: non-profit, balanced board, public audits.
- **Time to value**: years, possibly a decade. The Seal is a generational contribution; don't over-promise milestones.

**Unlocks**: A place in the ambient-technology field that Harmonic Beacon currently only gestures at.

**Rough shape**: 18 months to first Sealed product in the best case, acknowledging high variance.

---

### 2.4 Scholarly partnerships

**Summary**: Co-authored research with named academic partners using the Harmonic Beacon data and protocol, published in peer-reviewed venues.

**Why this fits the brand**: Makes the "research instrument" claim concrete beyond our own readouts. Published academic work is a credibility currency Harmonic Beacon must eventually earn.

**What it requires**:

- **Named partner institution(s)**: Phase 1 outreach seeds this; Phase 3 produces data; Phase 4 operates it.
- **Data-use agreement**: standardized template governing partner access.
- **Co-authorship norms**: pre-agreed expectations on authorship, data ownership, publication rights.
- **Capacity to support**: a researcher contact within our team (even if part-time).

**Dependencies**: Phase 3 research readiness. Ongoing once begun.

**Risks**:

- Slow publication cycles (typical 1–2 years from submission to publication).
- A partner publishes results before we can communicate them to patrons/community.
- IP disputes over data or methods.

**Unlocks**: Institutional licensing demand. Press credibility. Seal credibility.

**Rough shape**: Continuous after Phase 3; first co-authored output likely 2+ years after enrollment begins.

---

### 2.5 Retreats and in-person events

**Summary**: Commercial and community events that bring the Harmonic Beacon frame into shared physical space — weekend retreats, one-day sittings, workshops co-hosted with aligned Providers.

**Why this fits the brand**: The brand's resonance vocabulary translates naturally into physical gathering. A retreat is a high-bandwidth, high-trust touchpoint with the community.

**What it requires**:

- Event production capability (venue, logistics, pricing, refunds).
- A Provider partnership model for co-hosting.
- Safety and liability coverage (insurance).
- Marketing and registration flow.
- Aftercare (optional check-in, journal integration for attendees).

**Dependencies**: Phase 2 community. Independent of technical roadmap; can start any time with a partner.

**Risks**:

- Event production is a different operational discipline than software.
- A single bad event has outsized reputational impact.
- Travel and accessibility inequities — a retreat excludes many community members.

**Unlocks**: Revenue diversification. Deeper Provider relationships. Rich narrative content for the platform.

**Rough shape**: First event ~3 months from decision to pursue, assuming an existing venue partner.

---

### 2.6 Hardware beacon

**Summary**: A physical device — small, quiet, low-power — that plays the beacon stream ambient-room style. Always on, unobtrusive. The instrument, as furniture.

**Why this fits the brand**: The theory is about ambient resonance. A hardware beacon is the physical manifestation of that claim.

**What it requires**:

- **Design partner**: an industrial designer and a manufacturing partner. Neither is a Harmonic Beacon team capability today.
- **Hardware spec**: microcontroller (likely ESP32-class), DAC, speaker, enclosure, power. Wi-Fi only at first; LTE/cellular is a second-generation question.
- **Firmware**: opens a new codebase, a new security surface, a new update pipeline.
- **Cost and margin model**: hardware is capex-heavy; revenue model probably includes both device sale and ongoing service linkage.
- **Distribution**: direct-to-consumer, retail, or partner.
- **Support**: physical products generate physical support needs.
- **Regulatory**: FCC/CE certifications, WEEE, packaging, safety.

**Dependencies**: Speculative; pursue only if demand is clearly there and a credible hardware partner relationship exists.

**Risks**:

- Hardware is a different business than software. Many hardware startups fail on execution, not demand.
- Support load on a small team.
- The device must feel worth its price, even next to a phone-based app that provides much of the same experience.

**Unlocks**: Brand presence in physical space. A giftable, showable artifact. Potential institutional sales angle (clinic, retreat center purchases in bulk).

**Rough shape**: 12–24 months from serious decision to first shipping units; highly partner-dependent.

---

### 2.7 Geographic expansion

**Summary**: Structured rollout in additional language and regulatory regions beyond EN/ES: Portuguese, French, German, Japanese, others.

**Why this fits the brand**: The beacon belongs to anyone who wants to listen. Language and cultural expansion is a direct extension of the mission, not a scaling growth tactic.

**What it requires per new language**:

- **Content partner**: at least one Provider creating aligned content in the language.
- **Translation**: UI strings, marketing site, legal pages, consent forms.
- **Moderation capacity**: a reviewer fluent in the language.
- **Compliance**: data-protection rules of the regions that speak it.

**Dependencies**: Phase 3 stable operations. i18n infrastructure from Phase 1.

**Risks**:

- Thin coverage: launching a language without sustained content produces a stale, half-there experience.
- Moderation capacity gap: a language without a fluent moderator is a safety risk.

**Unlocks**: Reach. Diverse community. Richer research cohort.

**Rough shape**: 2–3 months per language after infra is ready; gated on content partner availability.

---

## 3. Cross-cutting considerations for Phase 4+

### 3.1 Organizational form

The initiatives above, collectively, may outgrow the "a sub-project of AlterMundi" frame. Specifically:

- The Seal likely requires an independent governance body. Spinning out a foundation or consortium becomes a live question.
- Hardware and retreats imply operational disciplines (manufacturing, events) that are orthogonal to software.
- Scholarly partnerships benefit from non-profit status in many jurisdictions.

A possible future: Harmonic Beacon the product remains AlterMundi's, while a *Harmonic Information Theory Foundation* (or similar) owns the Seal, the open protocol governance, and institutional research agreements. This is not a decision to make prematurely, but it's a decision the team should be ready for.

### 3.2 Funding

Phase 4+ initiatives do not pay for themselves in the short term. Funding mix:

- Ongoing patronage (grows through Phases 2–3).
- Institutional licensing revenue (Phase 2+).
- Grant funding (continuous function).
- Potentially: a strategic partnership or donation commitment tied to specific Phase 4+ initiatives (e.g. a hardware partner underwrites the Seal governance body).

### 3.3 Team shape

Each Phase 4+ initiative implies expertise the core team may not have: hardware, events, spec stewardship, academic research administration. Staffing decisions follow the choice, not the other way around.

### 3.4 Saying no

The easiest phase to over-commit is the open-ended one. A useful discipline: at any time the team should be able to name **the two initiatives it has chosen** and be able to explain why the others are being deliberately deferred. The explanation becomes part of the public roadmap revision note.

---

## 4. What to decide at the Phase 3 → Phase 4+ boundary

A short list of questions whose answers determine the shape of Phase 4+:

1. Has the research track produced findings (positive, null, or negative) that the community is responding to?
2. Have at least three institutional partners run the protocol or its derivatives, with real data?
3. Is the patronage base large enough to sustain the operating team without a single failure point (e.g. one major patron)?
4. Is there visible demand from an aligned community for running their own beacon?
5. Has the product been stable enough in production to free up headspace for strategic initiatives?
6. Has the team identified a specific Phase 4+ initiative around which an aligned partner, funder, or opportunity has crystallized?

The answers shape the next public roadmap revision. If the answers are thin, the right choice is to run Phase 3+ as a permanent operating state and pick up Phase 4+ planning at the next review.

---

## 5. Closing note

Harmonic Beacon is conceived as a long-horizon instrument. The bias of Phase 4+ is not to rush toward any single ambition but to ensure that whatever we choose to build remains coherent with the frame we started with. A beacon that lasts a decade is a more interesting artifact than a beacon that tries to do everything and loses its voice. The initiatives here are offered in that spirit.
