# Harmonic Beacon — Business Rules

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [docs/README.md](./docs/README.md#describing-what-is-not-built-yet). A
> present-tense statement in this document is a claim about code that exists
> today; if you find one that is not, that is a bug in this document.

*Canonical policy document · Draft 2026-04-12 · pending validation*

This document is the authoritative source for the policies that govern behaviour in the Harmonic Beacon system. Where code conflicts with these rules, code is wrong. Where rules conflict with each other, [VISION.md](./docs/VISION.md) and [PRODUCT_PRINCIPLES.md](./docs/PRODUCT_PRINCIPLES.md) arbitrate.

Detail for most sections lives in dedicated docs inside `docs/`. This file is the index of policy; the detail docs are the bodies of it.

---

## 1. Roles

The system is built around three primary user roles, stored in the `UserRole` enum in Postgres and derived from Zitadel project-role claims at sign-in.

`BEAC_ADMIN` grants ADMIN and `BEAC_PROVIDER` grants PROVIDER. LISTENER is the default and requires no claim — the absence of the other two is what confers it, so no `BEAC_LISTENER` claim is read. A legacy `certified_provider` claim is also accepted as a PROVIDER grant; whether that path remains valid is an open decision, and an undocumented role-granting claim is exactly what §2.2 of [TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md) should not tolerate.

### 1.1 LISTENER (default)

The standard end-user. Anyone who signs up is a Listener by default.

**Capabilities:**
- Consume live beacon and approved meditation overlays.
- Personalize through Favorites and a `ListeningSession` history.
- Participate, via opt-in, in the research protocol (see [RESEARCH_PROTOCOL.md](./docs/RESEARCH_PROTOCOL.md)).
- Become a Patron at any supported tier (see [MONETIZATION.md](./docs/MONETIZATION.md)).
- Join scheduled sessions they've been invited to.
- Will be able to report content or live-session behaviour (see [TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md)). **[Planned — Phase 1]**

**Guarantees owed to a Listener:**
- Access to the live beacon and at least one approved overlay is always free, always available within SLO.
- No advertising of any kind.
- One-click account export and one-click account deletion. **[Planned — Phase 1]**
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
- Will hold kill-switch authority on any live session (see [TRUST_AND_SAFETY.md §4](./docs/TRUST_AND_SAFETY.md)). Today the only path that ends a session is the hosting Provider ending their own. **[Planned — Phase 1]**
- Read-only view of aggregated but not raw research data (raw data access will require a separate Research role; see §6). **[Planned — Phase 3]**

**Obligations:**
- Every administrative action will be written to the audit log. **[Planned — Phase 1]**
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

> **Unresolved:** the Hidden row above keeps `isPublished: true`, but the takedown
> workflow in [CONTENT_POLICY.md §takedown](./docs/CONTENT_POLICY.md) sets
> `isPublished=false`. The two are different flag combinations, and a visibility
> filter written from one behaves differently under the other. The invariant has
> not been chosen yet; do not write a query against either until it is.

- `defaultMix` (Float, 0–1) is an advisory crossfader position stored with the meditation. The client uses it as the starting position; the listener can override.
- A meditation must carry a `TagCategory.LANGUAGE` tag at publication time.
- A meditation must carry at least one of `MOOD`, `TECHNIQUE`, or `DURATION` tags at publication time.
- The two tag rules above are policy, not yet enforcement: the approval endpoint performs no tag validation, so an Admin can currently publish a meditation that satisfies neither. **[Planned — Phase 1]**
- `originalPath` retains the original upload; `filePath` may be a transcoded derivative. Original files are never exposed to Listeners.

### 2.2 Scheduled sessions

A `ScheduledSession` is a live, interactive event hosted by a Provider. Status transitions: `SCHEDULED → LIVE → ENDED | CANCELLED`.

- A session will not transition `SCHEDULED → LIVE` more than 10 minutes before `scheduledAt`, or 60 minutes after, without Admin override. The start action currently checks only that status is `SCHEDULED`. **[Planned — Phase 1]**
- A session may be recorded (`SessionRecording`). Recording will be disclosed in-UI before joining, and joining will require affirmative consent — an explicit accept, not participation treated as agreement. **[Planned — Phase 1]**
- Session invites (`SessionInvite`) expire (`expiresAt`) or exhaust uses (`maxUses`) and are atomic.
- A session that exceeds its declared duration by 100% will be automatically flagged for review. **[Planned — unscheduled]**
- The Provider retains ownership of the resulting recording; the platform holds a non-exclusive, royalty-free license to serve it to authorized Listeners.

> **Unresolved:** the term of that license is stated inconsistently across this
> document and [CONTENT_POLICY.md](./docs/CONTENT_POLICY.md) — "perpetual" in one
> place, "terminates on removal" in another. These are different deal terms. The
> Provider Content Agreement decides it, and all locations get rewritten from
> that single source; until then no term should be quoted to a Provider. The
> Agreement should also address the rights of Listener participants whose voices
> appear in a recording, which none of the current wording covers.

### 2.3 Listening sessions

A `ListeningSession` is a record of a Listener consuming content. Types: `LIVE`, `MEDITATION`, `SCHEDULED_SESSION`. Tracks `durationSeconds` and `completed`.

- A ListeningSession is created on play. It will be finalized on natural end or a 30-minute inactivity window; no inactivity finalizer exists yet. **[Planned — Phase 1]**
- `completed` will be computed server-side as `durationSeconds ≥ 0.85 × meditation.durationSeconds` for a MEDITATION type, the event ending naturally for a SCHEDULED_SESSION, or any ≥60s LIVE listen. **Today the client asserts `completed` and the server stores it unvalidated**, so the value is not currently trustworthy — which matters because [MONETIZATION.md](./docs/MONETIZATION.md) describes revenue attribution as auditable from this ledger, and the research protocol treats it as an observation. **[Planned — Phase 1]**
- `ListeningSession` powers research, aggregate analytics, and personal history. It is **never** sold or shared with third-party analytics vendors.
- A Listener will be able to delete their own ListeningSessions, cascading to Research observations (see §6). **[Planned — Phase 1]**

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
  - **Severe breach**: abuse of minors, impersonation, deliberate fraud. Results in permanent ban and legal escalation. Naming an offboarded Provider publicly carries defamation exposure and requires counsel sign-off per instance; it is not an automatic consequence.

A Provider may also be placed on **probation** — a reviewable state in which their content returns to pre-publication review. See [CONTENT_POLICY.md](./docs/CONTENT_POLICY.md) for entry and exit conditions.

All offboardings will be logged to the audit log (§1.3). Affected providers have a right to reply and to request review. **[Planned — Phase 1]**

---

## 4. Moderation and takedown

Detail: [CONTENT_POLICY.md §4](./docs/CONTENT_POLICY.md).

- All new content is `PENDING` until a qualified reviewer moves it to `APPROVED` or `REJECTED`.
- Moderation will be a two-person review for first-time Providers and single-reviewer for returning Providers in good standing. The current tooling supports a single approver only. **[Planned — Phase 2]**
- Target SLA: initial review within 5 business days, emergency takedown decisions within 24 hours. These are targets, not yet measured — publishing them as guarantees requires the queue instrumentation that comes with the moderation tooling. **[Planned — Phase 2]**
- Takedown triggers: copyright complaint, safety concern, policy breach, erroneous approval. Each has a documented workflow in [CONTENT_POLICY.md](./docs/CONTENT_POLICY.md). The applicable notice-and-takedown framework is a counsel decision and is **not** assumed to be the US DMCA: the platform is operated from Argentina for an international audience, and DMCA safe harbour would require a registered US agent.
- A Provider whose content is taken down receives a rejection reason, linked to the specific rule violated.
- Listeners will be able to report content or sessions, triaged by the Steward role (when it exists) or Admin. **[Planned — Phase 1]**

---

## 5. Monetization and entitlements

Detail: [MONETIZATION.md](./docs/MONETIZATION.md).

> **Nothing in this section is live.** No payment processing, entitlement model,
> patron/free distinction or payout mechanism exists in code. Every published
> meditation is currently available to everyone, which exceeds the Commons
> commitment below but means the floor it describes is not enforced anywhere.
> The whole section is **[Planned — Phase 2]**.

Authoritative rules, to take effect when patronage ships:

### 5.1 What stays free, always

- Live beacon listening at full quality.
- A rotating set of published meditations (the "Commons") — minimum 15 at any time across the top tag categories. When patronage ships this floor needs an actual guard, or the commitment becomes silently breachable.
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
- **Revshare model**: a share of patronage revenue paid monthly, subject to a minimum payout threshold, attributed by normalized listening time on that Provider's content.

> **Unresolved — do not quote a percentage to a Provider.** This document and
> [MONETIZATION.md](./docs/MONETIZATION.md) describe two materially different
> models under the same headline number: a per-provider share of revenue
> attributable to that provider, versus a common pool computed after platform
> operating costs and split pro-rata. The second can be an arbitrarily smaller
> amount than the first. One model must be chosen, "net" defined exhaustively,
> and both documents rewritten from that single definition.
>
> Attribution also depends on the `ListeningSession` ledger being trustworthy,
> which per §2.3 it is not yet.

Institutional licensing revenue is considered at the platform level unless a specific arrangement states otherwise.

---

## 6. Research participation

Detail: [RESEARCH_PROTOCOL.md](./docs/RESEARCH_PROTOCOL.md).

> **No research data is collected today.** No consent, participant, survey or
> response models exist in the schema, and no instrument is administered. The
> rules below are the standard the protocol will be held to when it begins
> enrolling, gated on ethics review and a named Principal Investigator. The whole
> section is **[Planned — Phase 3]**.
>
> Because mood and anxiety instruments produce health data — a special category
> under GDPR Art. 9, with an analogous category under Argentina's Ley 25.326 —
> the protocol needs a documented lawful basis, and pseudonymized data must be
> treated as still personal. That analysis gates the phase.

### 6.1 Core rules

- Participation will be strictly opt-in with informed consent. Default is non-participation.
- Withdrawal will be possible at any time and always without penalty.
- A participant will be able to choose, at withdrawal, to erase their data or to retain it in de-identified form in the research record.
- No research instrument will collect biological markers without a separate, explicit, device-level consent.
- De-identified aggregates may be published, and we intend to publish them regularly. Identifiable data will not leave the platform except under a data-use agreement signed by a registered researcher under the RESEARCHER role, which does not exist yet.

### 6.2 Data minimization

Every field captured in a research instrument has a named justification in `docs/research/fields.yml` (to be created). Fields without justification are not collected.

### 6.3 Protocol change management

Protocol changes are preregistered publicly before deployment. Where preregistration cannot be done (emergency fixes), the change is documented in public after the fact with a rationale.

---

## 7. Listening experience and community

### 7.1 The Beacon (live)

- `wss://live.altermundi.net`, room `beacon`, primary source identity `beacon01`.
- A playlist-bot fallback fills the stream when `beacon01` is offline. The client detects the switch and manages audio accordingly.
- The fallback is surfaced to the listener. `/live` renders one of three states above the player — **LIVE** in red while `beacon01` is publishing, **PLAYLIST** in amber while the fallback is carrying the stream, **OFFLINE** when neither is. It is derived from the same presence the audio switching uses, so it changes with the source rather than lagging it.
- The label reads "PLAYLIST" rather than the "Beacon in transit" phrasing this document used to specify. The substance — a listener always knows which source they are hearing — is delivered; the wording is a copy decision, not a gap.

### 7.2 Sittings (planned feature; Phase 2)

A **sitting** is a scheduled synchronous listening event with no host and no talking. Listeners join at a set time, hear the beacon and a curated overlay together, see a silent count of co-listeners, and leave. Sittings are the community surface of the product — no chat, no comments, just shared presence. Included in the Commons; patrons may host private sittings for circles.

### 7.3 Resonance Journal (planned; Phase 2)

A Listener-owned journal for notes after a session. Never shared unless the Listener explicitly publishes an entry. Research access will be by-field, not by-entry: a validated mood score, with consent, yes; the free-form body, no.

The encryption design is unresolved. Earlier drafts specified a key derived from the user's password, which this architecture cannot provide — authentication is Zitadel OIDC with PKCE and the application never possesses a password. Either client-held key material with a recovery phrase, or app-managed encryption described honestly as Admin-resistant rather than Admin-proof. The claim must match whichever is built. **[Planned — Phase 2]**

### 7.4 Constellation (planned; long-horizon)

A framework for community-run beacons — institutions, retreat centres, or aligned collectives operating their own local beacon nodes under a shared protocol. The canonical app can discover and tune into Constellation nodes. Participation requires adherence to the Constellation Charter (see Phase 4 roadmap).

---

## 8. Reliability and continuity

Detail: [SLO.md](./docs/SLO.md).

### 8.1 The Covenant of Continuity

> *The beacon never goes dark.*

This is a brand promise, and it is a covenant rather than a warranty: the uptime target in [SLO.md](./docs/SLO.md) allows for measured, reported downtime. Terms of Service govern availability; this line governs intent. It binds us to:

- A hierarchy of audio sources: live `beacon01` → playlist fallback. A warm-standby upstream (`beacon02`) will sit between them; it does not exist yet, so today the hierarchy has two levels, not three. **[Planned — Phase 1]**
- A minimum uptime target published in [SLO.md](./docs/SLO.md) and reported against quarterly. **[Planned — Phase 1]** — the measurement apparatus is part of the observability work; a target without measurement cannot be reported against.
- A graceful-degradation contract for clients: on loss of the live beacon, transition to the fallback, announce the transition in-UI, and attempt to re-join. The switchover is implemented; the announcement is not, and the handover time has not been measured, so no bound is claimed here. **[Planned — Phase 1]**
- Post-incident: every continuity breach of ≥5 minutes written up as a public postmortem. **[Planned — Phase 1]**

### 8.2 Client behaviour under degradation

The rules below are the intended client contract. Retry backoff and local caching are not implemented; token refresh is whatever the LiveKit SDK does by default. **[Planned — Phase 1]**

- Clients will retry with exponential backoff up to 15 minutes before surfacing an error state.
- On token expiry, clients will transparently refresh; failure to refresh triggers a friendly re-auth without user-visible errors beyond a single toast.
- Clients never blame the user for a server or network failure. *(This one holds today.)*

---

## 9. Data rights

### 9.1 Listener data

> **Both endpoints exist.** The API is built; no UI calls it yet, so a Listener
> exercising either right currently needs someone to call it for them. The
> buttons are **[Planned — Phase 1]**. One part of the deletion promise is not
> yet kept, and it is stated below rather than in a footnote.

- **Access**: a Listener may download, via `GET /api/users/me/export`, their profile, listening history, favourites and session participation as structured JSON. Audio files are not included. Research participations and patronage are named here because this section promises them; both surfaces are unbuilt, so the export carries those keys empty rather than omitting them.
- **Deletion**: a Listener may delete their account at any time, via `DELETE /api/users/me`. Identifying data — email, name, avatar, identity-provider subject — is purged on request rather than within 30 days, along with favourites, listening history and session participation.

  The account row itself is retained in anonymised form. It cannot be dropped: published content and other Listeners' history reference it, and the row is what keeps those references intact. It holds nothing that identifies the person after deletion.

  **One category of stored audio is not purged, and it is the sensitive one.** Meditation audio is filed against the content that owns it rather than against a person, so a deleting Listener has none of it and a deleting Provider's files belong to content this endpoint deliberately retains — removing that audio is the takedown path's job, not deletion's.

  Session recordings are different. Recording is per-participant: someone who joined a recorded session has an audio file of their own voice, filed under their user id. That survives deletion today, and it is the most sensitive data the platform holds. It also sits on a genuine conflict — §2.2 gives the Provider ownership of the recording, while the Listener has an erasure right over their own voice, and one participant's track cannot be removed without altering a recording someone else owns. The conflict is unresolved; until it is, a participant is owed the plain fact before they join rather than a promise afterwards. **[Planned — Phase 1]**

  Aggregate, de-identified data already mixed into research datasets may be retained unless the Listener specifies erasure at withdrawal. No such data exists yet.
- **Portability**: the export declares a `formatVersion`, which is what makes the promise of a stable documented format keepable across changes.

### 9.2 Provider data

- A Provider who offboards may remove their content. A tombstone record is retained for Listener-history integrity (a past `ListeningSession` references a `meditationId` that may be gone).
- Session recordings remain property of the Provider. The term of the platform's license to serve them is the unresolved question flagged in §2.2, and the two documents currently disagree; it is settled in the Provider Content Agreement, not here.

### 9.3 Data we do not collect

- We do not collect or infer third-party advertising IDs.
- We do not share behavioural data with advertising, social, or analytics networks of the kind that use it for off-platform targeting.
- We do not fingerprint devices beyond what is necessary for security (rate-limit and abuse detection).

---

## 10. Safety

Detail: [TRUST_AND_SAFETY.md](./docs/TRUST_AND_SAFETY.md).

> **None of the four rules below is implemented.** There is no report model, no
> report button on any surface, and no Admin path to terminate a session — the
> only way a live session ends is the hosting Provider ending it. For a platform
> inviting people into a vulnerable state, these are the affordances the safety
> posture rests on, and they are required before open signup rather than merely
> desirable. **[Planned — Phase 1]**
>
> The response times below are targets. Once published they read as
> quasi-contractual, so they should not appear on a public surface until the
> queue that measures them exists.

Authoritative rules, to take effect as each ships:

- Every scheduled session will have an Admin-accessible kill-switch.
- Every content surface (meditations, sessions, profiles) will have a report button.
- Reports will be acknowledged within 24 hours and triaged within 5 business days.
- Incidents of severity S1 or S2 (user-visible harm, data incident, safety breach) will trigger the incident playbook and, when legally permissible, a public postmortem.

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
