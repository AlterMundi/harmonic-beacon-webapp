# Service-Level Objectives and the Covenant of Continuity

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet). A present-tense
> statement in this document is a claim about code that exists today; if you find
> one that is not, that is a bug in this document.
>
> This document is the corpus's densest concentration of numbers, and a number is
> an obligation once published. **No target below is measured today** — the
> measurement apparatus is Phase 1 work (§9). Read every figure as a target we
> intend to hold ourselves to, not a track record.

*Draft · 2026-04-12 · author: product design, pending validation*

Authoritative rules live in [BUSINESS_RULES.md §8](../BUSINESS_RULES.md). This document is the operational target: what continuous availability of the beacon means in practice, how we measure it, what we commit to, and what happens when we fall short.

---

## 1. The Covenant of Continuity

> *The beacon never goes dark.*

The public brand claim is that Harmonic Beacon is a 24/7 instrument. A product that promises constancy and fails to deliver it gets read as a broken promise, not a technical glitch. This covenant is how we hold ourselves accountable to that claim, and how we design the system so that it stays true even as load grows.

It is a covenant and not a warranty. The audibility target in §2 is 99.5%, which permits roughly 3.6 dark hours a month; the sentence above and that number have to be read together, and §4 defines exactly what "dark" means. Terms of Service govern availability and disclaim it; this line governs intent. The risk the covenant carries is the absolute sentence travelling without its definition — into a press quote, an app-store description, a pitch deck — where it stops being a statement of intent and starts being a representation about performance. Wherever it appears on a public surface it is paired with the audibility number and a link to where that number is reported. **[Planned — Phase 1]** *(the reporting surface; see §7)*

The covenant has two parts:

1. **Continuous audibility** — a Listener who opens the app at any hour hears the beacon within seconds, at acceptable quality, regardless of source state.
2. **Transparent source state** — whatever they are hearing (live source, warm standby, fallback), the UI tells the truth about it. `/live` shows **LIVE**, **PLAYLIST** or **OFFLINE**, derived from the same participant presence that drives the audio switching, so the badge changes with the source rather than lagging behind it.

The second part matters as much as the first. A Listener who hears the fallback and thinks it's live is being deceived; a Listener who knows the beacon is in transit and stays anyway is participating in the same honest instrument we promised them.

What is not yet distinguished is the *middle* row of the chain in §3. A warm standby would be a second live source, and the current badge has no state for it — it would read LIVE, which is arguably correct but loses the distinction this section claims. That resolves itself when `beacon02` exists; there is nothing to distinguish today. **[Planned — Phase 1]** *(the standby state, not the badge)*

---

## 2. Service levels at launch

These are the targets for Phase 1 (post-Credibility launch). They are deliberately conservative — we do not publish a number we can't meet today. The corollary, which the table below now states rather than implies: we also do not publish a number we cannot *measure* today, and today that is all of them. The right-hand column is what each will be measured by, not what any is measured by. **[Planned — Phase 1]**

| Metric | Target | Measurement window | To be measured by |
|---|---|---|---|
| Beacon audibility (any source) | 99.5% | 30-day rolling | External canary listener / minute probes |
| Beacon **live-source** availability (i.e. not fallback) | 95.0% | 30-day rolling | Source-state logs |
| Web app availability (login + core flows) | 99.5% | 30-day rolling | External HTTP probe against the liveness endpoint |
| Mobile app crash-free sessions | 99.5% | 30-day rolling | Crash reporter **[Planned — Phase 3]** *(no mobile client exists)* |
| Moderation review SLA | 5 business days | per submission | Review timestamp |
| Abuse-report acknowledgement SLA | 24 hours | per report | Acknowledgement timestamp |
| Incident postmortem publication | 14 days post-resolution | per incident ≥ S1 | Public incidents page |

Two rows have part of their apparatus already. Web app availability has something to probe: `/api/health` answers liveness without touching the database, `/api/health/ready` answers readiness with a bounded database check, and the app container's health check calls the first of the two. What is missing is a prober *outside* the host — a container health check cannot report an outage that takes the host with it, which is the outage that matters most here. Moderation review has the data: `Meditation.reviewedAt` is written on approval, so the submission-to-review interval is recoverable from the database whenever someone builds the query. Every other row needs apparatus that does not exist: there is no canary listener, no source-state logging, no crash reporter, no report model to timestamp an acknowledgement on ([TRUST_AND_SAFETY.md §2.5](./TRUST_AND_SAFETY.md)), and no incidents page to publish to (§7).

The headline metric — the one we will print on the status page — is **beacon audibility**, not live-source uptime. That's the Covenant restated in SLO terms.

---

## 3. Source hierarchy

The audio the Listener hears is sourced through a documented fallback chain. Two of the four levels below exist; the chain in production is live primary → playlist fallback, and nothing catches the case where the fallback is also gone.

1. **Live primary** — `beacon01` WebRTC publisher on `wss://live.altermundi.net`, room `beacon`. Expected source ≥ 95% of the time.
2. **Live secondary (warm standby)** — a second participant with the identity `beacon02`, publishing the same content from a different upstream, will take over if `beacon01` disconnects for more than N seconds (N tuned; default 30). `beacon02` exists nowhere in code. **[Planned — Phase 1]**
3. **Playlist fallback** — the `services/playlist-bot` service (already in the repo), publishing pre-curated continuous audio when the live source is absent. Takes over automatically. The UI will surface a "Beacon in transit" state; per §1 it does not yet. **[Planned — Phase 1]** *(the UI, not the switchover)*
4. **Offline degraded** — if even the fallback cannot publish, the client will play a locally-cached last-30-seconds loop while retrying in the background. At **5 minutes** it stops covering for the outage and says so: an outage state with a link to the status page. It keeps retrying behind that message, with backoff, to a total of **15 minutes**, after which it gives up and the state becomes terminal, with a manual retry. See §8 for why both numbers are in the contract. Nothing of this is implemented: there is no local cache, no retry loop, no outage state, and no status page to link to. **[Planned — Phase 1]**

The transition from state to state will be visible to the Listener. We never label a state as something it isn't — but note that saying nothing at all, which is what the client does today, is how a Listener ends up believing the fallback is the live beacon.

---

## 4. What counts as "beacon dark"

These definitions are the ones the numbers in §2 will be computed against, once something computes them. Nothing counts anything today.

- Audibility is zero if **no** source in the hierarchy is producing audible audio to the Listener.
- A source switch within the hierarchy is **not** "dark"; it is a source transition, to be logged but not counted against audibility. No source-transition log exists. **[Planned — Phase 1]**
- A live-source degradation (beacon01 down, fallback active) counts against live-source availability but not against audibility.
- A client-side playback failure (Listener's network down) is not counted as our outage. We will measure it separately for product-health reasons; no client telemetry exists. **[Planned — Phase 1]**

---

## 5. Error budget and consequences

A 99.5% monthly audibility target gives us a monthly error budget of ~3.6 hours.

An error budget is a consequence attached to a measurement, so none of the four rules below can fire until §9 exists — there is no budget to be inside or outside of. They are the policy that takes effect with the measurement, and the on-call operator they refer to is the Phase 2 role in [TRUST_AND_SAFETY.md §6.3](./TRUST_AND_SAFETY.md). **[Planned — Phase 1]**

**When we are inside budget:** normal change velocity. Continue shipping.

**When we exceed 50% of the monthly budget in a rolling week:** the on-call operator can pause non-critical releases until the budget recovers.

**When we exceed 100% of the monthly budget:** a mandatory release freeze on anything touching the beacon pipeline. Root-cause analysis first, then resume.

**When we exceed budget for two months in a row:** a root-cause meeting including an honest answer to *is the current architecture the right one*. This is the trigger for the Phase 3+ scale work.

---

## 6. Architecture evolution under the covenant

The covenant shapes the roadmap. Continuity work is not deferred past launch.

### Phase 1 (Credibility)

- Ship the source-state UI, so the Listener knows which source they are hearing. It is listed first because it is the smallest piece and the only one that changes an honesty problem rather than a reliability one.
- Deploy the warm-standby upstream (`beacon02`) so no single upstream machine can take the beacon dark.
- Instrument the playlist-fallback switchover (already implemented) and *then* set a handover target from what the measurement shows. Earlier drafts of this document named a "< 10-second" bound; the bot publishes on disconnect events with no tuning against any bound, nobody has timed it, and the figure appears nowhere in code. It is not restated here — a published handover number should come out of a measurement, not into one.
- Add the status page with live audibility number.
- External uptime monitor with pager integration.
- Backup/restore drill for Postgres documented and demonstrated.

### Phase 2 (Participation)

- Object-storage-backed uploads and recordings, so the host is not a data single-point-of-failure.
- CDN in front of static meditation audio.
- Database read replica for analytics reads; primary stays the single writer.
- Automated rollback on container health check failure.

### Phase 3 (Mobile/Research GA)

- Multi-region fallback (read-only) — a second LiveKit server in a different geography the client can connect to if the primary is unreachable.
- Regional playlist-bot instances near the Listener.
- Graceful-degradation chaos drills (quarterly).

### Phase 4+ (Constellation)

- The Constellation (community-run local beacons) is itself a long-term continuity answer: no single operator is a single point of failure for the whole experience if the protocol can route to a functioning node.

---

## 7. Status page

> **There is no status page.** The address below is not live and should not be
> printed anywhere until it is. Several commitments elsewhere in the corpus route
> through this page — the public audibility number (§2), the outage state's link
> (§3), the incidents feed in
> [TRUST_AND_SAFETY.md §7](./TRUST_AND_SAFETY.md) — so it is load-bearing well
> beyond its own section. **[Planned — Phase 1]**

A public status page at `status.harmonicbeacon.com` (or equivalent) will show:

- Current beacon source state.
- 30-day audibility number.
- Current incident, if any.
- History of incidents with severity and resolution.
- Subscription option for updates (email-only; no SMS until we're confident with it).

The status page will be served from infrastructure separate from the main app, so that a main-app outage doesn't also take down the page reporting it.

---

## 8. Client contract

The SLO is a system property; much of it depends on client behaviour. Clients will:

- Retry transient failures with exponential backoff (base 1s), for a total of no more than 15 minutes, and tell the Listener the beacon is unavailable once 5 minutes have passed without a connection — see the two windows below.
- Transparently refresh tokens without surfacing an error on the first attempt.
- Distinguish source states in the UI (live / standby / fallback / retrying / offline).
- Cache at least 30 seconds of audio locally for short-gap continuity.
- Report degradation telemetry to the platform for visibility.

**No clause of this contract is implemented in the web client, and it is not enforced in code review.** There is no backoff logic, no local audio cache, no source-state UI and no degradation telemetry; token handling is whatever the LiveKit SDK does by default, which may or may not be a transparent refresh — nobody has checked, and "we did not write it" is not the same as "the SDK does it". An earlier draft of this line claimed code-review enforcement, which is the more damaging half of the error: a contract nobody implemented is a gap, but a contract asserted to be enforced is a reviewer's false assurance that it was. **[Planned — Phase 1]**

### 8.1 The two retry windows

The client has two clocks running during an outage, and they measure different
things. Both belong in the contract; neither replaces the other.

| Window | What elapses | What happens at the end |
|---|---|---|
| **5 minutes** | Time since the last successful connection | The client tells the Listener the beacon is unavailable — an outage state with a link to the status page (§7) |
| **15 minutes** | Total time spent retrying | The client stops retrying and the outage state becomes terminal, with a manual retry as the only way forward |

Between the two, the client is both retrying and honest: the message is on screen
while the backoff continues behind it. What the shorter window buys is the thing
the honesty posture in §1 exists for — five minutes of silence has a Listener
concluding their own device or network is broken, which is a worse outcome than
an outage they can see is ours. What the longer window buys is recovery without
anyone having to do anything, and quiet retrying is unobjectionable for as long
as nobody is left guessing during it.

Anything read as a single number is a misreading. Client implementations take
both. **[Planned — Phase 1]**

Each client's own docs will describe how it implements the contract, once one does.

---

## 9. Observability

To meet these targets we must see them, and today we do not see any of them. What exists is a liveness endpoint, a readiness endpoint that checks the database under a timeout, container health checks wired to both, and `console` logging that passes every raw error through a redactor before it is written ([TRUST_AND_SAFETY.md §2.6](./TRUST_AND_SAFETY.md)). That is enough to restart a wedged container. It is not enough to answer "what was audibility last month", and every target in §2 is unanswerable until the list below exists.

Baseline observability, all of it **[Planned — Phase 1]**:

- **Structured logs** with a consistent field set (request ID, user ID or anonymous token, route, latency, status).
- **Metrics** for audibility (probe results), source state transitions, token fetches, WebRTC ICE failures, moderation queue depth, error rates.
- **Traces** for cross-service request flows (app ↔ LiveKit, app ↔ DB). Earlier drafts listed app ↔ go2rtc in this set; meditation playback no longer takes that path, serving audio over plain HTTP with range requests instead, so go2rtc is not on a request flow worth tracing.
- **Errors** captured by an error reporter with sourcemaps.
- **Uptime** from an independent external monitor.
- **Alerts** routed to the on-call pager, with documented runbooks per alert.

"Observability is a feature, not a backstage concern." This is principle 11 in [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md). It is currently the principle this corpus is furthest from honouring — which is the whole reason for the banner at the top of this document.

---

## 10. Cost vs. continuity trade-off

Continuity costs money. A warm standby upstream, a second LiveKit SFU, a CDN — each adds monthly spend. We accept this. The covenant is more expensive than not having it, and we treat the cost as a first-order product investment, not a line item to cut when the budget tightens.

When we have to trade, we trade in this order:

1. Reduce feature velocity before reducing continuity.
2. Reduce paid-tier benefits before reducing continuity.
3. Reduce marketing spend before reducing continuity.
4. Reduce salaries (including founders') before reducing continuity.

This ordering is a commitment, not just an ops position.

---

## 11. Review

- SLO numbers will be reviewed quarterly. Tightening is easy (we met the target for two consecutive quarters → raise it); loosening requires public disclosure. The first review cannot happen until §9 makes "we met the target" a statement anyone can check; a quarterly review of unmeasured numbers is a meeting, not a control. **[Planned — Phase 1]**
- Incidents of severity ≥ S1 each produce a postmortem that may recommend SLO changes; changes go through the quarterly review, not reactively.
- The covenant itself is not subject to review; if we ever move away from the promise "the beacon never goes dark", it is a brand decision, not an ops decision, and will be announced in public.
