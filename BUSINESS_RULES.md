# Harmonic Beacon — Business Rules

*Canonical policy document · Draft 2026-04-12 · pending validation*

This document is the authoritative source for the policies that govern behaviour in the Harmonic Beacon system. Where code conflicts with these rules, code is wrong. Where rules conflict with each other, [VISION.md](./docs/VISION.md) and [PRODUCT_PRINCIPLES.md](./docs/PRODUCT_PRINCIPLES.md) arbitrate.

Detail for most sections lives in dedicated docs inside `docs/`. This file is the index of policy; the detail docs are the bodies of it.

---

## 1. Roles

The system is built around three primary user roles, stored in the `UserRole` enum in Postgres and synchronized via Zitadel (`BEAC_ADMIN`, `BEAC_PROVIDER`, `BEAC_LISTENER`).

### 1.1 LISTENER (default)

The standard end-user. Anyone who signs up is a Listener by default.

**Capabilities:**
- Consume live beacon and approved meditation overlays.
- Personalize through Favorites and a `ListeningSession` history.
- Participate, via opt-in, in the research protocol (see [RESEARCH_PROTOCOL.md](./docs/RESEARCH_PROTOCOL.md)).
- Become a Patron at any supported tier (see [MONETIZATION.md](./docs/MONETIZATION.md)).
- Join scheduled sessions they've been invited to.
- Report content or live-session behaviour (see [TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md)).

**Guarantees owed to a Listener:**
- Access to the live beacon and at least one approved overlay is always free, always available within SLO.
- No advertising of any kind.
- One-click account export; one-click account deletion.
- No unsolicited changes to pricing, patronage tiers, or research participation.

### 1.2 PROVIDER

A content creator or guide. Granted to users who have been **vetted** (see §3.2 below). Inherits all Listener capabilities.

**Additional capabilities:**
- Upload and manage `Meditation` entries (audio/video).
- Create and host `ScheduledSession`s.
- Publish via `stream_name` and `room_name` on the associated LiveKit and go2rtc surfaces.
- Access analytics on their own content and sessions.
- If enrolled in the revenue-share scheme, receive payouts (see [MONETIZATION.md §3](./docs/MONETIZATION.md)).

**Obligations:**
- Agree to the Provider Content Agreement and Content Policy ([CONTENT_POLICY.md](./docs/CONTENT_POLICY.md)).
- Submit each piece of content to moderation before publication.
- Not make therapeutic, diagnostic, or prognostic claims in content or metadata.
- Respond to moderation or abuse reports related to their content or sessions within 72 hours.

### 1.3 ADMIN

System administrator. Inherits all Listener and Provider capabilities.

**Additional capabilities:**
- Superuser access to sessions and resources.
- Grant or revoke PROVIDER role.
- Approve, reject, un-publish, or hide any content.
- Hold kill-switch authority on any live session (see [TRUST_AND_SAFETY.md §4](./docs/TRUST_AND_SAFETY.md)).
- Read-only view of aggregated but not raw research data (raw data access requires separate Research role; see §6).

**Obligations:**
- Every administrative action is written to the audit log.
- No admin reads identifiable research data without the Research role.
- No admin communicates with a user using their personal account for business purposes; use role-scoped channels.

### 1.4 Future roles (scaffolded, not yet implemented)

Introduced in the roadmap; listed here so policy decisions can anticipate them.

- **RESEARCHER** — read-only access to de-identified research datasets under a data-use agreement.
- **STEWARD** — a trusted community moderator; can triage reports and apply temporary content holds but not permanent removal.
- **OPERATOR** — on-call role with infrastructure access, audited separately from ADMIN.
- **INSTITUTION** — a role that scopes a group of Listeners and a local configuration (e.g. a clinic running a private study).

---

## 2. Content lifecycle

### 2.1 Meditations

A `Meditation` is a piece of pre-recorded audio or video content uploaded by a Provider, surfaced to Listeners as an overlay on the beacon.

**Lifecycle states** (stored in `ModerationStatus` and the `isPublished`, `isFeatured`, `isHidden` flags):

| State | `ModerationStatus` | `isPublished` | `isHidden` | Visible to |
|---|---|---|---|---|
| Uploaded | `PENDING` | false | false | Provider + Admin |
| In review | `PENDING` | false | false | Provider + Admin |
| Rejected | `REJECTED` | false | false | Provider + Admin (with reason) |
| Approved, unpublished | `APPROVED` | false | false | Provider + Admin |
| Published | `APPROVED` | true | false | Everyone |
| Featured | `APPROVED` | true | false | Everyone, surfaced first |
| Hidden | `APPROVED` | true | true | Admin only (Provider sees stub + reason) |

- `defaultMix` (Float, 0–1) is an advisory crossfader position stored with the meditation. The client uses it as the starting position; the listener can override.
- A meditation must carry a `TagCategory.LANGUAGE` tag at publication time.
- A meditation must carry at least one of `MOOD`, `TECHNIQUE`, or `DURATION` tags at publication time.
- `originalPath` retains the original upload; `filePath` may be a transcoded derivative. Original files are never exposed to Listeners.

### 2.2 Scheduled sessions

A `ScheduledSession` is a live, interactive event hosted by a Provider. Status transitions: `SCHEDULED → LIVE → ENDED | CANCELLED`.

- A session cannot transition `SCHEDULED → LIVE` more than 10 minutes before `scheduledAt`, or 60 minutes after, without Admin override.
- A session may be recorded (`SessionRecording`). Recording is disclosed in-UI to participants before they join.
- Session invites (`SessionInvite`) expire (`expiresAt`) or exhaust uses (`maxUses`) and are atomic.
- A session that exceeds its declared duration by 100% is automatically flagged for review.
- The Provider retains ownership of the resulting recording; the platform retains a perpetual, royalty-free license to serve it to authorized Listeners. Details in the Provider Content Agreement.

### 2.3 Listening sessions

A `ListeningSession` is a record of a Listener consuming content. Types: `LIVE`, `MEDITATION`, `SCHEDULED_SESSION`. Tracks `durationSeconds` and `completed`.

- A ListeningSession is created on play and finalized on natural end or a 30-minute inactivity window.
- `completed` = true when `durationSeconds ≥ 0.85 × meditation.durationSeconds` for a MEDITATION type, or the event ended naturally for a SCHEDULED_SESSION, or on any ≥60s LIVE listen.
- `ListeningSession` powers research, aggregate analytics, and personal history. It is **never** sold or shared with third-party analytics vendors.
- A Listener may delete their own ListeningSessions. Deletion cascades to Research observations (see §6).

---

## 3. Provider onboarding, vetting, and offboarding

See [CONTENT_POLICY.md](./docs/CONTENT_POLICY.md) for the complete policy. The rules:

### 3.1 How a Provider becomes a Provider

By invitation only at launch. An application flow is in scope for Phase 2.

### 3.2 Vetting criteria (non-credential)

Vetting is a judgment call, not a checkbox. It weighs:

- Demonstrable experience in an aligned practice (music, meditation, somatic work, sound design, relevant research).
- Alignment with the brand voice. The Provider need not share the Harmonic Information Theory frame, but must be willing to work within its language constraints (no therapeutic claims).
- Willingness to have content moderated and to respond to reports within 72 hours.
- Willingness to attend one onboarding call with the Admin team.

Credentials (degrees, certifications) are not required and not sufficient.

### 3.3 Offboarding

A Provider may be offboarded by:

- Voluntary withdrawal (Provider-initiated). Their published content remains available unless they request removal; a separate "retirement" state hides them from Provider directories.
- Policy breach (Admin-initiated). Three categories:
  - **Soft breach**: content style drift, unpaid invoices, slow report response. Results in warning + content re-review.
  - **Hard breach**: therapeutic claims, harassment, repeat takedown triggers. Results in role revocation + content un-publication.
  - **Severe breach**: abuse of minors, impersonation, deliberate fraud. Results in permanent ban, legal escalation, public disclosure where legally permissible.

All offboardings are logged. Affected providers have a right to reply and to request review.

---

## 4. Moderation and takedown

Detail: [CONTENT_POLICY.md §4](./docs/CONTENT_POLICY.md).

- All new content is `PENDING` until a qualified reviewer moves it to `APPROVED` or `REJECTED`.
- At launch, moderation is a two-person review for first-time Providers, single-reviewer for returning Providers in good standing.
- SLA: initial review within 5 business days. Emergency takedown decisions within 24 hours.
- Takedown triggers: copyright complaint (DMCA path), safety concern, policy breach, erroneous approval. Each has a documented workflow in [CONTENT_POLICY.md](./docs/CONTENT_POLICY.md).
- A Provider whose content is taken down receives a rejection reason, linked to the specific rule violated.
- Listeners may report content or sessions. Reports are triaged by the Steward role (when available) or Admin.

---

## 5. Monetization and entitlements

Detail: [MONETIZATION.md](./docs/MONETIZATION.md).

Authoritative rules:

### 5.1 What stays free, always

- Live beacon listening at full quality.
- A rotating set of published meditations (the "Commons") — minimum 15 at any time across the top tag categories.
- Account creation, listening history, data export, account deletion.
- Participation in the research protocol.

### 5.2 What patronage supports

Patronage does **not** gate the core experience. It supports the instrument and unlocks conveniences:

- Extended on-demand access to the full meditation catalogue (beyond the free rotation).
- Download-for-offline.
- Public recognition on the Hearth page (optional, controllable by the patron).
- Early access to new protocols, experimental overlays, and research readouts.
- Invitations to small synchronous sittings (§7 below).

### 5.3 Pricing discipline

- Prices are published transparently on a public page.
- Tier changes require 30 days notice to existing patrons, and never retroactively reduce benefits.
- Students, unemployed, and residents of countries in the low-income band get a named discount ("Threshold tier") without needing to justify eligibility.
- A donation-only path exists for patrons who prefer not to opt into a subscription.

### 5.4 Provider economics

Two pathways, chosen by the Provider at onboarding:

- **Contribution model**: content is contributed freely; no payout.
- **Revshare model**: a defined share (default 50%, configurable per-provider) of *attributable patronage revenue* is paid monthly, subject to a minimum payout threshold. Attribution is by normalized listening time on that Provider's content.

Institutional licensing revenue is considered at the platform level unless a specific arrangement states otherwise.

---

## 6. Research participation

Detail: [RESEARCH_PROTOCOL.md](./docs/RESEARCH_PROTOCOL.md).

### 6.1 Core rules

- Participation is strictly opt-in with informed consent. Default is non-participation.
- Withdrawal is possible at any time and always without penalty.
- A participant can choose, at withdrawal, to erase their data or to retain it in de-identified form in the research record.
- No research instrument collects biological markers without a separate, explicit, device-level consent.
- De-identified aggregates may be published (and we intend to publish them regularly). Identifiable data never leaves the platform except under a data-use agreement signed by a registered researcher under the (future) RESEARCHER role.

### 6.2 Data minimization

Every field captured in a research instrument has a named justification in `docs/research/fields.yml` (to be created). Fields without justification are not collected.

### 6.3 Protocol change management

Protocol changes are preregistered publicly before deployment. Where preregistration cannot be done (emergency fixes), the change is documented in public after the fact with a rationale.

---

## 7. Listening experience and community

### 7.1 The Beacon (live)

- `wss://live.altermundi.net`, room `beacon`, primary source identity `beacon01`.
- A playlist-bot fallback fills the stream when `beacon01` is offline. The fallback is muted by default in clients and surfaced to the listener as a "Beacon in transit" state.
- Listeners see the source state (live vs. fallback) transparently. We do not pretend the beacon is live when it isn't.

### 7.2 Sittings (planned feature; Phase 2)

A **sitting** is a scheduled synchronous listening event with no host and no talking. Listeners join at a set time, hear the beacon and a curated overlay together, see a silent count of co-listeners, and leave. Sittings are the community surface of the product — no chat, no comments, just shared presence. Included in the Commons; patrons may host private sittings for circles.

### 7.3 Resonance Journal (planned; Phase 2)

A Listener-owned journal for notes after a session. Never shared unless the Listener explicitly publishes an entry. Journals are encrypted at rest such that only the Listener (and, with opted-in consent, the research layer) can read them. Research access is by-field, not by-entry (e.g. a validated mood score, yes; the free-form body, no).

### 7.4 Constellation (planned; long-horizon)

A framework for community-run beacons — institutions, retreat centres, or aligned collectives operating their own local beacon nodes under a shared protocol. The canonical app can discover and tune into Constellation nodes. Participation requires adherence to the Constellation Charter (see Phase 4 roadmap).

---

## 8. Reliability and continuity

Detail: [SLO.md](./docs/SLO.md).

### 8.1 The Covenant of Continuity

> *The beacon never goes dark.*

This is a brand promise. It binds us to:

- A documented hierarchy of audio sources: live `beacon01` → warm-standby upstream → playlist fallback.
- A minimum uptime target we publish in [SLO.md](./docs/SLO.md) and report against quarterly.
- A graceful-degradation contract for clients: when the live beacon is unavailable the app transitions to the fallback within 10 seconds, announces the transition in-UI, and attempts to re-join the live source.
- Post-incident: every continuity breach of ≥5 minutes is written up as a public postmortem.

### 8.2 Client behaviour under degradation

- Clients retry with exponential backoff up to 15 minutes before surfacing an error state.
- On token expiry, clients transparently refresh; failure to refresh triggers a friendly re-auth without user-visible errors beyond a single toast.
- Clients never blame the user for a server or network failure.

---

## 9. Data rights

### 9.1 Listener data

- **Access**: a Listener may download, via `/api/users/me/export`, their profile, listening history, favourites, research participations and responses, patronage status, and journal entries, in a structured format (JSON for data; original audio not included for journal-attached recordings that don't exist yet).
- **Deletion**: a Listener may delete their account at any time via `/api/users/me`. Deletion purges identifiable data within 30 days. Aggregate, de-identified data already mixed into research datasets may be retained unless the Listener specifies erasure at withdrawal.
- **Portability**: the export format is documented and stable across versions.

### 9.2 Provider data

- A Provider who offboards may remove their content. A tombstone record is retained for Listener-history integrity (a past `ListeningSession` references a `meditationId` that may be gone).
- Session recordings remain property of the Provider; the platform's license to serve them is revoked on removal unless otherwise agreed.

### 9.3 Data we do not collect

- We do not collect or infer third-party advertising IDs.
- We do not share behavioural data with advertising, social, or analytics networks of the kind that use it for off-platform targeting.
- We do not fingerprint devices beyond what is necessary for security (rate-limit and abuse detection).

---

## 10. Safety

Detail: [TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md).

Authoritative rules:

- Every scheduled session has an Admin-accessible kill-switch.
- Every content surface (meditations, sessions, profiles) has a report button.
- Reports are acknowledged within 24 hours and triaged within 5 business days.
- Incidents of severity S1 or S2 (user-visible harm, data incident, safety breach) trigger the incident playbook and, when legally permissible, a public postmortem.

---

## 11. Brand-line refusals

What we will not build:

- **Advertising** of any kind, first- or third-party.
- **Social virality mechanics** — no follower counts, no public activity feeds, no vanity metrics.
- **Behavioural nudges** that manufacture emotion — streaks, guilt, scarcity.
- **Therapeutic claims**. We do not sell healing. We do not diagnose. We do not treat.
- **Data resale**. No selling of raw or derived Listener data under any label.
- **Surveillance features**. No tracking a Listener's device activity beyond our product, no background location, no contacts scraping.
- **Hidden AI synthesis** — if the beacon ever carries synthesized audio, we disclose it in-UI.

These refusals are rules, not aspirations. A PR that violates them is rejected regardless of its commercial logic.

---

## Cross-references

- [docs/VISION.md](./docs/VISION.md) — what we are and are not
- [docs/PRODUCT_PRINCIPLES.md](./docs/PRODUCT_PRINCIPLES.md) — standing rules for decisions
- [docs/MONETIZATION.md](./docs/MONETIZATION.md) — patronage model, tiers, economics
- [docs/RESEARCH_PROTOCOL.md](./docs/RESEARCH_PROTOCOL.md) — consent, surveys, data handling
- [docs/CONTENT_POLICY.md](./docs/CONTENT_POLICY.md) — provider policy, moderation workflow
- [docs/TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md) — incident playbook, reporting
- [docs/SLO.md](./docs/SLO.md) — uptime, continuity, degradation contract
- [docs/ROADMAP.md](./docs/ROADMAP.md) — long-term development project
