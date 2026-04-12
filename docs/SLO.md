# Service-Level Objectives and the Covenant of Continuity

*Draft · 2026-04-12 · author: product design, pending validation*

Authoritative rules live in [BUSINESS_RULES.md §8](../BUSINESS_RULES.md). This document is the operational target: what continuous availability of the beacon means in practice, how we measure it, what we commit to, and what happens when we fall short.

---

## 1. The Covenant of Continuity

> *The beacon never goes dark.*

The public brand claim is that Harmonic Beacon is a 24/7 instrument. A product that promises constancy and fails to deliver it gets read as a broken promise, not a technical glitch. This covenant is how we hold ourselves accountable to that claim, and how we design the system so that it stays true even as load grows.

The covenant has two parts:

1. **Continuous audibility** — a Listener who opens the app at any hour hears the beacon within seconds, at acceptable quality, regardless of source state.
2. **Transparent source state** — whatever they are hearing (live source, warm standby, fallback), the UI tells the truth about it.

The second part matters as much as the first. A Listener who hears the fallback and thinks it's live is being deceived; a Listener who knows the beacon is in transit and stays anyway is participating in the same honest instrument we promised them.

---

## 2. Service levels at launch

These are the targets for Phase 1 (post-Credibility launch). They are deliberately conservative — we do not publish a number we can't meet today.

| Metric | Target | Measurement window | How measured |
|---|---|---|---|
| Beacon audibility (any source) | 99.5% | 30-day rolling | External canary listener / minute probes |
| Beacon **live-source** availability (i.e. not fallback) | 95.0% | 30-day rolling | Source-state logs |
| Web app availability (login + core flows) | 99.5% | 30-day rolling | External HTTP probe |
| Mobile app crash-free sessions | 99.5% | 30-day rolling | Crash reporter |
| Moderation review SLA | 5 business days | per submission | Review timestamp |
| Abuse-report acknowledgement SLA | 24 hours | per report | Acknowledgement timestamp |
| Incident postmortem publication | 14 days post-resolution | per incident ≥ S1 | Public incidents page |

The headline metric — the one we print on the status page — is **beacon audibility**, not live-source uptime. That's the Covenant restated in SLO terms.

---

## 3. Source hierarchy

The audio the Listener hears is sourced through a documented fallback chain. At any moment, the stream is from exactly one of these:

1. **Live primary** — `beacon01` WebRTC publisher on `wss://live.altermundi.net`, room `beacon`. Expected source ≥ 95% of the time.
2. **Live secondary (warm standby)** — a second participant with the identity `beacon02` (Phase 1 planned), publishing the same content from a different upstream. Takes over if `beacon01` disconnects for more than N seconds (N tuned; default 30).
3. **Playlist fallback** — the `services/playlist-bot` service (already in the repo), publishing pre-curated continuous audio when both live sources are absent. Takes over automatically; UI surfaces "Beacon in transit" state.
4. **Offline degraded** — if even the fallback cannot publish, the client plays a locally-cached last-30-seconds loop while retrying in the background, for up to 5 minutes, then surfaces an outage state with a link to the status page.

The transition from state to state is visible to the Listener. We never label a state as something it isn't.

---

## 4. What counts as "beacon dark"

- Audibility is zero if **no** source in the hierarchy is producing audible audio to the Listener.
- A source switch within the hierarchy is **not** "dark"; it is a source transition, logged but not counted against audibility.
- A live-source degradation (beacon01 down, fallback active) is counted against live-source availability but not against audibility.
- A client-side playback failure (Listener's network down) is not counted as our outage, but we measure it separately for product-health reasons.

---

## 5. Error budget and consequences

A 99.5% monthly audibility target gives us a monthly error budget of ~3.6 hours.

**When we are inside budget:** normal change velocity. Continue shipping.

**When we exceed 50% of the monthly budget in a rolling week:** the on-call operator can pause non-critical releases until the budget recovers.

**When we exceed 100% of the monthly budget:** a mandatory release freeze on anything touching the beacon pipeline. Root-cause analysis first, then resume.

**When we exceed budget for two months in a row:** a root-cause meeting including an honest answer to *is the current architecture the right one*. This is the trigger for the Phase 3+ scale work.

---

## 6. Architecture evolution under the covenant

The covenant shapes the roadmap. Continuity work is not deferred past launch.

### Phase 1 (Credibility)

- Deploy the warm-standby upstream (`beacon02`) so no single upstream machine can take the beacon dark.
- Tune the playlist-fallback switchover (already implemented) for a smooth < 10-second handover.
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

A public status page at `status.harmonicbeacon.com` (or equivalent) showing:

- Current beacon source state.
- 30-day audibility number.
- Current incident, if any.
- History of incidents with severity and resolution.
- Subscription option for updates (email-only; no SMS until we're confident with it).

The status page is served from infrastructure separate from the main app, so that a main-app outage doesn't also take down the page reporting it.

---

## 8. Client contract

The SLO is a system property; much of it depends on client behaviour. Clients must:

- Retry transient failures with exponential backoff (base 1s, max 15 min).
- Transparently refresh tokens without surfacing an error on the first attempt.
- Distinguish source states in the UI (live / standby / fallback / retrying / offline).
- Cache at least 30 seconds of audio locally for short-gap continuity.
- Report degradation telemetry to the platform for visibility.

These are enforced in code review; the docs of each client describe how they implement the contract.

---

## 9. Observability

To meet these targets we must see them. Baseline observability (Phase 1):

- **Structured logs** with a consistent field set (request ID, user ID or anonymous token, route, latency, status).
- **Metrics** for audibility (probe results), source state transitions, token fetches, WebRTC ICE failures, moderation queue depth, error rates.
- **Traces** for cross-service request flows (app ↔ go2rtc, app ↔ LiveKit, app ↔ DB).
- **Errors** captured by Sentry with sourcemaps.
- **Uptime** from an independent external monitor.
- **Alerts** routed to the on-call pager, with documented runbooks per alert.

"Observability is a feature, not a backstage concern." This is principle 11 in [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md).

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

- SLO numbers are reviewed quarterly. Tightening is easy (we met the target for two consecutive quarters → raise it); loosening requires public disclosure.
- Incidents of severity ≥ S1 each produce a postmortem that may recommend SLO changes; changes go through the quarterly review, not reactively.
- The covenant itself is not subject to review; if we ever move away from the promise "the beacon never goes dark", it is a brand decision, not an ops decision, and will be announced in public.
