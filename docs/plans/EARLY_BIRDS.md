# EarlyBirds: product and delivery plan

> **Status:** Accepted implementation baseline
> **Date:** 2026-08-07
> **Integration branch:** `early-birds`; merge current green `main` at controlled checkpoints
> **Operational rule:** implementation and isolated staging are authorized. Production,
> real charges and every audio encoding/content/signature choice still require the
> explicit release and audio gates in this document.

> **Current launch memory (2026-08-13):** the public Listener candidate runs exact
> SHA `4ac408f4bc43cab85f058fc3d39aa2a2b4b4207a`; canonical payment authority runs
> `b1038ddb579817e39add567c5b7b055e2f716095`; the isolated mail sidecar runs
> `456ece2b38e203a2d12c54864115e03ebaa1a89c`. PayPal Sandbox and Mercado Pago
> TEST lifecycles are accepted. One PayPal Live approval intent exists without a
> subscription or charge; new sales and public checkout remain OFF while its Live
> lifecycle ingestion stays ON. See `docs/operations/LISTENER_LAUNCH_NOW.md` for the few remaining
> human/external gates.

Reviewed inputs: `.hermes/plans/2026-08-05_beacon-founders-mvp.md` and
`docs/BEACON_FOUNDERS.md` from the daimonmatrix checkout. They remain valuable
vision inputs; this document supersedes them only as the implementation plan for
the current repository.

## 1. Outcome

EarlyBirds is the implementation codename for a registered Free and paid
listening product for people who want a continuous relationship with the Beacon
outside scheduled events.

The first useful release lets a Listener:

1. sign in with a configured Google/Apple provider or a passwordless email link;
2. use a registered-Free allowance of three hours in a personal, fixed
   seven-day cycle anchored at the first real Free playback, redeem a controlled
   invitation, or activate a valid paid Founding Listener membership;
3. open an authenticated, receive-only listening home;
4. hear a continuous 24/7 Beacon stream;
5. optionally begin with one reviewed private intro, using standard private
   playback controls before the continuous Beacon stream is revealed;
6. return later and recover the same access without joining an event room.

The initial 24/7 source is the approved long spatialized master, played
continuously. Its origin is an operational concern, not a public product state:
the interface identifies only the continuous Beacon stream. The delivery
service is designed so that its origin can change without replacing the
Listener product or requiring new public copy.

EarlyBirds is developed quickly and in isolation. Weekend event releases remain
on `main` and must not depend on EarlyBirds until a later, explicit convergence
change has passed its own audio and operational acceptance.

## 2. Decisions already accepted

| Decision | State | Consequence |
|---|---|---|
| Develop on a long-lived `early-birds` integration branch | Accepted | Weekend work continues independently on `main`. |
| Use the approved long master as the first 24/7 source | Accepted | We can prove the listening product before the physical live uplink exists. |
| Make the stream the primary EarlyBirds experience | Accepted | Stream reliability and audio quality precede growth features. |
| Share only the Beacon stream timeline | Accepted | Intros are private media with local play, pause, seek and restart controls; their natural end reveals the shared live edge. |
| Design the stream for later reuse by event sessions | Accepted | The source and delivery contract cannot be Listener-specific. |
| Do not change the current event audio path before the next weekend | Accepted | Reuse by events is a post-weekend convergence card, not an EarlyBirds shortcut. |
| Use Fast Forward development with risk-based checkpoints | Accepted | Small isolated changes do not run the whole production release ceremony. |
| Preserve the audio guardrail | Accepted | No codec, rate, channel, gain, buffer, routing or player-path choice ships without Nico's audio approval. |
| Use deterministic HLS over HTTP | Accepted | Every listener follows one UTC-derived live edge through immutable six-second segments; the approved staging delivery is AAC-LC 320 kbps, 48 kHz stereo and event WebRTC is untouched. |
| Favor continuity over low latency in the Listener | Accepted | Desktop HLS stays about five segments behind the edge with a 60-second target buffer; Stop and a later Listen rejoin the current configured edge. |
| Keep intros private | Accepted | Intro progress is device-local. The live stream runs muted underneath and is revealed at the handoff; this is not a realtime mix or crossfader. |
| Separate ordinary Free from canonical membership | Accepted | Registered Free is a server-authoritative, metered weekly allowance that never fabricates membership or Purchase; canonical memberships/invitations and Free for All remain non-metered. |
| Preserve the Founder price while service remains uninterrupted | Accepted | USD 5/month remains guaranteed only while the canonical Founder subscription stays active or inside its approved grace/paid-through continuity; once service ends, Founder status and pricing end and a later signup uses the current public offer. |
| Launch Free before paid providers | Accepted | Human acceptance of the complete Free flow is a hard gate before PayPal or MercadoPago can be enabled. Both providers remain disabled by default. |
| Defer app-store distribution | Accepted | Google Play and Apple App Store wrappers and billing are post-MVP work; the provider-neutral membership authority must leave room for them without making them a launch dependency. |
| Design for 3,000 concurrent listeners | Accepted | Expand at 4,000 and treat 5,000 as critical; alerts use measured network, CPU, memory, origin and canary health. |

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
- The selected source master is
  `luz_de_manana_20260624-155633_2hs.wav`: 6,844.426 seconds
  (1:54:04.426), stereo, 48 kHz, 16-bit PCM, 1,314,129,920 bytes and
  SHA-256 `feb0cac547eee8a2012ede32f9358e1cad4b66f6aea3b1b839610e71fad42685`.
  Nico approved its authored gain without further normalization. Its AAC-LC
  320 kbps staging derivative measures -14.2 LUFS with a decoded peak of
  -0.2 dBFS.
- The approved English intro source is the 2026-08-06 Amara Sol offline mix
  `BeaconDropIn-Amara-sol_r1_session.wav`, including its authored Beacon
  sidechain/effects and ending fade. Nico approved its authored gain without
  further normalization. Its AAC-LC 320 kbps, stereo, 48 kHz derivative
  measures -11.2 LUFS with a decoded peak of -0.4 dBFS. The separately approved
  Spanish source is `BeaconDropIn-Amara-sol_ES_r1_session.wav` (2026-08-07),
  SHA-256 `e59443ab765a4eb94c7d2ea96176647c5b0e5d2945966ea3de599270edec656b`;
  its format-only AAC-LC derivative is 347.010 seconds, -11.3 LUFS and -0.4 dBFS
  true peak.
- No production `beacon-247` LiveKit room exists. The isolated staging HTTP
  origin is the current 24/7 implementation and remains separate from events.

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
6. They treat a boolean `isFounder` as a complete pricing contract. Founder
   continuity requires a versioned offer, canonical paid activation and
   ordered paid-through/grace/termination evidence separate from current
   listening authorization.
7. They place PWA, three identity providers, root redirects, post-event upsell
   and autonomous social publishing in the first slice. None is required to
   prove that a person can subscribe and listen reliably.
8. They alternate between claiming an existing live 24/7 source and saying it
   still needs to be built. The initial operational origin is explicit in the
   runbook while the public product remains source-neutral.

## 5. MVP boundary

### Included

- The dedicated Listener hostname exposes the unified entry canonically at `/`:
  public sign-in followed by registered Free, controlled invitation or
  canonical Founder access.
- `/early-birds` and `/early-birds/home` are compatibility redirects during the
  namespace migration only.
- Google and Apple sign-in plus an optional passwordless email fallback through
  an exact, stable Better Auth version and the existing private mail authority.
- A separate EarlyBird account/session domain.
- Three hours of registered Free listening per personal fixed seven-day cycle,
  one-use signed invitations and canonical paid membership entitlements.
- A continuous, monitored stream from the approved long master.
- One unified transport: Beacon-only or a selected private ES/EN intro followed automatically by the live handoff; Stop controls the whole sequence.
- The Beacon fades in on every start/restart and stops over a short fade-out where the browser exposes media-element volume.
- Two-device lease enforcement; a third device evicts the oldest lease.
- Honest delivery state: ready, playing, reconnecting or unavailable, without
  making a public claim about the stream origin.
- Cancellation/revocation reflected without relying on a front-end redirect.
- ES/EN copy, privacy/terms, basic accessibility and mobile-browser acceptance.
- Metrics sufficient to know whether the stream is reachable and audible.

### Deferred

- Facebook sign-in and cross-provider account linking.
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
                                         |                 + optional private intro
                                         v
                                  external canary

Google/Apple OIDC --\
email magic link ----> EarlyBird account/session ---> EarlyBird web routes
                           |
                           v
membership authority <--- Free invites / PayPal / MercadoPago / future stores
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

The preview address is `earlybirds-staging.harmonicbeacon.com`; the dedicated
media origin is `stream.harmonicbeacon.com`. Both need DNS/TLS before external
acceptance, but local and ZeroTier validation do not wait for DNS.

For final production, the code may live in the main app after acceptance, but
the stream origin remains independently restartable and resource-bounded. Data
models are additive and a rollback can hide EarlyBird routes without rolling
back event data.

## 7. Continuous stream contract

The stream is a shared platform service, even though EarlyBirds is its first
consumer.

### 7.1 Source and artifacts

- The WAV master at
  `/home/nicolas/Music/beacon/luz_de_manana_20260624-155633_2hs.wav` is immutable
  and identified by a recorded SHA-256.
- Conversion never overwrites the master.
- A reproducible command creates a versioned delivery artifact.
- The derivative records codec, bitrate, sample rate, channels, loudness/peak
  measurements, encoder version and checksum.
- Nico approves the derivative by A/B listening before it becomes a candidate.
- Every intro master follows the same provenance and explicit listening-approval process separately.

### 7.2 Delivery shape

The first technical spike will use a buffered HTTP streaming protocol rather
than WebRTC for this one-way, long-running source. The working default is HLS:
it is buffer-friendly, cacheable, scales independently of the event SFU and can
later be consumed by both Listener and event clients.

The current Listener delivery format was selected through the audio ladder and
explicitly approved by Nico for this isolated product: AAC-LC 320 kbps, 48 kHz,
stereo. The approved immutable Beacon and ES/EN intro artifacts and their
checksums are recorded in the media-provenance runbook. Any future codec,
bitrate, sample-rate, channel, gain or dynamics change remains an audio-touching
decision requiring the same comparison and explicit approval.

Encoding is deliberately excluded until Nico approves a candidate. Once an
artifact is approved, the steady state is:

1. encode the approved master once;
2. generate immutable six-second segments once;
3. derive the apparent live edge from a fixed UTC epoch, without a continuously
   advancing publisher process or another lossy encode;
4. serve a short manifest whose media sequence follows that deterministic edge;
5. expose health, current source, media sequence and last-output timestamp.

All listeners hear approximately the same wall-clock position in the 24/7
Beacon stream. Intro progress remains private and local. Origin restart
must preserve the same epoch and live edge; a new epoch is a versioned artifact
promotion, never an accidental restart side effect.

### 7.3 Access and truthfulness

- The public page does not expose a durable unrestricted media URL.
- The private player obtains a short-lived signed stream authorization after a
  current membership check.
- The browser keeps one stable same-origin lease-manifest URL. Each refresh
  rechecks session, membership and device lease before proxying a fresh signed
  origin manifest, so authorization refresh never replaces the media source.
- The manifest embeds individually signed segment URLs; signatures cover HTTP
  method, canonical path and expiry, are compared in constant time and are
  never logged.
- Expiry and refresh do not interrupt healthy playback unnecessarily.
- The UI says "continuous Beacon stream" and does not claim whether the source
  is an instrument, a file or another origin.
- Delivery state comes from the same origin state that drives playback.

### 7.4 Reliability acceptance

- One immutable artifact version and UTC epoch are active.
- The master loops without an audible speed change, channel collapse or
  duplicate overlap.
- Restart and reconnect recover without manual browser reload.
- A canary fetches manifests and decodes actual audio, not only HTTP 200.
- A 60-minute human listen on desktop and physical iOS/Android devices has no
  unexplained gaps, speed shifts or route changes.
- Stream failure cannot consume resources needed by an event and has a
  one-command stop/rollback.
- At 450 kbit/s budgeted egress per listener, 3,000 concurrent listeners are
  the committed envelope with 40% network headroom; 4,000 triggers expansion
  and 5,000 is critical. Actual NIC throughput, packet loss/retransmits, origin
  latency/errors, CPU, memory, disk, manifest age and decoded-audio canary state
  are the scaling truth.

The current `mona` planning baseline is OVH VPS-4: 8 vCPU, 24 GB RAM, 200 GB
storage and up to 3 Gbit/s network. That headline rate is not a guarantee, so
promotion depends on measured soak evidence. Bunny CDN is preconfigured but
stays out of the delivery path until the network expansion threshold or an
origin-quality trigger is reached.

Prometheus scrapes node-exporter, cAdvisor, the private stream metrics listener
and an external canary. Alertmanager sends only operational metadata to the
private `Harmonic Beacon · Ops` Telegram group: warnings are grouped and repeat
hourly; critical alerts send immediately and repeat every 15 minutes; recovery
notifications are mandatory. Public health is minimal and `/metrics` is never
exposed on the public listener origin.

## 8. Listener player contract

The player starts from the simplest path shown to reproduce clean audio in prior
testing: native HLS on Safari and `hls.js` where Media Source Extensions are
required. Web Audio, realtime mixing and a crossfader are outside this milestone.

- Playback begins only after an explicit user gesture.
- First use defaults to the matching-language intro and remembers the person's
  last local choice; Beacon-only remains available if an intro fails.
- The Beacon source and lease are prepared before intro controls are enabled;
  the click starts both media elements inside the same user gesture for iOS.
- Starting, pausing, seeking, restarting or finishing an intro does not
  reconnect, pause, seek or restart the Beacon stream.
- Intros expose familiar play, pause, timeline/seek and restart controls.
- Intro position is private to the Listener and is never synchronized with
  another Listener.
- Each intro is an offline reviewed render. Its controls never move the 24/7
  Beacon timeline, which remains muted underneath; pausing produces silence.
- A genuine natural end reveals the already-playing Beacon. Browsers with
  writable element volume use an equal-power three-second fade that follows
  live volume changes. iOS uses a non-overlapping native unmute because its
  media-element volume is not script-writable; no Web Audio path is introduced.
- Starting or stopping an intro cannot reconnect or replace the underlying Beacon stream.
- A hidden or locked phone behaves honestly; the UI does not claim playback
  while the browser has suspended it.
- No camera, microphone, chat, hands, tapestry or event presence is created.
- A Listener connection does not count as an event LiveKit participant.

The media test ladder is mandatory and intentionally incremental:

1. master file in a standard player;
2. approved derivative in a standard player;
3. stream in a standard browser player;
4. stream in the EarlyBird player;
5. approved ES intro and handoff to the current stream edge;
6. approved EN intro and handoff to the current stream edge.

A failure at one level is fixed there before testing the next.

### 8.1 Listener presentation isolation

Listener components never consume the event visual primitives
(`event-shell`/`event-button`/`event-alert`/`event-field`); they use additive
`.listener-*` mirrors in `src/app/globals.css` so future event UI changes
cannot restyle Listener surfaces (issues #213, #198). The `.event-*` rules
remain untouched for event pages. Automated evidence:

- `src/components/early-birds/__tests__/listener-visual-isolation.test.tsx` —
  representative public/access Listener branches render `.listener-*`
  classes, error states use the styled
  `listener-alert--danger`/`listener-alert--error` variants, and the access
  card keeps one contextual primary action. Source inspection confirms no
  borrowed event visual primitive remains in Listener components.
- `e2e/tests/early-birds-responsive.spec.ts` — Spanish and explicit English
  browser-language paths, ≥ 44 px touch targets on real Listener controls,
  the reduced-motion path without nonessential looping animation, exactly one
  enabled primary transport action in the ready state, and no media elements
  or artifact requests on the public pre-access surface.

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

Google and Apple use Authorization Code with PKCE, state and nonce. Email uses
a verifier-only, short-lived, single-use link delivered by the existing mail
authority. No provider
access/refresh token is stored unless a later feature proves it necessary.
Provider subject is the primary external identity; verified email is contact
evidence, not a mutable authorization key. Cross-provider account linking is
disabled for the milestone.

Better Auth is pinned exactly to `1.6.26` and uses separate
EarlyBird models, routes and cookie. Its session never upgrades into an event or
staff principal. The retired NextAuth beta is not reintroduced.

## 10. Membership and commerce contract

`proyecciones-mito` remains the canonical membership/commerce authority. The
web app does not infer access from a provider success page and does not create a
parallel webhook truth. Free, PayPal, MercadoPago and future app-store grants
all project into the same provider-neutral contract.

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

Free invitations are single-use signed grants, scoped to EarlyBirds, auditable,
revocable and valid indefinitely until consumed or revoked. They work in
staging and production. Upgrading Free to paid consumes the free grant so two
independent memberships cannot remain active.

"Founder price locked for life" means for the uninterrupted lifetime of the
Founder service, not for the lifetime of the account. It is a versioned USD
5/month continuity state recording amount/currency, canonical activation and
the current paid/grace boundary. A pending voluntary cancellation preserves
access through paid-through time and may be reversed before that boundary
without losing Founder status. Once service ends, eligibility ends permanently
and a later signup uses the current public offer. Involuntary payment failure
receives 14 days of grace. Terminal failure, refund, chargeback, dispute, fraud
or administrative termination removes access and Founder status; the browser
cannot invent or erase that commercial evidence.

PayPal and MercadoPago both implement the same contract. MercadoPago charges an
ARS equivalent derived from the BCRA A3500 reference rate, locks the renewal
amount 72 hours before collection, displays both USD 5 and the locked ARS
amount, and retains the previous valid amount when the rate source is
unavailable. No provider is enabled for real EarlyBird charges until Nico
approves the exact offer and its sandbox lifecycle passes end to end.

Activation is intentionally sequenced. The first usable EarlyBirds release is
Free-only and must pass human acceptance, revocation and reconciliation before
either paid provider is enabled. PayPal and MercadoPago may be implemented and
tested behind disabled provider flags, but no paid checkout is exposed merely
because its adapter exists. Google Play and Apple App Store distribution and
billing are deferred beyond this MVP; a future store adapter must project into
this same authority instead of creating app-specific membership truth.

The product is for all audiences. The service requests only the account and
payment information required for the selected access path and does not create
age-specific profiles.

### 10.1 Vendored contract status

The webapp vendors byte-exact copies of the canonical backend contracts under
`contracts/` and verifies them with `npm run contract:early-birds:verify`:

- `contracts/early-bird-authority/v3` and `contracts/early-bird-membership/v2`:
  the current atomic membership plus Founder-continuity read/push contracts.
- `contracts/early-bird-authority/v1`, `contracts/early-bird-authority/v2` and
  `contracts/early-bird-membership/v1`: historical artifacts only; runtime does
  not dual-read or dual-write the retired positive-only semantics.
- `contracts/early-bird-checkout/v2`: the Mercado Pago checkout command for
  `POST /api/internal/v2/early-bird-checkouts`, vendored byte-exact from
  backend implementation `e5e638a78d5e835bfb3cfa7be69740f0003ffb01`, merged
  as `82b4b58a661a9aa7b8979e0f2fb88a07af31b394`
  (SairaAsua/proyecciones-mito#57). Its opaque account ID now matches the
  runtime authority contract instead of requiring an unused prefix. The
  provider remains TEST-only and disabled by default; the checkout surface is
  exact-host staging-only and absent from the public Listener edge.
  The canonical Founder price and all shared contract bytes advanced to USD 5
  in backend PR #59 / `cad4eded2e08ee46da49e54ee94e1ab8601d9495`.
  Mercado Pago TEST has since passed real browser checkout, canonical activation,
  pause/reactivation and fresh reconciliation without enabling Live credentials.
- `contracts/listener-checkout/v1`: the production-only, provider-neutral
  checkout command/result. It exposes no provider subscription ID, fixes
  `environment=live`, keeps payer email transient and uses a separate new-sales
  gate from provider lifecycle. The deployed authority runtime
  `b1038ddb579817e39add567c5b7b055e2f716095` is CI-green, includes canonical
  cancellation/reactivation, paid-lifecycle metrics and reviewed Mercado Pago adverse-event
  hardening, and is the minimum authority binary after any Live checkout attempt. The Listener Live
  surface and exact webhook ingress remain disabled by default;
  see `docs/operations/FOUNDING_LISTENER_COMMERCIAL_LAUNCH.md`.
  This authority release also provides a read-only, redacted Live-provider
  preflight for exact PayPal catalog/webhook and Mercado Pago merchant checks;
  productive credentials remain absent and all Live flags remain OFF.

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

### Batch A — contracts, isolated preview and deterministic origin

- add the isolated compose/runtime boundary;
- inventory and checksum the master;
- inventory the master and define (but do not select) the reproducible artifact pipeline;
- implement deterministic manifests, signed immutable-segment delivery and two-plane health/metrics;
- install Prometheus, node-exporter, cAdvisor, Alertmanager and an external decoded-audio canary;
- route grouped/repeated warning, critical and recovery notices to the dedicated
  private Telegram group `Harmonic Beacon · Ops` once its bot credentials exist;
- add a bare private test player and canary;
- execute the audio test ladder through streamed standard playback.

Exit: the 24/7 source survives restart and a 60-minute cross-device
listen, with no event service or current audio file changed.

### Batch B — Listener vertical slice with synthetic Free entitlement

- create isolated EarlyBird data models and session cookie;
- build bilingual public page and private home;
- use a development-only synthetic entitlement fixture;
- add Beacon-only player, intro selection, standard controls and live-edge handoff;
- enforce two active device leases and oldest-lease eviction;
- prove that no event connection/capability is created.

Exit: the team can use the complete listening experience in preview without a
payment provider.

### Batch C — identity and provider-neutral membership

- approve the identity ADR;
- implement Google and Apple sign-in plus optional email magic-link request,
  callback, session/revocation and logout;
- keep account linking disabled and test duplicate-email isolation;
- implement signed one-use Free invitations and the canonical membership projection;
- run positive and negative auth tests in preview.

Exit: a returning test Listener reaches the same isolated account and cannot
cross into event/staff privileges.

### Batch D — Free release candidate, then disabled paid-provider readiness

- agree the versioned commerce contract with Mariano/Sai;
- extend the commerce sandbox for the EarlyBird offer;
- consume canonical membership state in the app;
- complete Free-only human acceptance before exposing any paid checkout;
- test create, duplicate webhook, out-of-order event, retry, renewal failure,
  grace, cancellation, refund and revoke;
- reconcile stale/missing delivery.
- implement MercadoPago/BCRA rate lock and failure semantics through the same contract;
- approve terms, privacy, all-ages offer copy and source wording;
- expose the public no-login **BOTÓN DE ARREPENTIMIENTO**, return an opaque
  receipt immediately and process its private durable queue within 24 hours;
- complete accessibility/mobile/audio/security acceptance;
- run sustained origin/canary test and failure rehearsal;
- verify backups, observability, stop switch and rollback;
- merge current `main` into `early-birds` and resolve conflicts;
- run the release checkpoint once.

Exit: a documented Free-only go/no-go decision and a separate paid-provider
readiness decision. Production and every paid provider remain off until each is
explicitly approved.

## 13. Definition of done for the EarlyBirds milestone

- A Listener can sign in, obtain a canonical sandbox membership and listen.
- The initial source is continuously delivered while public copy remains
  source-neutral.
- Beacon-only and every published intro language pass physical-device listening.
- No Listener gains event/staff capabilities or creates event media connections.
- Duplicate/reordered commerce events cannot duplicate or incorrectly preserve
  access.
- Revocation becomes effective within the agreed propagation window.
- Origin, app and commerce dependencies have useful health/alert signals.
- A dedicated Telegram operations group receives warning, critical and recovery
  notifications without PII or secrets.
- The isolated load/soak evidence supports the 3,000-listener committed envelope
  or records a lower measured limit before launch; 4,000/5,000 thresholds and
  the Bunny CDN expansion switch are rehearsed.
- The entire EarlyBird feature can be disabled without rolling back weekend
  event code or data.
- Current event tests remain green at final convergence.
- Runbook includes launch, pause, source replacement, incident and rollback.
- Public sales remain closed until the consumer-withdrawal route, dedicated
  secret, queue migration and operator runbook are deployed and smoke-tested.

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

## 15. Frozen decisions

The earlier USD 2 value was an unreleased experiment. There are no real subscribers to migrate or
grandfather, so the USD 5 migration replaces it rather than introducing a second offer. After that
forward-only migration is applied, operational rollback is provider kill-switch plus roll-forward;
an older USD 2 binary is not a valid rollback target.

| ID | Accepted decision |
|---|---|
| D1 | `EarlyBirds` remains the implementation branch/milestone; public Listener is `listen.harmonicbeacon.com/`, staging migrates to `listen-staging.harmonicbeacon.com`, legacy `/early-birds` paths redirect during cutover, and origin remains `stream.harmonicbeacon.com`. |
| D2 | USD 5/month founder offer while service remains uninterrupted; pending cancellation retains access and price only through paid-through and can be reversed before service ends; once service ends, later signup uses the then-current public price; 14-day involuntary grace; terminal failure/refund/chargeback/dispute/fraud/admin termination removes access and Founder status. |
| D3 | Google and Apple through exact stable Better Auth, plus an optional passwordless email magic-link fallback through the existing private mail authority; no Facebook and no implicit account linking. |
| D4 | Provider-neutral Free, PayPal and MercadoPago grants; Free is single-use, signed, auditable, revocable and consumed by paid upgrade. |
| D5 | Source-neutral “continuous Beacon stream” wording; never claim whether the source is an instrument, a file or another origin. |
| D6 | Each authored Amara Sol offline mix is immutable and separately approved; the English intro is the currently approved and published default. |
| D7 | Deterministic UTC HLS, immutable six-second segments, signed paths, native Safari and `hls.js`; current approved delivery is AAC-LC 320 kbps, 48 kHz stereo and any later encoding change requires explicit audio approval. |
| D8 | Two device leases; third device evicts oldest. |
| D9 | Main app after final convergence; independently bounded stream origin; additive models and kill switch. |
| D10 | One shared wall-clock Beacon timeline; every intro has private play/pause/seek/restart controls and hands off to the current live edge. |
| D11 | Capacity targets 3k committed, 4k expansion and 5k critical at a 450 kbit/s planning budget with 40% headroom. |
| D12 | All-audiences experience: an adult owns account/payment; no minor profile or minor data. |
| D13 | Release sequence is Free acceptance first, then separately approved PayPal/MercadoPago activation; Google Play/App Store wrappers and billing are post-MVP. |
| D14 | Ordinary Free requires Listener registration and grants three hours per personal fixed seven-day cycle. The cycle begins at the first real authorized Free playback, has no base rollover, is calculated from server time, and meters the union of the account's active listening leases once. Intros and Beacon count; Stop, disconnect and lease expiry bound consumption. Active canonical membership/invitation and the Free for All override are unlimited and non-metered. |

## 16. Card map

Create milestone `EarlyBirds` and use these non-overlapping delivery cards:

1. EB-00 — freeze product, identity, membership, media and Fast Forward ADRs.
2. EB-01 — immutable media inventory, reproducible candidate pipeline and deterministic HLS origin.
3. EB-02 — resource isolation, observability, Telegram alerts, capacity model, canary and stop switch.
4. EB-03 — Google/Apple/email identity and isolated Listener sessions.
5. EB-04 — provider-neutral membership and one-use Free invitations.
6. EB-05 — bilingual Listener UX, two-device leases, private ES/EN intros and live-edge handoff.
7. EB-06 — PayPal sandbox lifecycle and reconciliation, disabled until Free acceptance and explicit activation approval.
8. EB-07 — MercadoPago/BCRA pricing, lock and failure lifecycle, disabled until Free acceptance and explicit activation approval.
9. EB-08 — staging, cross-device/audio acceptance, isolated load/soak and release/rollback rehearsal.
10. EB-09 — event-stream convergence investigation after the milestone (tracked
    separately and never implemented before explicit audio approval).

Track Google Play/App Store packaging and billing in a separate post-MVP card;
it must not block the Free release or silently replace EB-06/EB-07.

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
- The weekly-Free cutover is forward-only after its additive migration: an
  incident response stops Listener/uses the kill switch and rolls forward a
  repair. It never restores the retired daily-schedule or welcome-access
  authorization rules.
- After the first Live checkout attempt, payment-authority rollback is also forward-only:
  `b1038ddb` is the minimum supported binary. Stop new sales with flags, keep provider lifecycle
  ingestion and the current database, reconcile, and roll forward. Never use a pre-cutover database
  restore as routine rollback.
- No secret, provider token, raw webhook payload with PII or customer record is
  committed or logged publicly.
- No synthetic test writes to real participant or payment data.
- Final migrations are additive; rollback disables readers/writers before any
  later cleanup migration.
- Audio artifacts are immutable and reversible by version pointer, never by
  overwriting the approved previous file.
