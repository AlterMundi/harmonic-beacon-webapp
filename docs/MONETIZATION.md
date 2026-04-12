# Monetization

*Draft · 2026-04-12 · author: product design, pending validation*

Authoritative rules live in [BUSINESS_RULES.md §5](../BUSINESS_RULES.md). This document is the detail: model, tiers, mechanics, edge cases, and the rationale behind them.

## Stance

Harmonic Beacon is monetized through **patronage and institutional licensing**, not through a paywall. The core listening experience is free forever; money flows into the product because people and organizations want the instrument to exist, not because they have been fenced out of it.

This is a deliberate choice, not a fallback. A Calm-style paywall would corrode the brand. A donation-only model would starve the infrastructure. The middle path — named patronage tiers with meaningful but non-essential benefits, optional pure donations, and institutional deals on the side — is what we build.

## The five revenue surfaces

We expect revenue to come from up to five stacked surfaces. Only the first two matter at launch.

1. **Patronage subscriptions** (Phase 2 launch). Monthly or annual, recurring, self-serve.
2. **One-time donations** (Phase 2 launch). Any amount, any time, no account required beyond email.
3. **Institutional licensing** (Phase 2 hand-sold, Phase 3 productized). Clinics, retreat centres, research institutions, schools.
4. **Grants and foundation support** (continuous). Not transactional; the grant-writing is a real function of the org.
5. **Harmonic Seal certification** (Phase 4+ speculative). A future certification mark for Harmonically Aware Technology applied to third-party devices, environments, or systems.

We do **not** monetize through: advertising, data resale, affiliate deals that compromise the brand, or NFTs/tokens.

## Patronage tiers

Tiers are named, not numbered. Naming carries weight in a brand that takes language seriously. Four tiers plus two pathways for people who don't fit the standard tier:

| Tier | Cadence | Suggested price (USD/mo) | Purpose |
|---|---|---|---|
| **Threshold** | Monthly | $2 | Named low-barrier tier for anyone the standard price excludes — students, unemployed, residents of lower-income countries. No eligibility check. Same benefits as Resonant. |
| **Resonant** | Monthly / Annual | $7 / $70 | The standard sustaining tier. |
| **Kindred** | Monthly / Annual | $15 / $150 | Supports more of the infrastructure. Adds private sittings hosting (up to 6 co-listeners). |
| **Hearth** | Annual only | $300 | The name-published-on-the-Hearth tier, optional recognition. |
| **Donation** | One-time | Any amount ≥ $1 | No subscription, no benefits beyond an acknowledgement email. |
| **Institution** | Annual | Contact sales | Hand-sold at launch. See §6 below. |

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

## Pricing mechanics

### Currency and geography

- Base prices are quoted in USD. At launch, local currency equivalents are offered for ARS, EUR, GBP, BRL, MXN. Prices are rounded to locally sensible increments, not directly converted.
- The Threshold tier is the policy lever that handles purchasing-power variance; we do not implement per-country pricing for Resonant/Kindred/Hearth.

### Trials

We do not run free trials. The Commons **is** the trial; a patron upgrades because they want to support the instrument, not to unlock what they were promised on signup.

### Cancellation

- One click, same screen count as signup.
- Benefits continue to the end of the paid period.
- No "winback" emails, no retention offers, no confirm-shaming copy.
- Reactivation is equally frictionless.

### Dunning

When a card fails:

1. Retry at day 1, day 3, day 7.
2. One email per retry, neutral tone ("Your card didn't charge; update here if you'd like to continue").
3. After three failures, subscription is paused; benefits revert to Commons. No account disabled, no content removed.
4. Reactivation on payment update, no backdating.

### Refunds

- Within 14 days of a new patronage or annual renewal: no-questions-refund via a self-serve flow.
- Beyond 14 days: pro-rated by request. No automated pro-ration for monthly patrons beyond that window.

### Gifts

- Annual patronage can be gifted at any tier. Gifts are a separate flow; the recipient can opt to continue as a patron or let the gift elapse without billing.

## Provider revenue share

Two pathways, Provider-selected at onboarding:

### Contribution model (default at launch)

- No payout.
- Provider's content counts toward Commons eligibility (selected by Admin curation).
- Provider retains attribution and all rights to their recordings.

### Revshare model

- Attributable revenue share pool = 50% of net patronage revenue (after payment processing fees and Harmonic Beacon's operating cut — published quarterly).
- Each month, the pool is distributed to revshare Providers in proportion to their share of total normalized listening time on revshare content that month.
- Normalization caps any single listener's contribution to prevent one super-listener dominating attribution.
- Minimum payout threshold: $50. Amounts below threshold roll forward.
- Payment via Stripe Connect Express. Providers provide tax information through Stripe; we do not touch it directly.
- Statements are provided to each revshare Provider monthly, showing hours listened, normalized share, and payout.

### Reshare accountability

- Every payout calculation is auditable from the `ListeningSession` ledger. A revshare Provider can request the calculation breakdown at any time.
- Disputes are handled in writing; resolution within 30 days.

## Institutional licensing

Institutional customers have different needs than Listeners: they embed Harmonic Beacon into a larger program (clinic protocol, retreat curriculum, research study, school wellness offering).

At launch, **hand-sold only.** No self-serve. This is a deliberate anti-scale decision; Phase 2 institutional contracts are co-designed with the customer and establish the product shape of Phase 3.

Expected deal structures:

- **Study license**: a research institution pays a fixed annual fee for up to N private user accounts under their institutional role, plus optional data-use agreement for their cohort data. Pricing in the low-to-mid four figures per study, annual.
- **Clinic license**: a clinic licenses access for their patient population, branded within permission limits. Pricing based on patient seats.
- **Retreat / event license**: short-duration, high-reliability licenses for in-person events, with dedicated capacity reservation on the beacon.

Contract terms are documented outside this repo.

## Grants and foundations

A standing function of the organization. A named person (Admin or founder) owns the grant pipeline. Candidate funders by theme:

- Contemplative science: Mind & Life Institute, Fetzer, John Templeton.
- Tech-for-good / open source: Sloan, Ford, Mozilla Foundation.
- Latin American tech-and-culture: local cultural funds, IDB innovation.
- EU wellness / digital health (where legally compatible).
- Institutional partners who want a research budget line.

Grant revenue is treated as restricted by default; ledger entries track grant-of-origin for any expense paid from restricted funds.

## The Seal (speculative, Phase 4+)

The long-horizon certification mark for *Harmonically Aware Technology*. Revenue model candidates — pick one at the time we seriously commission this:

- **Per-device certification fee** + annual re-audit.
- **Institutional membership** (device manufacturers join an organization that governs the Seal).
- **Non-commercial only** — a recognition mark with no revenue, supported by grants.

This is documented here only to note that monetization for the Seal is an open question, and the answer has to be consistent with the brand. Under no conditions does the Seal become a pay-to-play mark.

## Compliance scaffolding

Whatever monetization we ship runs on these scaffolds:

- **Billing provider**: Stripe at launch (Stripe Billing for subscriptions, Stripe Connect for Provider payouts, Stripe Tax for VAT/sales tax, Stripe Checkout for one-time donations).
- **Tax**: Stripe Tax computes and collects. We file where required. A tax advisor is engaged before the first payout-bearing month.
- **Receipts**: every charge generates a compliant receipt. Annual patrons receive a year-end summary for deductibility where applicable.
- **Legal entity**: payments flow through the designated AlterMundi entity; separate ledger for Harmonic Beacon within the parent org's accounts.
- **Currency risk**: unhedged at launch; visible in the monthly financial review.

## What a subscription upgrade feels like

The mechanics matter. The upgrade flow is:

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
- [ ] Admin audit log captures financial events.
