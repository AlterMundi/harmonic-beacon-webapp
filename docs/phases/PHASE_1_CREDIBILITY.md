# Phase 1 — Credibility

*Draft · 2026-04-12 · author: product design, pending validation*

**Duration**: ~8 weeks
**North star**: *we could let strangers in tomorrow and be proud, not embarrassed.*

Phase 1 is not glamorous. It is almost entirely the work of plugging the gaps that any unfamiliar visitor — a journalist, a potential patron, a potential institutional partner, a regulator, a hostile observer — would notice within ten minutes of arriving. None of this is new feature work; all of it is hygiene and foundation.

We do it first because the brand positioning demands it. A product that promises *decentralized science is real* cannot have "Privacy" as a non-link in its footer, empty legal pages, a placeholder landing site, and no visible uptime.

---

## 1. Scope of the phase

Seven workstreams, listed in order of brittleness (the first ones break the product most if we don't do them).

1. **Legal & policy** — published Privacy, Terms, Cookie Policy, Content Policy summary, mental-health disclaimer, consent scaffolding.
2. **Marketing site** — replace the Hostinger Horizons shell with a proper site that carries the Theory, Experience, Analysis, App, Download sections plus About, Team, Press, Contact, Trust.
3. **Observability** — Sentry, structured logs, uptime monitor, baseline metrics, audit log on admin & provider actions.
4. **Continuity** — `beacon02` warm standby upstream, status page, documented backup/restore drill.
5. **Infrastructure** — object storage for uploads and recordings, CDN in front of static audio, content-type and size validation at upload.
6. **Research scaffolding** — DB schema for consent and survey instruments, placeholder `/research` page, ethics-review engagement started (but no data collection yet).
7. **Accessibility & i18n** — WCAG 2.2 AA sweep on core flows, i18n infrastructure across the webapp (not the .com) with EN/ES content parity.

---

## 2. Deliverables by workstream

### 2.1 Legal & policy

- [ ] Privacy Policy (published at `/privacy`, reviewed by counsel)
- [ ] Terms of Service (published at `/terms`, reviewed by counsel)
- [ ] Cookie Policy (published at `/cookies`, paired with a compliant consent banner for EU)
- [ ] Content Policy public-facing summary at `/policy/content` (pulls from [CONTENT_POLICY.md](../CONTENT_POLICY.md))
- [ ] Community Guidelines at `/community` (short, voice-matching, covers scheduled sessions, reports, conduct)
- [ ] Mental-health disclaimer, visible at app entry and on Theory section: "Harmonic Beacon is not a medical device. It is not a substitute for professional care."
- [ ] Age gate at signup: affirmation of 18+ (policy choice to launch adults-only; under-18 product not yet in scope).
- [ ] Consent scaffolding (not yet collecting research data): the data model for `ConsentRecord` is in place so Phase 3 can slot into it.

Deferred to Phase 2 or later: individual marketing-communications consent (no newsletter yet at Phase 1).

### 2.2 Marketing site

The current `harmonicbeacon.com` is a Hostinger Horizons SPA shell that lives outside this repo. Phase 1 treats it as a separate project; either rebuild it as a server-rendered Next.js site under the same repo or migrate to a well-chosen static generator (Astro, Eleventy).

- [ ] Decide hosting target (same Next.js, separate Next.js, separate static generator)
- [ ] Server-rendered HTML with proper meta, OG tags, sitemap, robots
- [ ] Theory / Experience / Analysis sections carry the current copy (reviewed against the language constraints in [PRODUCT_PRINCIPLES.md §5](../PRODUCT_PRINCIPLES.md))
- [ ] New sections: About, Team, Press, Contact, Trust
- [ ] Footer links (Privacy, Terms, Cookies, Community) are real links
- [ ] Social links (Instagram, X or Mastodon, optionally Telegram) are claimed and linked; not functional if empty, we just hide them
- [ ] Language toggle functional (EN/ES), all pages localized
- [ ] Working *Login* button routing to `beacon.altermundi.net`
- [ ] Working *Download* buttons (link to TestFlight / Play Store internal test at minimum; real store listings come in Phase 3)

### 2.3 Observability

- [ ] Sentry (or equivalent) wired in Next.js app and Flutter app, with sourcemaps, PII scrubbing, release tracking
- [ ] Structured logging: JSON output with consistent field set (request ID, user ID, route, latency, status); pipeline to log store (Loki, Logtail, or equivalent)
- [ ] Metrics: baseline Prometheus-compatible exporters (app latency, error rate, moderation queue depth, source state transitions, LiveKit connection events)
- [ ] Alerts for: beacon dark > 1 min, error rate > 2% / 5 min, moderation queue > 20 pending > 3 days
- [ ] Audit log: append-only table for all Admin and Provider writes with actor, action, target, timestamp, before/after payload
- [ ] Runbook per alert

### 2.4 Continuity

- [ ] `beacon02` warm-standby upstream deployed (same source, different machine/publisher), auto-failover verified
- [ ] Playlist-fallback switchover timing tuned to < 10s handover
- [ ] Public status page live at `status.harmonicbeacon.com` (or subdomain), served from separate infra
- [ ] External canary listener probing every minute, feeding the audibility metric
- [ ] Postgres backup/restore drill documented and executed; RTO and RPO declared
- [ ] Secret rotation schedule documented in [TRUST_AND_SAFETY.md §6](../TRUST_AND_SAFETY.md) and executed once during the phase

### 2.5 Infrastructure

- [ ] Object storage (S3, R2, or equivalent) configured for `MEDITATIONS_STORAGE_PATH`, `UPLOADS_PATH`, `RECORDINGS_PATH` — moving off host-mount
- [ ] Migration plan for existing content (copy to object storage, switch paths atomically, keep host-mount as read-only backup for two phases)
- [ ] CDN in front of the object storage for public static audio, with signed URLs for patron-gated content
- [ ] Upload pipeline: MIME validation, size cap enforcement, basic antivirus / sanity scan, audio fingerprinting stub (for Phase 2+)
- [ ] Signed-URL issuer endpoint for patron content (used by Phase 2)
- [ ] Nginx rate-limits on authentication endpoints, CAPTCHA on signup

### 2.6 Research scaffolding

- [ ] `ConsentRecord`, `ResearchParticipant`, `SurveyInstrument`, `SurveyResponse` models in Prisma, with migrations
- [ ] `rpid` (research participant ID) separate from `User.id`, pseudonymization job stub in place (no data flowing yet)
- [ ] `/research` placeholder page with:
  - Our ethics posture and status ("under review with X", or "seeking institutional partner")
  - Placeholder for enrollment counts (displays "0 participants" honestly)
  - Link to this protocol doc and to the preregistration index
- [ ] Outreach to candidate research partners initiated; status tracked separately from the code repo
- [ ] Informed-consent copy drafted, not yet deployed

### 2.7 Accessibility & i18n

- [ ] WCAG 2.2 AA sweep on: login, live, meditation list, meditation player, session join, profile, session start/end
- [ ] Keyboard navigation for the player (play/pause, mix, seek) with visible focus states
- [ ] ARIA labels and roles on audio controls
- [ ] Color-contrast audit on the entire color system, fixes where needed (retain brand palette)
- [ ] Screen-reader test pass (VoiceOver on iOS, TalkBack on Android, NVDA on Windows)
- [ ] i18n infra: `next-intl` or equivalent, message catalogs in EN/ES, server-rendered locale negotiation
- [ ] All user-visible strings in the Next.js app extracted into catalogs
- [ ] Locale persistence (already noted as fixed in git history — verify)
- [ ] Language switcher in the app shell

---

## 3. Success criteria

Phase 1 is done when a skeptical outsider can run this audit:

1. Visit `harmonicbeacon.com` — see a coherent, branded site with real content in Theory/Experience/Analysis, real links in the footer.
2. Click Privacy — see a real policy, not a placeholder.
3. Click Login → `beacon.altermundi.net` — see a working login; sign up; see an age gate and a mental-health disclaimer.
4. Navigate the app — the beacon plays continuously, source state is honestly labelled.
5. Open the app in Spanish — every UI string is localized.
6. Use a keyboard only — reach every control, see clear focus states.
7. Open the status page — see a live uptime number.
8. Trigger a deliberate error — see the error captured in Sentry within the operator's sight.
9. Disconnect the primary beacon upstream — confirm the fallback takes over, the UI surfaces the transition, the incident is logged.
10. Leave a report on a test meditation — see the report received, acknowledged within 24h.

All ten must pass. If any fails, Phase 1 is not done.

---

## 4. Non-scope (explicit)

Named here to prevent scope creep:

- No Stripe, no patronage, no billing.
- No Provider application flow (Phase 2).
- No research data collection (Phase 3).
- No mobile app-store submissions (Phase 3).
- No multi-region fallback (Phase 3).
- No Constellation / Seal / hardware anything.
- No newsletter, no lifecycle email beyond transactional.
- No institutional pitching beyond preparing collateral.

---

## 5. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Marketing-site rebuild scopes larger than 8 weeks | Med | Default to enhancing the existing Hostinger site by injecting server-rendered sections rather than a full rebuild; revisit in Phase 2 if pressure grows |
| Counsel-review turnaround blocks legal-page publication | High | Start drafting from well-reviewed templates in week 1, engage counsel in week 2, target publication by week 6 |
| Object-storage migration data-loss | Low-Med | Migration is copy-first, flip-second; keep host-mount as read-only backup for two phases |
| Warm-standby upstream depends on hardware we don't yet have | Med | Provision early; if unobtainable, deliver the same outcome via a second cloud-hosted publisher |
| Ethics partner unresponsive | Med | Maintain a parallel private-IRB option; proceed with consent scaffolding regardless so Phase 3 isn't blocked |
| Team pulled into Phase 2 work prematurely | Med | Phase exit criteria are binary; do not mark Phase 1 done until all 10 audit items pass |

---

## 6. Capacity assumptions

This phase assumes:

- 1 senior full-stack engineer
- 1 design / frontend engineer
- 1 ops / infrastructure engineer (part-time acceptable)
- 1 product / writing (this role; can be partial-time)
- Access to legal counsel for policy review (~20 hours across the phase)
- Budget for: Sentry, object storage, CDN, external monitor, status page, initial ethics outreach

A thinner team can still complete Phase 1 but should extend the duration proportionally rather than drop scope.

---

## 7. Entry to Phase 2

Phase 2 begins when:

- All 10 Phase 1 audit items pass.
- The team has capacity to start monetization work without regressing operational commitments.
- A clear decision has been made on which monetization surfaces Phase 2 will deliver (default: patronage + donations + provider revshare + hand-sold institutional; defer in-app-purchase to Phase 3).
- The institutional partner pipeline has at least one named prospective partner, even if unsigned.

If any of these is missing, extend Phase 1 rather than starting Phase 2 half-built.
