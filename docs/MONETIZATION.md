# Monetization

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet). A present-tense
> statement in this document is a claim about code that exists today; if you find
> one that is not, that is a bug in this document.
>
> **Founding Listener pre-release is implemented but real sales remain OFF.**
> The isolated Listener has a server-authoritative three-hour weekly Free quota
> and a recurring **USD 5/month Founding Listener** offer. PayPal Sandbox and
> Mercado Pago TEST have completed supervised checkout and lifecycle acceptance;
> production provider credentials, Live flags and public checkout stay disabled
> until the commercial release gates are approved. The broader patronage tiers,
> donations, provider payouts and institutional mechanics below remain draft
> Phase 2 proposals; they must not be confused with the Founding Listener launch
> candidate.

*Draft · 2026-04-12 · author: product design, pending validation*

Authoritative rules live in [BUSINESS_RULES.md §5](../BUSINESS_RULES.md). This document is the detail: model, tiers, mechanics, edge cases, and the rationale behind them.

## Stance

Harmonic Beacon is being monetized first through **Founding Listener membership**, then potentially through the broader patronage and institutional model described below. Registered Free listeners receive a recurring weekly allowance; Founding Listeners receive unrestricted access while their USD 5 monthly service remains uninterrupted. Free For All can still open access temporarily without creating membership or payment state.

This is a deliberate choice, not a fallback. A Calm-style paywall would corrode the brand. A donation-only model would starve the infrastructure. The middle path — named patronage tiers with meaningful but non-essential benefits, optional pure donations, and institutional deals on the side — is what we will build.

## The five revenue surfaces

We expect revenue to come from up to five stacked surfaces. Only the first two matter at launch.

1. **Patronage subscriptions** (Phase 2 launch). Monthly or annual, recurring, self-serve.
2. **One-time donations** (Phase 2 launch). Any amount, any time, no account required beyond email.
3. **Institutional licensing** (Phase 2 hand-sold, Phase 3 productized). Clinics, retreat centres, research institutions, schools.
4. **Grants and foundation support** (continuous). Not transactional; grant-writing is meant to be a standing function of the org rather than a side task, and it needs an owner before it is one.
5. **Harmonic Seal certification** (Phase 4+ speculative). A future certification mark for Harmonically Aware Technology applied to third-party devices, environments, or systems.

We do **not** monetize through advertising, data resale, affiliate deals that compromise the brand, or NFTs/tokens. That refusal remains a standing rule as payment capability moves from sandbox acceptance toward an explicitly approved launch.

## Patronage tiers

Tiers will be named, not numbered. Naming carries weight in a brand that takes language seriously. Four tiers plus two pathways for people who don't fit the standard tier:

| Tier | Cadence | Suggested price (USD/mo) | Purpose |
|---|---|---|---|
| **Threshold** | Monthly | $2 | Named low-barrier tier for anyone the standard price excludes — students, unemployed, residents of lower-income countries. No eligibility check. Same benefits as Resonant. |
| **Resonant** | Monthly / Annual | $7 / $70 | The standard sustaining tier. |
| **Kindred** | Monthly / Annual | $15 / $150 | Supports more of the infrastructure. Adds hosting a **private** sitting for a small circle (up to 6 co-listeners — a tier benefit, not a platform limit; public sittings are capped separately and much higher). |
| **Hearth** | Annual only | $300 | The name-published-on-the-Hearth tier, optional recognition. |
| **Donation** | One-time | Any amount ≥ $1 | No subscription, no benefits beyond an acknowledgement email. |
| **Institution** | Annual | Contact sales | Hand-sold at launch. See *Institutional licensing* below. |

No tier exists as a record, a price or a checkout. The table is the intended shape of the offer, not a published price list: the figures are targets, and they become quasi-contractual only when they appear on a public pricing page. **[Planned — Phase 2]**

### Tier benefits discipline

Every tier benefit passes this test: does it add convenience or recognition without removing anything from Listeners who don't pay? If the answer is no, it doesn't ship.

| Benefit | Threshold / Resonant / Kindred / Hearth |
|---|---|
| Live beacon | All Listeners (not a benefit) |
| Commons meditations (~15 rotating) | All Listeners (not a benefit) |
| Full catalogue on-demand | ✓ |
| Download-for-offline | ✓ |
| Early access to experimental overlays | ✓ |
| Early access to new research readouts | ✓ |
| Private sittings host | Kindred + Hearth |
| Listed on Hearth page (optional, opt-in) | Hearth |
| Early invitations to in-person events | Hearth |
| Annual printed retrospective (where applicable) | Hearth |

Every entitlement in the right-hand column is unbuilt, and two of them need a
capability the client does not have: download-for-offline has no implementation
at all — audio is streamed over HTTP with Range requests and nothing is stored
for later — and private sittings depend on the sittings feature in
[BUSINESS_RULES.md §7.2](../BUSINESS_RULES.md), which is itself Phase 2.
**[Planned — Phase 2]**

**Benefits we will not offer:**

- Priority in any queue that affects another Listener's experience.
- Feature voting or influence over moderation decisions.
- Lower ad load (no ads to begin with).
- Any form of status badge visible to other Listeners beyond the opt-in Hearth listing.

## The Commons

Free-tier content must feel generous, not lean. We commit to a Commons of at least:

- The live beacon at full quality, always.
- **15 published meditations** rotating monthly across the top languages, spanning the `MOOD`, `TECHNIQUE`, and `DURATION` tag categories.
- Access to all scheduled public sittings (Phase 2).
- All research readouts, always public.

A patron does not receive a "better" experience; they receive a *wider* one.

> **The floor has no mechanism.** Nothing counts published meditations against
> the minimum, nothing rotates them, and pre-patronage there is no free/patron
> distinction to apply it to — everything published is available to everyone,
> which exceeds the commitment while leaving it unenforced. The floor only starts
> to bind on the day patronage ships, which is the day it becomes possible to
> breach silently: a curator who lets the published count or the tag spread drop
> is breaking a published promise with nothing to tell them. It needs an actual
> guard when patronage lands — an Admin dashboard warning below the threshold is
> enough. **[Planned — Phase 2]**

## Pricing mechanics

### Currency and geography

- Base prices will be quoted in USD. At launch, local currency equivalents will be offered for ARS, EUR, GBP, BRL, MXN. Prices will be rounded to locally sensible increments, not directly converted.
- The Threshold tier is the policy lever that handles purchasing-power variance; we will not implement per-country pricing for Resonant/Kindred/Hearth.

Quoting EUR and GBP is a decision, not a formatting choice: it puts EU and UK consumers in scope, and with them VAT registration, consumer-cancellation rules, and the notice-and-action questions flagged in [CONTENT_POLICY.md §6.2](./CONTENT_POLICY.md). Worth making deliberately rather than by pricing table.

### Trials

We will not run free trials. The Commons **is** the trial; a patron upgrades because they want to support the instrument, not to unlock what they were promised on signup.

### Cancellation

- One click, same screen count as signup.
- Benefits continue to the end of the paid period.
- No "winback" emails, no retention offers, no confirm-shaming copy.
- Reactivation equally frictionless.

### Dunning

When a card fails:

1. Retry at day 1, day 3, day 7.
2. One email per retry, neutral tone ("Your card didn't charge; update here if you'd like to continue").
3. After three failures, the subscription is paused and benefits revert to Commons. No account disabled, no content removed.
4. Reactivation on payment update, no backdating.

### Refunds

- Within 14 days of a new patronage or annual renewal: no-questions-refund via a self-serve flow.
- Beyond 14 days: pro-rated by request. No automated pro-ration for monthly patrons beyond that window.

### Gifts

- Annual patronage will be giftable at any tier. Gifts are a separate flow; the recipient can opt to continue as a patron or let the gift elapse without billing.

The cancellation, dunning, refund and gift rules above are the contract each flow will be built to. None of the flows exists — there is nothing to cancel, no card to fail, and no charge to refund. **[Planned — Phase 2]**

## Provider revenue share

Two pathways, Provider-selected at onboarding:

Neither pathway is selectable. There is no onboarding flow that asks, no field that records the answer, and no payout machinery behind either branch. **[Planned — Phase 2]**

### Contribution model (default at launch)

- No payout.
- Provider's content counts toward Commons eligibility (selected by Admin curation).
- Provider retains attribution and all rights to their recordings, on terms the Provider Content Agreement has yet to fix — see [CONTENT_POLICY.md §7](./CONTENT_POLICY.md).

### Revshare model

- A defined share of net patronage revenue will fund a monthly Provider pool. The share and the base it is computed on are unresolved — see below.
- Each month, the pool will be distributed to revshare Providers in proportion to their share of total normalized listening time on revshare content that month.
- Normalization will cap any single listener's contribution to prevent one super-listener dominating attribution.
- Minimum payout threshold: $50. Amounts below threshold roll forward.
- Payment via Stripe Connect Express. Providers will supply tax information through Stripe; we do not touch it directly.
- Statements will go to each revshare Provider monthly, showing hours listened, normalized share, and payout.

> **Unresolved — do not quote a percentage to a Provider.** This document and
> [BUSINESS_RULES.md §5.4](../BUSINESS_RULES.md) described two materially
> different models under one headline number: a per-provider share of the revenue
> attributable to that provider, versus a common pool computed after payment
> processing fees *and* a platform operating cut, split pro-rata by listening
> time. The second can be an arbitrarily smaller amount than the first, and
> presenting both as the same figure is the kind of statement a provider dispute
> or a payments regulator characterizes as misleading. The number has been removed
> from both documents rather than restated in one of them.
>
> One model has to be chosen and "net" defined exhaustively before any figure is
> published again: which fees are deducted and in what order, what the operating
> cut covers, who sets it, how often it can change and with what notice, and where
> it is published so a Provider can check the arithmetic against their own
> statement. Both documents are then rewritten from that single definition.

### Reshare accountability

- Every payout calculation will be auditable from the `ListeningSession` ledger. A revshare Provider will be able to request the calculation breakdown at any time.
- Disputes will be handled in writing; resolution within 30 days.

> The ledger is now trustworthy enough to compute from, which it was not when
> this section was written. `completed` is derived server-side from the elapsed
> time the server itself measured against the meditation's probed duration
> ([BUSINESS_RULES.md §2.3](../BUSINESS_RULES.md)); the client no longer asserts
> it and the server no longer stores what the client said. Durations are read
> from the file at upload rather than stored as `0`.
>
> Two gaps remain before money can rest on it. A meditation whose duration never
> probed successfully still carries `0`, and those rows fall back to a flat
> seconds threshold rather than a fraction of the track — a payout formula has to
> decide whether such a listen attributes at all, rather than inheriting the
> fallback silently. And nothing yet normalizes per-listener contribution, which
> is the cap this section promises above. **[Planned — Phase 2]**

## Institutional licensing

Institutional customers have different needs than Listeners: they embed Harmonic Beacon into a larger program (clinic protocol, retreat curriculum, research study, school wellness offering).

At launch, **hand-sold only.** No self-serve. This is a deliberate anti-scale decision; Phase 2 institutional contracts will be co-designed with the customer and establish the product shape of Phase 3. No institution has been sold anything, and the INSTITUTION role that would scope a customer's Listeners is one of the future roles in [BUSINESS_RULES.md §1.4](../BUSINESS_RULES.md), not a value in `UserRole`. **[Planned — Phase 2]**

Expected deal structures:

- **Study license**: a research institution pays a fixed annual fee for up to N private user accounts under their institutional role, plus optional data-use agreement for their cohort data. Pricing in the low-to-mid four figures per study, annual.
- **Clinic license**: a clinic licenses access for their patient population, branded within permission limits. Pricing based on patient seats.
- **Retreat / event license**: short-duration, high-reliability licenses for in-person events, with dedicated capacity reservation on the beacon.

Contract terms will be documented outside this repo. None has been drafted, and like the Provider Content Agreement they wait on the counsel-engagement thread in [README.md](./README.md#open-threads).

## Grants and foundations

A standing function of the organization. A named person (Admin or founder) will own the grant pipeline; nobody is named yet. Candidate funders by theme:

- Contemplative science: Mind & Life Institute, Fetzer, John Templeton.
- Tech-for-good / open source: Sloan, Ford, Mozilla Foundation.
- Latin American tech-and-culture: local cultural funds, IDB innovation.
- EU wellness / digital health (where legally compatible).
- Institutional partners who want a research budget line.

> *The organizations named above are candidates we may approach. No affiliation,
> partnership or endorsement is implied, and none has any stated relationship
> with this project.* Foundations are particularly sensitive to being named in
> fundraising-adjacent material, so if this list ever outgrows a disclaimer it
> belongs in the issue tracker rather than in a published document.

Grant revenue will be treated as restricted by default, with ledger entries tracking grant-of-origin for any expense paid from restricted funds. There is no such ledger; the accounting side of this is as unbuilt as the payment side. **[Planned — Phase 2]**

## The Seal (speculative, Phase 4+)

The long-horizon certification mark for *Harmonically Aware Technology*. Nothing is scoped, committed or scheduled; this is directional. **[Aspiration]** Revenue model candidates — pick one at the time we seriously commission this:

- **Per-device certification fee** + annual re-audit.
- **Institutional membership** (device manufacturers join an organization that governs the Seal).
- **Non-commercial only** — a recognition mark with no revenue, supported by grants.

This is documented here only to note that monetization for the Seal is an open question, and the answer has to be consistent with the brand. Under no conditions does the Seal become a pay-to-play mark.

## Compliance scaffolding

Whatever monetization we ship will run on these scaffolds. None of them is in place — Stripe is not integrated, no tax advisor has been engaged, and no ledger separates Harmonic Beacon within the parent org's accounts. **[Planned — Phase 2]**

- **Billing provider**: Stripe at launch (Stripe Billing for subscriptions, Stripe Connect for Provider payouts, Stripe Tax for VAT/sales tax, Stripe Checkout for one-time donations).
- **Tax**: Stripe Tax computes and collects. We file where required. A tax advisor is engaged before the first payout-bearing month — it is an open thread in [README.md](./README.md#open-threads) and it gates the phase, because the currencies quoted above decide which registrations we need.
- **Receipts**: every charge generates a compliant receipt. Annual patrons receive a year-end summary of what they contributed.
- **Legal entity**: payments flow through the designated AlterMundi entity; separate ledger for Harmonic Beacon within the parent org's accounts.
- **Currency risk**: unhedged at launch; visible in the monthly financial review.

> **A contribution summary is not a tax document.** Patronage is not a charitable
> donation and is not deductible unless the receiving entity holds a status that
> makes it so in the patron's own jurisdiction — which, for a non-charitable
> entity in the launch geographies, it generally does not. Whether any such status
> applies is a question for the tax advisor above, answered per jurisdiction and
> in writing. Until that answer exists, no patronage surface, receipt or year-end
> summary implies deductibility, and copy that hedges with "where applicable"
> counts as implying it.

## What a subscription upgrade feels like

The mechanics matter. The upgrade flow will be:

1. A patron clicks *Support the beacon*.
2. Four tiers, one donation option, clearly labelled with what's included and an honest "this doesn't block anything — all benefits are conveniences" line of copy above the tier cards.
3. One screen of payment.
4. Thank-you screen that matches the brand voice — a short paragraph about what the patronage supports, no confetti, no animation, no gamified celebration.
5. An email receipt with the same tone.

The patron should feel like a steward of something meaningful, not a buyer of a product.

## Checkpoints for monetization decisions

Before shipping any monetization surface, confirm:

- [ ] Core experience is still free at the quality a Listener would have had without the feature.
- [ ] Benefit added is a convenience, not a restoration of what we took away.
- [ ] Cancellation path is designed and tested.
- [ ] Copy is audited — no scarcity, no guilt, no flattery.
- [ ] Privacy implications of any new data (e.g. billing address) are reflected in the consent copy.
- [ ] Tax handling for the surface is in place.
- [ ] Admin audit log captures financial events. The audit log now exists ([BUSINESS_RULES.md §1.3](../BUSINESS_RULES.md)) and records administrative writes, so what remains for this checkbox is emitting entries from the financial surfaces themselves — which have not been built. The mechanism is ready; there are no financial events to capture yet. **[Planned — Phase 1]**
