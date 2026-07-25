# Product Principles

> **Status: Draft — pending validation.** Nothing here is ratified. These are
> standing rules, so most of what follows is normative by nature — "we do not
> optimize for time-on-app" is a commitment, not a report, and reads correctly in
> the present tense. Where a principle instead asserts that something *is already
> the case* in the product, that is a claim about code that exists today; where
> such a claim is not yet true it is written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet).
>
> The distinction matters most in §5, because a document that bans unhedged
> claims and then makes one is the strongest available argument that the rule is
> decorative. The audit found exactly that, in §10. It is fixed below and kept as
> the worked example.

*Draft · 2026-04-12 · author: product design, pending validation*

These are the standing rules we hold ourselves to when designing, building, writing, and operating Harmonic Beacon. They sit below [VISION.md](./VISION.md) (which says *what* we are) and above [BUSINESS_RULES.md](../BUSINESS_RULES.md) (which says what the system must *enforce*). Principles resolve ambiguity when a concrete rule hasn't been written.

Twelve principles, in rough order of how often they bite.

## 1. The beacon is sacred infrastructure

The 24/7 beacon is the one feature we cannot compromise on. Before any new feature ships, ask: does this weaken the beacon? Does it steal its attention, cycles, or bandwidth? If so, the answer is no, or later.

The beacon has a public promise attached to it: *it never goes dark*. That promise binds engineering and operations as much as it binds marketing.

## 2. Presence over engagement

We do not optimize for time-on-app. We optimize for whether the listener came back calmer, more settled, more themselves. The closest proxy we have for that is *return rate over long horizons*, not session length. We will measure accordingly — today nothing computes a return rate, and the `ListeningSession` ledger it would be computed from is not yet trustworthy (see [BUSINESS_RULES.md §2.3](../BUSINESS_RULES.md)). **[Planned — Phase 1]**

No streaks, no badges, no gamified retention. The product should feel like a quiet room, not an arcade.

## 3. No dark patterns, ever

Any UX pattern that relies on manufactured scarcity, FOMO, manipulative defaults, guilt, or sunk-cost pressure is banned.

- Cancellation will be one click, same number of screens as signup. **[Planned — Phase 2]**
- Price will always be visible before commitment. **[Planned — Phase 2]**
- We do not use confirm-shaming copy ("No, I don't want to feel better").
- Push notifications will be rare, informative, and never emotional. **[Planned — Phase 3]**

The first two and the last describe surfaces that do not exist — there is no payment flow, no price, and no notification channel. They are written down now because the cheapest time to bind a dark-pattern rule is before the surface that would tempt it. The third holds today, being a rule about copy we already write.

If a proposed feature would be embarrassing to explain at a press interview, we don't ship it.

## 4. Research integrity before research velocity

The Analysis pillar is a promise we've made in public. It is also a legal and ethical surface. We will move slowly on research features rather than ship a consent flow that fails a post-hoc audit.

- Every survey will start with an informed-consent screen authored with an ethics review.
- Every data collection point will have a data-minimization justification in writing.
- Participants will be able to withdraw at any time, with their data either erased or de-identified per their choice.
- We will preregister protocols before running them. When we can't, we will say why publicly.

No survey is administered today and no research data is collected, so the four rules above have nothing running to govern yet. **[Planned — Phase 3]** That is the comfortable version of this principle. The uncomfortable version, which the audit found, is that the public site says otherwise — and the honesty rule in §5 applies to claims about our research at least as strictly as to claims about its results. Moving slowly on research features only counts as integrity if the copy moves at the same speed, which means correcting that copy is not Phase 3 work waiting on the surface; it is work owed now. **[Planned — Phase 1]**

The instruments under consideration produce health data, which is special-category under GDPR Art. 9 and sensitive under Argentina's Ley 25.326. That makes the consent flow a legal artifact and not only an ethical one; the analysis is in [RESEARCH_PROTOCOL.md §4.5](./RESEARCH_PROTOCOL.md) and it gates the phase.

## 5. Precision in language

Copy is product. We write carefully.

- Therapeutic verbs (*heals*, *cures*, *treats*, *diagnoses*) are banned.
- Clinical-adjacent verbs (*reduces*, *improves*, *regulates*) require a citation or a hedging frame ("we hope to explore", "participants report").
- "Spiritual", "resonance", "coherence", "interference" are on-brand and precise — we use them.
- "Harmonic Beacon" and "the Beacon" are the canonical names. "The app" is acceptable in-product. "HB" is not a brand voice.

A doc or UI string that violates this deserves a lint failure, not just a reviewer comment. We will write that linter. **[Planned — unscheduled]** Its first test case is §10 below, where this rule was broken by this document — the banned pattern is not "a word we dislike" but an efficacy claim about a named population with nothing to cite, and a linter that cannot catch that one is not worth writing.

## 6. Trust is harder to rebuild than to build

Every time we touch security, privacy, moderation, billing, or research consent, we act on the assumption that a single mistake is retrospectively catastrophic.

- No shipping with known moderate-or-higher vulnerabilities.
- No logging PII to anywhere we can't purge. *This one is enforced, not just stated:* `src/lib/redact.ts` strips credentials and presigned-URL signatures before anything reaches a log, and `src/lib/__tests__/no-pii-in-logs.test.ts` scans every `console.*` call in `src/` for personal-data accessors and fails the build on a match. The motivating regression was real — the app logged a user's email on every JWT sync — and the test exists so it cannot come back. A principle with a test behind it is a different kind of object from a principle without one, and the rest of this list is the second kind.
- No shipping a payment feature without the cancel/refund path in the same PR. No payment feature exists yet, so this rule has not been tested against anything.
- No collecting a new field on a user without updating Privacy and the consent copy.

## 7. Default to public

Research data, uptime numbers, aggregate listener counts, provider roster, moderation policy, incident postmortems — we will publish them. Moderation policy is the one item on that list we have actually written down ([CONTENT_POLICY.md](./CONTENT_POLICY.md), in draft). The other five are not published anywhere: no status page, no public metrics, no provider directory, no research readout, no postmortem — and the counts that do exist sit behind an admin-only endpoint. **[Planned — Phase 1]**

Publishing a number requires measuring it first, which is §11's job and is why the two principles move together.

The exception is identifiable data, which is never public by default and often not by consent.

## 8. The stream has no owner

The live beacon is the product's spine. No single provider, no single backend, no single datacenter should be a single point of failure for continuity. Where the current architecture concentrates risk, we call it out and plan its redundancy.

Calling it out, then: the architecture today is one `beacon01` source identity, one LiveKit SFU, one go2rtc, one Postgres and one host, with a playlist bot as the only fallback. Every one of those is a single point of failure, and the warm-standby upstream that would break the first of them is scheduled, not built (see [SLO.md](./SLO.md) and [BUSINESS_RULES.md §8.1](../BUSINESS_RULES.md)). This principle currently describes an intention and an accurate inventory of the gap between it and the deployment. **[Planned — Phase 1]**

The analogous principle for content: no single provider should account for more than a defined share of total listening, so that a single removal or dispute never threatens the experience.

> **Unresolved:** that share has never been defined, and nothing measures
> provider concentration. A rule stated as a threshold with no number and no
> measurement cannot be breached, which means it also cannot be relied on. Either
> a number is chosen and instrumented, or the sentence should say plainly that
> concentration is a risk we watch by judgment.

## 9. Slow roads are fine

We are not a venture-timed business. We will sometimes choose approaches that are slower to build but sturdier to maintain, cheaper to operate, and more aligned with the brand.

- We prefer stable LTS dependencies over bleeding-edge ones.
- We prefer hand-sold institutional licensing in year one over a productized self-serve enterprise tier.
- We prefer audit-friendly boring infrastructure over novel stacks, for anything on the trust surface.

The infrastructure half of that holds. The platform runs on self-hosted Postgres, LiveKit and go2rtc on hosts we operate, with Zitadel for identity — boring, inspectable, and portable, which is most of what the third bullet asks for.

The dependency half does not, and this is worth stating rather than leaving for a reader to notice from `package.json`. The application tracks the current major of nearly everything: Next.js 16, React 19, Prisma 7, Tailwind 4. Most of that is ordinary cost. One item is not: authentication runs on a `5.0.0-beta` release of NextAuth, which puts a pre-release dependency directly on the trust surface the third bullet is about.

> **Unresolved:** whether that is accepted or fixed. It is a real decision with a
> real cost either way — there is no stable v5 to move to, and moving back is its
> own migration — so the useful outcome is a recorded choice with a trigger
> ("adopt the stable release within N weeks of publication"), not a silent
> divergence between the principle and the lockfile. Until it is recorded, the
> first bullet above should be read as the preference it states and not as a
> description of the dependency tree.

## 10. Accessibility is non-negotiable

WCAG 2.2 AA is the target, not the aspiration. The product is not measured against it today and no audit has been run, so this is a standard we have adopted rather than one we have met. **[Planned — Phase 1]**

The populations the beacon must not exclude include neurodiverse, disabled, elderly, and non-technical users. A product whose claim is *harmonic attunement with the whole* that excludes anyone on grounds we could have fixed is a contradiction in terms.

That sentence used to read "the populations that most benefit from the beacon include…", and the 2026-06-09 audit ([LEGAL_AUDIT.md L12](./audit/LEGAL_AUDIT.md)) was right to pull it out. "Most benefit" is an unhedged efficacy claim about clinically defined groups — the precise thing §5 bans — sitting in the document that bans it. It is a small sentence and it is the one a journalist would quote, because it is the available evidence that the discipline is aimed at marketing copy and not at ourselves.

Note what the fix is, because it generalizes: not a hedge, a reframe. What we owe these listeners is access, which we can deliver and be held to. What the beacon *does* for them is a research question ([RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md)), and we have no finding to cite. Where a claim cannot be supported, softening it is usually the wrong repair — the right one is to say the thing we can stand behind instead.

This is the first test case for the linter in §5.

## 11. Observability is a feature, not a backstage concern

You cannot keep a 24/7 promise you can't see. You cannot run research you can't audit. Before any new surface goes live, it will have logs, metrics, and alerts proportional to its blast radius. Observability investment is not deferred past launch; it is launch. **[Planned — Phase 1]**

Today there is none of it. No error tracking, no metrics, no traces, no external uptime monitor, no alerting — the codebase has container healthchecks, a liveness probe, and ad-hoc `console` calls. This is the principle with the widest gap between statement and practice, and it is load-bearing for two others: §7 cannot publish numbers nobody measures, and §1's promise that the beacon never goes dark is currently a promise we would learn we had broken from a listener rather than from a page.

## 12. Innovate cautiously, document generously

This product invites unusual ideas — synchronous sittings, resonance journals, harmonic seals, federated constellation nodes, hardware beacons. We allow ourselves these ideas. We also write them down *before* we build them, so the frame stays coherent as the product grows. Any substantial new concept earns a doc before it earns a PR.
