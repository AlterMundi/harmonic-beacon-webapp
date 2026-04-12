# Phase 2 — Participation

*Draft · 2026-04-12 · author: product design, pending validation*

**Duration**: ~8 weeks
**North star**: *people can support the work, and Providers can contribute without drama.*

Phase 2 turns a credible product into a sustainable one. Two surfaces come online: patronage (money in from Listeners and institutions) and structured Provider participation (content in, with proper rails around it). A third, smaller surface — Sittings — is the community affordance that fits between the two.

By the end of Phase 2, the platform takes recurring money, pays Providers, reviews new content on a clear workflow, and offers shared listening at defined times. It remains audited, observable, and legally clean.

---

## 1. Scope of the phase

Five workstreams.

1. **Patronage** — Stripe Billing for subscriptions, Stripe Checkout for donations, entitlement model, tier benefits, Hearth page, cancellation flow, dunning.
2. **Provider economy** — Provider application flow, Content Agreement, onboarding, revshare plumbing (Stripe Connect Express), monthly payout job, Provider dashboard for earnings.
3. **Moderation and reporting at scale** — review queue UI, report triage tooling, Steward role (implemented but cautiously issued), appeals flow, policy metrics in the audit log.
4. **Sittings & Resonance Journal** — scheduled synchronous listening with co-listener presence, no host; per-session private notes (Journal MVP).
5. **Email, growth, and institutional** — transactional email for receipts / welcome / reports; first lifecycle email; institutional collateral and first pilot conversation.

---

## 2. Deliverables by workstream

### 2.1 Patronage

- [ ] Stripe Billing configured for Resonant, Kindred monthly/annual; Hearth annual only; Threshold monthly (same price for all geographies, see [MONETIZATION.md](../MONETIZATION.md))
- [ ] Stripe Tax enabled; VAT collection live for EU/UK; sales tax per US state where required
- [ ] Stripe Checkout for one-time donations (any amount ≥ $1)
- [ ] Entitlement model in Prisma: `Patronage { userId, tier, status, currentPeriodEnd, stripeCustomerId, stripeSubscriptionId, ... }`
- [ ] Webhook handler for Stripe events with idempotency and audit logging
- [ ] Patron-only benefits wired into content delivery:
  - Full catalogue on-demand (signed-URL based on entitlement)
  - Download-for-offline (Phase 3 ties this to mobile; web-download in Phase 2)
  - Early access: a separate `earlyAccess` flag on meditations, visible only to patrons
- [ ] Cancellation flow: one-click, no retention offers, acknowledgement email in brand voice
- [ ] Dunning: retry at day 1/3/7, pause on third failure, no account lockout
- [ ] Refund flow: 14-day no-questions-refund endpoint, exposed in the patron's account page
- [ ] Hearth page at `/hearth`: patrons at Hearth tier can opt to display name; rendered server-side, static-cached with 1h TTL; alphabetical or chronological, patron's choice
- [ ] Annual year-end summary email with total patronage contribution (for tax-deductibility where applicable)
- [ ] Gift flow: purchase annual patronage for another email address; recipient redeems with one click

### 2.2 Provider economy

- [ ] Public "Become a Provider" page with application form
- [ ] Application data model: `ProviderApplication { email, name, practiceType, experience, links, statement, status, submittedAt, reviewedBy, decidedAt, reason }`
- [ ] Admin review queue for applications; decisions tracked in audit log
- [ ] Provider onboarding flow (post-acceptance):
  - Agree to Provider Content Agreement (signed click-through, versioned, auditable)
  - Select economic model: Contribution (no payout) or Revshare
  - If Revshare: Stripe Connect Express onboarding (KYC, tax info, payout method handled by Stripe)
  - First-content guidance
- [ ] Revshare engine:
  - Monthly job computes attributable revenue pool
  - Distributes by normalized listening time on revshare content
  - Per-listener normalization cap (ceiling on any single listener's contribution to prevent distortion)
  - Emits `PayoutStatement { providerId, period, grossListens, normalizedShare, amount, currency }`
  - Triggers Stripe Connect transfers above the minimum-payout threshold ($50), rolls forward below
- [ ] Provider dashboard:
  - Current content status (approved, pending, rejected, hidden)
  - Submit new content
  - Monthly statements with breakdown
  - Profile editor
  - Scheduled sessions management
- [ ] Provider self-service offboarding / retirement

### 2.3 Moderation and reporting at scale

- [ ] Moderation queue UI for Admin and Steward: list pending, filter by Provider / tag / submission age, one-click open for review
- [ ] Review form with checklist from [CONTENT_POLICY.md §4.4](../CONTENT_POLICY.md) and mandatory rule-citation on reject
- [ ] Two-reviewer flow for first-submission Providers: second reviewer blocks until first concurs or overrides
- [ ] Appeal endpoint: Provider submits written appeal, routed to an Admin not involved in original decision
- [ ] Report triage UI: aggregated reports per content/session/provider, with SLA indicators
- [ ] Steward role implemented in Zitadel and middleware (`BEAC_STEWARD`); capabilities = Admin-minus-finance-minus-takedown, can apply `isHidden=true` as a temporary hold but cannot permanently delete
- [ ] Steward issuance cautious at launch (1–2 trusted community members)
- [ ] Audit-log reports dashboard: takedowns by reason this month, report-to-acknowledgement latency, review-to-decision latency, appeals outcomes

### 2.4 Sittings & Resonance Journal

- [ ] `Sitting` model: scheduled synchronous listening event, no host
  - Fields: `scheduledAt`, `durationSeconds`, `overlayMeditationId?`, `capacity?`, `visibility` (public | patron-only | private)
  - Public sittings are in the Commons; patron-only can be hosted by Kindred+ patrons (small groups)
  - Private sittings are invite-only
- [ ] Sittings UI: upcoming schedule, join button, silent co-presence count during the sitting
- [ ] No chat, no comments, no hand-raising — by design; see [VISION.md](../VISION.md) re: no social virality
- [ ] Sitting lifecycle emits `ListeningSession` records tied to the sitting
- [ ] Calendar integration: sitting times as `.ics` feed; per-user reminders (one-time, opt-in, not recurring nagging)
- [ ] Resonance Journal MVP:
  - Data model: `JournalEntry { userId, sessionId?, createdAt, encryptedBody, moodBefore?, moodAfter?, tags? }`
  - Body encrypted at rest with a key derived from the user's secret (so even Admin cannot read it)
  - Per-entry mood-score fields are plaintext (but scoped to Listener)
  - UI: write a short note after any session or any time; list entries by date
  - Export included in user data export
- [ ] Research wiring is explicitly deferred to Phase 3; no research-side consumption of Journal data at this phase

### 2.5 Email, growth, and institutional

- [ ] Transactional email provider wired (Resend or Postmark)
- [ ] Transactional emails in EN/ES:
  - Welcome (on signup)
  - Patron thank-you (on first patronage, renewal annual, cancel acknowledgement)
  - Receipt (on charge)
  - Year-end summary (Hearth + Kindred annual)
  - Report acknowledgement
  - Moderation decision to Provider
  - Provider monthly payout statement
- [ ] Lifecycle email foundations:
  - A welcome sequence (3 emails over 14 days): what the beacon is, how to use the mix, invitation to the research protocol (deferred to Phase 3 content)
  - No other lifecycle email in Phase 2 (no re-engagement, no churn-save)
- [ ] Email preferences page: per-category opt-out (transactional cannot be disabled; lifecycle can)
- [ ] Institutional collateral:
  - One-page pitch deck (PDF)
  - Sample DUA (Data Use Agreement) template for research-institution customers
  - Sample institutional license agreement
  - Pricing worksheet (internal; not public)
- [ ] Institutional pipeline: at least one named prospective partner in active conversation by end of Phase 2; a signed pilot is a bonus, not a requirement

---

## 3. Success criteria

Phase 2 is done when:

1. A Listener from a test country can subscribe at Resonant tier, see their patron status, use patron benefits, cancel, and receive a compliant receipt — all within 10 minutes.
2. A new Provider can apply, be accepted, onboard with Stripe Connect, upload a meditation, and have it reviewed and published within one calendar week from acceptance.
3. At least three revshare Providers receive a non-zero payout in a single monthly cycle.
4. A Listener can join a public sitting, see co-listener count, leave, and write a journal entry.
5. A report filed against a published meditation is acknowledged within 24 hours and resolved (publish / hide / unchanged) within 5 business days.
6. A named prospective institutional partner is in active conversation.
7. The audit log contains entries for every financial event (subscription created, charge, refund, payout), every moderation decision, and every role change, without gaps.
8. No Phase 1 commitment has regressed (continuity, observability, policy pages, accessibility, status page, etc.).

---

## 4. Non-scope (explicit)

- No mobile app-store launches (Phase 3).
- No in-app purchase on mobile (Phase 3).
- No research data collection (Phase 3).
- No multi-region LiveKit fallback (Phase 3).
- No Constellation protocol, no Seal, no hardware.
- No provider self-service dispute of a rejected appeal (appeals remain in-product but arbitration is Admin-human).
- No ad-hoc institutional self-serve — institutional sales are hand-sold through Phase 3.

---

## 5. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stripe Tax setup reveals compliance gaps in EU | Med | Engage tax advisor in week 1; launch patronage in smaller geography first, expand as cleared |
| Stripe Connect KYC friction causes Provider drop-off | Med | Default economic model on application is Contribution; Providers opt into Revshare when ready, no pressure |
| Revshare calculation disputes | Med-High | Make the ledger legible; provide Providers a breakdown endpoint from day 1; publish the exact formula |
| Sittings capacity stress on LiveKit | Med | Start with small capacity caps (e.g. 50 co-listeners); measure; expand later |
| Steward role misuse | Med | Launch cautiously (1–2 Stewards); all Steward actions reversible by Admin; Steward actions audited |
| Journal encryption key management UX confusion | Med | Key derived from user's password with recovery-phrase option; clear copy that losing the password loses the journal |
| Email deliverability to gmail/hotmail | Med | Warm-up new sender domain in Phase 1; SPF/DKIM/DMARC strict; monitor bounce rate |
| Institutional sales pulls team away from product work | High | Cap institutional effort at ~10% of team bandwidth in Phase 2; do not staff a dedicated sales role until Phase 3+ |

---

## 6. Capacity assumptions

- 1 senior full-stack engineer (patronage + provider economy)
- 1 design / frontend engineer (UI flows, Hearth, Sittings, Journal)
- 1 ops / infrastructure engineer (part-time; Stripe webhooks, deliverability)
- 1 community / moderation operator (part-time; Steward role, reports, applications)
- 1 product / writing (emails, policy copy, institutional collateral)
- Access to tax advisor (~20 hours) and legal counsel (~20 hours)

Budget additions: Stripe fees (pass-through), tax advisor, email provider, additional object storage, infrastructure.

---

## 7. Entry to Phase 3

Phase 3 begins when:

- All eight Phase 2 success criteria are met.
- The patronage model has run for at least 4 complete monthly cycles without material incidents.
- Ethics-review engagement (started in Phase 1) has produced either an IRB-equivalent approval or a clear route to one.
- The Flutter migration on `feat/flutter-migration` is either merged to `main` or in a merge-ready state with a PR open.
- There is team capacity for two parallel tracks in Phase 3 (mobile + research).

If the research track isn't ready, consider splitting Phase 3 into "Mobile GA" first and "Research GA" after. Do not launch a research surface that isn't IRB-backed.
