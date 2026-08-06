# EarlyBirds: product and delivery plan

> **Status:** Draft for agreement with Nico and the Harmonic Beacon team
> **Date:** 2026-08-05
> **Integration branch:** `early-birds`, based on `main@f520332`
> **Operational rule:** this document authorizes planning only. It does not
> authorize a production deploy, a payment change, or a change to the event
> audio path.

Reviewed inputs: `.hermes/plans/2026-08-05_beacon-founders-mvp.md` and
`docs/BEACON_FOUNDERS.md` from the daimonmatrix checkout. They remain valuable
vision inputs; this document supersedes them only as the implementation plan for
the current repository.

## 1. Outcome

EarlyBirds is a simple paid listening membership for people who want a private,
continuous relationship with the Beacon outside scheduled events.

The first useful release lets a Listener:

1. sign in with Google;
2. obtain a valid EarlyBird membership through the existing commerce authority;
3. open a private, receive-only listening home;
4. hear a continuous 24/7 Beacon stream;
5. optionally start one reviewed guided voice track in Spanish or English and
   balance the guide against the Beacon;
6. return later and recover the same access without joining an event room.

The initial 24/7 source is the long spatialized recording
`luz_de_manana_20260624-155633.wav`, played continuously. It is not yet the live
Costa Rica instrument. The product must say this truthfully. The delivery
service is designed so that a real live source can replace the recorded source
later without replacing the Listener product.

EarlyBirds is developed quickly and in isolation. Weekend event releases remain
on `main` and must not depend on EarlyBirds until a later, explicit convergence
change has passed its own audio and operational acceptance.

## 2. Decisions already accepted

| Decision | State | Consequence |
|---|---|---|
| Develop on a long-lived `early-birds` integration branch | Accepted | Weekend work continues independently on `main`. |
| Use the long master recording as the first 24/7 source | Accepted | We can prove the listening product before the physical live uplink exists. |
| Make the stream the primary EarlyBirds experience | Accepted | Stream reliability and audio quality precede growth features. |
| Design the stream for later reuse by event sessions | Accepted | The source and delivery contract cannot be Listener-specific. |
| Do not change the current event audio path before the next weekend | Accepted | Reuse by events is a post-weekend convergence card, not an EarlyBirds shortcut. |
| Use Fast Forward development with risk-based checkpoints | Accepted | Small isolated changes do not run the whole production release ceremony. |
| Preserve the audio guardrail | Accepted | No codec, rate, channel, gain, buffer, routing or player-path choice ships without Nico's audio approval. |

## 3. Facts from the current system

This plan is based on the current repository and deployed architecture, not on
the older Founders proposal alone.

- Event production is one host (`mona`) running the Next.js app, PostgreSQL,
  LiveKit, playlist-bot and tapestry. This is already a shared failure domain.
- Event attendees use durable `WebSession` rows and `hb_session`. The existing
  `User` table represents staff, not consumer accounts.
- NextAuth/Auth.js was retired on 2026-08-02. Reintroducing a beta auth runtime
  is explicitly prohibited without a new decision and a full auth review.
- The event Beacon bed is delivered through LiveKit. Its playlist publisher is
  optimized for real-time event mixing and is guarded because it previously
  produced audible regressions.
- PayPal and the commerce/entitlement integration already have an authority in
  `proyecciones-mito`. EarlyBirds must extend or consume that authority, not
  create an unrelated payment truth inside the web app.
- The selected source master is 6,844.426 seconds (1:54:04.426), stereo,
  48 kHz, 32-bit float PCM, 2,628,259,840 bytes.
- Six candidate guided voice masters exist. They are mono 24 kHz WAV files,
  approximately 5.5 minutes each. The final voice/version and permission to use
  it have not yet been recorded as product decisions.
- No `beacon-247` service or room exists today.

## 4. Corrections to the initial Founders proposal

The two source documents capture the desired spirit, but their implementation
steps are not safe to execute literally.

1. They name PayPal and MercadoPago as the product providers but implement
   Stripe in the task sequence. EarlyBirds will use one canonical provider and
   contract at a time.
2. They attach consumer identity to the existing staff `User` model. EarlyBird
   accounts need a separate domain.
3. They add a second session framework and bridge it into `hb_session`. Listener
   sessions remain separate from staff/event sessions.
4. They extend the current event LiveKit token route and current
   `AudioContext`. The EarlyBirds MVP gets separate routes and a separate player
   boundary.
5. They call a shared database, container, host and SFU "zero impact". Shared
   infrastructure is impact; the preview and media origin must be isolated and
   resource-bounded.
6. They treat a boolean `isFounder` as a lifetime-price contract. Founder terms
   require a versioned offer and durable commercial evidence.
7. They place PWA, three identity providers, root redirects, post-event upsell
   and autonomous social publishing in the first slice. None is required to
   prove that a person can subscribe and listen reliably.
8. They alternate between claiming an existing live 24/7 source and saying it
   still needs to be built. The initial source is explicitly a continuous
   recorded stream.

## 5. MVP boundary

### Included

- `/early-birds` public explanation and sign-in entry.
- `/early-birds/home` private Listener player.
- Google sign-in only for the first release.
- A separate EarlyBird account/session domain.
- Canonical membership entitlement from the commerce service.
- A continuous, monitored stream from the approved long master.
- Beacon-only playback and one optional ES or EN guide.
- A simple Beacon/Guide balance with an obvious return to Beacon-only.
- Honest source state: recorded continuous source, reconnecting or unavailable.
- Cancellation/revocation reflected without relying on a front-end redirect.
- ES/EN copy, privacy/terms, basic accessibility and mobile-browser acceptance.
- Metrics sufficient to know whether the stream is reachable and audible.

### Deferred

- Apple and Facebook sign-in.
- MercadoPago as a second recurring provider.
- PWA installation and custom service worker.
- Root-route redirection.
- Post-event upsell inside the current session UI.
- Automated social posting or advertising spend.
- Harmonizer, vocoder or generative audio experiments.
- Modifying current event `AudioContext`, LiveKit token routes or crossfader.
- Reusing the stream in scheduled events; this is the post-weekend convergence
  work described in section 14.

## 6. Architecture

```text
approved immutable master
          |
          v
offline reviewed derivative ----> 24/7 stream origin ----> cache/CDN boundary
                                         |                         |
                                         |                         v
                                         |                 Listener browser
                                         |                 + optional guide
                                         v
                                  external canary

Google OIDC ---> EarlyBird account/session ---> EarlyBird web routes
                         |
                         v
commerce entitlement API <--- PayPal/webhooks/reconciliation authority
```

### 6.1 Code boundary

Until final integration, new application code stays under explicit namespaces:

- `src/app/early-birds/**`
- `src/app/api/early-birds/**`
- `src/lib/early-birds/**`
- `services/beacon-stream/**`
- additive EarlyBird data models and migrations only
- an isolated compose/preview definition, not edits that replace production
  services

The MVP does not modify:

- `src/context/AudioContext.tsx`;
- `src/app/session/[id]/**`;
- `src/app/api/livekit/token/**`;
- core event `Principal` semantics;
- event playlist-bot behavior.

### 6.2 Runtime isolation

Development and team acceptance use an isolated preview:

- its own app container and compose project name;
- its own preview PostgreSQL database;
- its own cookie name, signing secret and OAuth callback;
- its own stream-origin container and URL;
- synthetic accounts and provider sandbox data only;
- CPU/memory limits so it cannot starve event services;
- no automatic production migration or deploy from the `early-birds` branch.

The preferred preview address is
`earlybirds-staging.harmonicbeacon.com`. A private ZeroTier-only name is an
acceptable first step if public DNS would delay the media proof.

For final production, the code may live in the main app after acceptance, but
the stream origin remains independently restartable and resource-bounded. Data
models are additive and a rollback can hide EarlyBird routes without rolling
back event data.

## 7. Continuous stream contract

The stream is a shared platform service, even though EarlyBirds is its first
consumer.

### 7.1 Source and artifacts

- The WAV master is immutable and identified by a recorded SHA-256.
- Conversion never overwrites the master.
- A reproducible command creates a versioned delivery artifact.
- The derivative records codec, bitrate, sample rate, channels, loudness/peak
  measurements, encoder version and checksum.
- Nico approves the derivative by A/B listening before it becomes a candidate.
- The six guide masters follow the same provenance process separately.

### 7.2 Delivery shape

The first technical spike will use a buffered HTTP streaming protocol rather
than WebRTC for this one-way, long-running source. The working default is HLS:
it is buffer-friendly, cacheable, scales independently of the event SFU and can
later be consumed by both Listener and event clients.

The delivery codec is deliberately **not chosen in this document**. Browser
support and acoustic quality conflict here, especially on Safari/iOS. The spike
must compare the original standard player, the encoded artifact, the streamed
artifact in a standard player and the actual EarlyBird player. Selecting and
deploying that encoding is an audio-touching decision requiring Nico's explicit
approval.

To avoid continuous expensive encoding, the expected steady state is:

1. encode the approved master once;
2. run a small origin process that reads it at real time and loops it;
3. package or relay without another lossy encode;
4. keep a rolling live manifest and bounded segments;
5. expose health, current source, media sequence and last-output timestamp.

All listeners should hear approximately the same wall-clock position. A process
restart may begin a new epoch; it must not produce overlapping publishers.

### 7.3 Access and truthfulness

- The public page does not expose a durable unrestricted media URL.
- The private player obtains a short-lived signed stream authorization after a
  current membership check.
- Expiry and refresh do not interrupt healthy playback unnecessarily.
- The UI says "continuous recorded Beacon" (localized wording to be approved),
  not "live from Costa Rica".
- Source state comes from the same origin state that drives delivery.

### 7.4 Reliability acceptance

- One and only one origin publisher/packager is active.
- The master loops without an audible speed change, channel collapse or
  duplicate overlap.
- Restart and reconnect recover without manual browser reload.
- A canary fetches manifests and decodes actual audio, not only HTTP 200.
- A 60-minute human listen on desktop and physical iOS/Android devices has no
  unexplained gaps, speed shifts or route changes.
- Stream failure cannot consume resources needed by an event and has a
  one-command stop/rollback.

## 8. Listener player contract

The player starts from the simplest path shown to reproduce clean audio in prior
testing: native media playback. Web Audio is introduced only if a required mix
behavior cannot be achieved cleanly and the alternative passes the audio gate.

- Playback begins only after an explicit user gesture.
- Beacon-only is the default and remains available if a guide fails.
- Starting a guide does not reconnect or restart the Beacon stream.
- Balance changes are perceptually smooth and never exceed reviewed gain limits.
- Stopping a guide returns to Beacon-only without a jump in the Beacon timeline.
- A hidden or locked phone behaves honestly; the UI does not claim playback
  while the browser has suspended it.
- No camera, microphone, chat, hands, tapestry or event presence is created.
- A Listener connection does not count as an event LiveKit participant.

The media test ladder is mandatory and intentionally incremental:

1. master file in a standard player;
2. approved derivative in a standard player;
3. stream in a standard browser player;
4. stream in the EarlyBird player;
5. stream plus ES guide;
6. stream plus EN guide.

A failure at one level is fixed there before testing the next.

## 9. Identity and session contract

EarlyBird identity is not staff identity and not an event ticket identity.

Proposed additive concepts:

- `EarlyBirdAccount`: internal opaque account identifier and lifecycle state;
- `EarlyBirdIdentity`: provider, provider subject, verified email and linkage;
- `EarlyBirdSession`: hashed opaque session, expiry, revocation and last use;
- `EarlyBirdOfferGrant`: the offer terms acquired by the account;
- `EarlyBirdEntitlementSnapshot`: last canonical membership state and source
  revision, if a local cache is necessary.

The browser uses a separate `hb_earlybird_session` cookie. An EarlyBird session
cannot grant staff capabilities, event publication or event admission.

Google is the first provider. The implementation uses Authorization Code with
PKCE, state and nonce, and stores no Google access/refresh token unless a later
feature proves it necessary. Provider subject is the primary external identity;
verified email is contact/linkage evidence, not a mutable authorization key.

Before choosing an auth library, a short ADR must confirm a maintained stable
option compatible with Next.js 16. The retired NextAuth beta is not the default.

## 10. Membership and commerce contract

`proyecciones-mito` remains the canonical commerce authority. The web app does
not infer a membership from a PayPal success page and does not implement a
parallel webhook truth.

The EarlyBirds contract must provide, at minimum:

- opaque account/customer correlation without leaking provider secrets;
- offer code and immutable offer revision;
- provider subscription identifier kept server-side;
- canonical state: pending, active, grace, paused, cancelled, expired, refunded
  or revoked (final vocabulary agreed with commerce);
- effective and expiry/grace timestamps;
- monotonic revision or source-event ordering key;
- idempotent delivery and reconciliation endpoint;
- plan, currency and amount validation at the commerce boundary;
- cancellation, failed-renewal, refund, dispute and manual-revoke behavior;
- a safe test/sandbox mode with synthetic identities.

"Founder price locked for life" is not a boolean. It is a versioned offer grant
recording the acquired amount/currency, acquisition time and continuity policy.
The team must define whether cancellation permanently loses the offer and how a
failed payment during grace differs from voluntary cancellation.

The first provider should be PayPal because that path already operates in the
project. MercadoPago follows only after the provider-neutral entitlement
contract is demonstrated. No provider is enabled for real EarlyBird charges
until Nico approves the exact offer and a sandbox lifecycle passes end to end.

## 11. Fast Forward development lane

The purpose of isolation is to make development fast, not to reproduce the
production release process for every edit.

### 11.1 Branch flow

```text
main (weekend production)
  \
   early-birds (shared integration and preview)
      |-- early-birds/stream-origin
      |-- early-birds/listener-shell
      |-- early-birds/google-identity
      `-- early-birds/membership-contract
```

- Short slices merge into `early-birds`, not `main`.
- The shared branch is never rebased after others consume it.
- `main` is merged into `early-birds` at controlled checkpoints after `main` is
  green; weekend fixes never wait for EarlyBirds.
- Final convergence is one reviewed PR from `early-birds` to current `main`.

### 11.2 Three verification speeds

**Fast loop — every small change, target under five minutes**

- formatting/lint only for changed files;
- focused unit or component tests related to the slice;
- schema/contract validation when those files changed;
- local smoke of the route or service being edited;
- no full build, browser matrix, load test or production probe by default.

**Integration checkpoint — when a coherent slice enters `early-birds`**

- TypeScript and full lint once;
- relevant package/unit suites;
- preview database migration from empty and from previous preview revision;
- one focused browser happy path;
- container health and rollback smoke for changed services.

**Release checkpoint — only for an EarlyBird candidate to merge or launch**

- full existing CI/build and EarlyBird integration/E2E suite;
- auth and commerce adversarial matrix;
- physical-browser audio acceptance;
- sustained stream/canary/restart test;
- security/privacy review, migration/backup and rollback rehearsal;
- conflict/regression audit against current `main`;
- human acceptance by Nico/team.

Nightly or manual CI may run heavier checks without blocking each commit. Load
tests use separate inexpensive clients/VPSs and are never generated from the
same production host being measured.

### 11.3 Risk overrides

The fast lane does not waive boundary-specific gates:

- audio changes require the audio ladder and Nico's approval;
- identity/session changes require negative authorization tests;
- commerce changes require contract/idempotency/reconciliation tests;
- migrations require forward compatibility and a proven rollback strategy;
- production infrastructure still requires health verification and rollback.

Everything else should favor a coherent batch and a useful preview over repeated
ceremony.

## 12. Delivery batches

### Batch 0 — freeze the contract

Deliver this agreed document, the missing auth/media/offer ADRs, milestone and
dependency graph. No application behavior changes.

Exit: all decisions in section 15 are accepted or deliberately deferred.

### Batch 1 — isolated preview and 24/7 media proof

- add the isolated compose/runtime boundary;
- inventory and checksum the master;
- create a reproducible candidate derivative without replacing the master;
- run the stream origin under resource limits;
- expose health/source state;
- add a bare private test player and canary;
- execute the audio test ladder through streamed standard playback.

Exit: the 24/7 recorded source survives restart and a 60-minute cross-device
listen, with no event service or current audio file changed.

### Batch 2 — Listener vertical slice with synthetic entitlement

- create isolated EarlyBird data models and session cookie;
- build bilingual public page and private home;
- use a development-only synthetic entitlement fixture;
- add Beacon-only player, guide selection and balance;
- prove that no event connection/capability is created.

Exit: the team can use the complete listening experience in preview without a
payment provider.

### Batch 3 — Google identity

- approve the identity ADR;
- implement Google sign-in, callback, session/revocation and logout;
- add account-linking and duplicate-email protections;
- run positive and negative auth tests in preview.

Exit: a returning test Listener reaches the same isolated account and cannot
cross into event/staff privileges.

### Batch 4 — PayPal membership integration

- agree the versioned commerce contract with Mariano/Sai;
- extend the commerce sandbox for the EarlyBird offer;
- consume canonical membership state in the app;
- test create, duplicate webhook, out-of-order event, retry, renewal failure,
  grace, cancellation, refund and revoke;
- reconcile stale/missing delivery.

Exit: sandbox purchase-to-listen and revoke-to-deny work without trusting a
browser redirect or duplicate authority.

### Batch 5 — release candidate

- approve terms, privacy, offer copy and source wording;
- complete accessibility/mobile/audio/security acceptance;
- run sustained origin/canary test and failure rehearsal;
- verify backups, observability, stop switch and rollback;
- merge current `main` into `early-birds` and resolve conflicts;
- run the release checkpoint once.

Exit: a documented go/no-go decision. Production remains off until explicitly
approved.

## 13. Definition of done for the EarlyBirds milestone

- A Listener can sign in, obtain a canonical sandbox membership and listen.
- The initial recorded source is continuously delivered and truthfully labeled.
- Beacon-only and both approved guide languages pass physical-device listening.
- No Listener gains event/staff capabilities or creates event media connections.
- Duplicate/reordered commerce events cannot duplicate or incorrectly preserve
  access.
- Revocation becomes effective within the agreed propagation window.
- Origin, app and commerce dependencies have useful health/alert signals.
- The entire EarlyBird feature can be disabled without rolling back weekend
  event code or data.
- Current event tests remain green at final convergence.
- Runbook includes launch, pause, source replacement, incident and rollback.

## 14. Post-weekend convergence card

Create one card outside the immediate EarlyBirds milestone, blocked by both a
successful EarlyBird stream acceptance and completion of the next weekend's
events:

**Evaluate and adopt the 24/7 stream as the shared Beacon source for events.**

It must:

- compare the approved HTTP stream against the current LiveKit playlist source
  using the established file → standard player → browser → app ladder;
- preserve simultaneous Stage and Beacon playback and the event crossfader;
- define source-of-truth, fallback and source-state behavior;
- test Chrome, Safari/iOS, Android, reconnection and long listening;
- measure latency, dropouts, channel count, sample rate, speed and gain;
- retain a one-switch rollback to the current event bed;
- avoid changing the event path before the weekend;
- require Nico's explicit audio approval before merge or deploy.

The expected benefit is one continuously proven, buffer-friendly Beacon source
for both products. It is an experiment until the comparison demonstrates that
event sound and reliability are at least as good as the current path.

## 15. Decisions required before cards are created

Recommended defaults are included so the team can approve them as a block or
change only the exceptions.

| ID | Decision | Recommended default |
|---|---|---|
| D1 | Public name and URL | Product name `EarlyBirds`; preview at `earlybirds-staging.harmonicbeacon.com`; final entry at `/early-birds`. |
| D2 | Founder offer | USD 2/month, amount locked while the same subscription remains active; voluntary cancellation loses the locked offer, provider failure gets a defined grace period. |
| D3 | First identity provider | Google only; Apple/Facebook after launch evidence. |
| D4 | First payment provider | PayPal through the existing commerce authority; MercadoPago second. |
| D5 | Initial source wording | "Continuous recorded Beacon"; never imply the physical source is live. |
| D6 | Guide masters | Amara Sol ES/EN candidates, subject to explicit rights/consent and Nico's content/audio approval. |
| D7 | Stream delivery | Buffered HTTP/HLS spike; codec selected only after A/B and browser support evidence. |
| D8 | EarlyBird offer after cancellation | Locked offer survives only involuntary payment failure during grace, not voluntary cancellation/refund/revoke. |
| D9 | Production topology | Main app after final merge; independent stream-origin service; additive models; feature/kill switch. |
| D10 | Stream timeline | One shared wall-clock stream position for all Listeners, not a private loop beginning at sign-in. |

## 16. Card map after agreement

Only after section 15 is agreed, create milestone `EarlyBirds` and non-duplicate
GitHub issues in this dependency order:

1. EB-00 — freeze product, identity, commerce and media ADRs.
2. EB-01 — isolated preview runtime and Fast Forward CI lane.
3. EB-02 — source provenance and reproducible media artifact pipeline.
4. EB-03 — resource-bounded 24/7 stream origin and health.
5. EB-04 — stream canary, observability and incident stop switch.
6. EB-05 — Listener shell and synthetic-entitlement vertical slice.
7. EB-06 — Google identity and isolated Listener sessions.
8. EB-07 — guide asset approval, delivery and Beacon/Guide player.
9. EB-08 — versioned EarlyBird commerce entitlement contract.
10. EB-09 — PayPal sandbox lifecycle and reconciliation.
11. EB-10 — privacy, terms, accessibility and bilingual acceptance.
12. EB-11 — release/rollback rehearsal and go/no-go.

Create a separate post-milestone issue for section 14. Do not hide it inside an
audio or player issue, because it changes the event sound architecture and needs
its own explicit approval.

## 17. Rollback and operational invariants

- `main` and the event release branch do not depend on `early-birds`.
- The preview can be stopped by stopping its compose project; no production
  container is removed or replaced.
- The stream origin can be stopped independently of the event playlist-bot.
- EarlyBird public entry has a kill switch that returns a truthful unavailable
  page without affecting event login.
- Membership denial fails closed when canonical commerce state is missing or
  invalid; existing healthy playback gets only the explicitly agreed grace.
- No secret, provider token, raw webhook payload with PII or customer record is
  committed or logged publicly.
- No synthetic test writes to real participant or payment data.
- Final migrations are additive; rollback disables readers/writers before any
  later cleanup migration.
- Audio artifacts are immutable and reversible by version pointer, never by
  overwriting the approved previous file.
