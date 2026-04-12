# Product Principles

*Draft · 2026-04-12 · author: product design, pending validation*

These are the standing rules we hold ourselves to when designing, building, writing, and operating Harmonic Beacon. They sit below [VISION.md](./VISION.md) (which says *what* we are) and above [BUSINESS_RULES.md](../BUSINESS_RULES.md) (which says what the system must *enforce*). Principles resolve ambiguity when a concrete rule hasn't been written.

Twelve principles, in rough order of how often they bite.

## 1. The beacon is sacred infrastructure

The 24/7 beacon is the one feature we cannot compromise on. Before any new feature ships, ask: does this weaken the beacon? Does it steal its attention, cycles, or bandwidth? If so, the answer is no, or later.

The beacon has a public promise attached to it: *it never goes dark*. That promise binds engineering and operations as much as it binds marketing.

## 2. Presence over engagement

We do not optimize for time-on-app. We optimize for whether the listener came back calmer, more settled, more themselves. The closest proxy we have for that is *return rate over long horizons*, not session length. We measure accordingly.

No streaks, no badges, no gamified retention. The product should feel like a quiet room, not an arcade.

## 3. No dark patterns, ever

Any UX pattern that relies on manufactured scarcity, FOMO, manipulative defaults, guilt, or sunk-cost pressure is banned.

- Cancellation is one click, same number of screens as signup.
- Price is always visible before commitment.
- We do not use confirm-shaming copy ("No, I don't want to feel better").
- Push notifications are rare, informative, and never emotional.

If a proposed feature would be embarrassing to explain at a press interview, we don't ship it.

## 4. Research integrity before research velocity

The Analysis pillar is a promise we've made in public. It is also a legal and ethical surface. We will move slowly on research features rather than ship a consent flow that fails a post-hoc audit.

- Every survey starts with an informed-consent screen authored with an ethics review.
- Every data collection point has a data-minimization justification in writing.
- Participants can withdraw at any time and their data is either erased or de-identified per their choice.
- We preregister protocols before running them. When we can't, we say why publicly.

## 5. Precision in language

Copy is product. We write carefully.

- Therapeutic verbs (*heals*, *cures*, *treats*, *diagnoses*) are banned.
- Clinical-adjacent verbs (*reduces*, *improves*, *regulates*) require a citation or a hedging frame ("we hope to explore", "participants report").
- "Spiritual", "resonance", "coherence", "interference" are on-brand and precise — we use them.
- "Harmonic Beacon" and "the Beacon" are the canonical names. "The app" is acceptable in-product. "HB" is not a brand voice.

A doc or UI string that violates this deserves a lint failure, not just a reviewer comment. Eventually we will write that linter.

## 6. Trust is harder to rebuild than to build

Every time we touch security, privacy, moderation, billing, or research consent, we act on the assumption that a single mistake is retrospectively catastrophic.

- No shipping with known moderate-or-higher vulnerabilities.
- No logging PII to anywhere we can't purge.
- No shipping a payment feature without the cancel/refund path in the same PR.
- No collecting a new field on a user without updating Privacy and the consent copy.

## 7. Default to public

Research data, uptime numbers, aggregate listener counts, provider roster, moderation policy, incident postmortems — we publish them. The more opaque a brand about *how it works*, the less credible a claim of "decentralized science" it earns.

The exception is identifiable data, which is never public by default and often not by consent.

## 8. The stream has no owner

The live beacon is the product's spine. No single provider, no single backend, no single datacenter should be a single point of failure for continuity. Where the current architecture concentrates risk (one `beacon01`, one LiveKit SFU, one host), we call it out and plan its redundancy.

The analogous principle for content: no single provider accounts for more than a defined share of total listening, so that a single removal or dispute never threatens the experience.

## 9. Slow roads are fine

We are not a venture-timed business. We will sometimes choose approaches that are slower to build but sturdier to maintain, cheaper to operate, and more aligned with the brand.

- We prefer stable LTS dependencies over bleeding-edge ones.
- We prefer hand-sold institutional licensing in year one over a productized self-serve enterprise tier.
- We prefer audit-friendly boring infrastructure over novel stacks, for anything on the trust surface.

## 10. Accessibility is non-negotiable

WCAG 2.2 AA is the baseline, not the aspiration. The populations that most benefit from the beacon include neurodiverse, disabled, elderly, and non-technical users. A product whose claim is *harmonic attunement with the whole* that excludes anyone on grounds we could have fixed is a contradiction in terms.

## 11. Observability is a feature, not a backstage concern

You cannot keep a 24/7 promise you can't see. You cannot run research you can't audit. Before any new surface goes live, it has logs, metrics, and alerts proportional to its blast radius. Observability investment is not deferred past launch; it is launch.

## 12. Innovate cautiously, document generously

This product invites unusual ideas — synchronous sittings, resonance journals, harmonic seals, federated constellation nodes, hardware beacons. We allow ourselves these ideas. We also write them down *before* we build them, so the frame stays coherent as the product grows. Any substantial new concept earns a doc before it earns a PR.
