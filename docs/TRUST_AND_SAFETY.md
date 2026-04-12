# Trust & Safety

*Draft · 2026-04-12 · author: product design, pending validation*

Authoritative rules live in [BUSINESS_RULES.md §10](../BUSINESS_RULES.md). This document is the operational detail: incident classifications, playbooks, controls, and the specific affordances we ship to make the platform safe.

A live-audio product is a different beast than a static-content product. A bad actor with a mic in a scheduled session can do immediate, wide harm. A bad actor posting a static meditation can be caught in review. This document takes both seriously.

---

## 1. Threat model

What we plan against, in rough order of likelihood:

1. **Bot signup floods** — account creation used for abuse, resource exhaustion, or credential stuffing prep.
2. **Provider policy drift** — a previously aligned Provider starts making therapeutic claims, soliciting off-platform, or behaving as an evangelist.
3. **Scheduled-session abuse** — a Provider or participant behaves abusively in a live session (slur, sexual content, harassment), or a Provider knowingly invites abusive participants.
4. **Copyright complaint** — a third party claims a published meditation infringes their rights.
5. **Impersonation** — an account or content impersonates a real teacher or a named person.
6. **Data exposure** — a bug, misconfiguration, or compromised credential leads to unauthorized access to identifiable data (research, billing, or account).
7. **Account takeover** — credential compromise for a Listener, Provider, or Admin.
8. **Extortion or harassment of the brand** — coordinated review bombing, SEO attacks, harassing messages to the team.
9. **Regulatory action** — a regulator (consumer protection, health authority, data protection) alleges a claim violation or data practice.
10. **Catastrophic infra incident** — long outage, data loss, multi-day beacon dark.

Lower-probability, higher-severity: involvement of minors in any surface (we block this structurally), and any credible claim of physical harm attributable to a practice recommended in content.

## 2. Controls

### 2.1 Account-creation controls

- CAPTCHA on signup (hCaptcha, Turnstile, or equivalent).
- Email verification required before first listen.
- Per-IP rate limit on signup attempts.
- Silent email-domain risk scoring (disposable-email detection) used to flag, not block.
- Zitadel handles password policy and auth flows; we don't roll our own.

### 2.2 Role controls

- PROVIDER role granted by named Admin action only, logged.
- ADMIN role changes require two-Admin approval (one initiator, one validator) in the audit log.
- Future RESEARCHER role change requires a signed data-use agreement reference.
- All role changes emit an event visible in the audit log.

### 2.3 Content controls

Per [CONTENT_POLICY.md](./CONTENT_POLICY.md) — moderation, review, takedown, appeals.

### 2.4 Live-session controls

- Every scheduled session has a Session Kill Switch (see §4 below).
- Every participant in a session may raise a hand / request to speak; a Provider does not unilaterally unmute a participant — consent happens in-client.
- Recordings are disclosed to participants before joining. Participation implies consent to recording.
- Participant-muting is a Provider capability; banning is an Admin capability; the Provider can flag a participant and escalate.
- Session chat (if/when we build it) uses a character-frequency anti-flood control and a report-this-message UI.

### 2.5 Report capture

- A report button is on every content surface, every Provider profile, every live-session UI, and every participant row in a session.
- A report captures: reporter (if logged in), target (user/content/session), category, free-form context, context metadata (timestamp, URL), and whether the reporter wants a response.
- Reports emit to a queue that routes to Steward or Admin.

### 2.6 Data controls

- At-rest encryption on Postgres.
- PII in logs is mechanically filtered; structured logging with field-level tagging prevents accidental leakage.
- Secrets in `/etc/sai-harmonic-beacon/production.env`, readable only by the runtime user; rotation policy in §6.
- Research data handled per [RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md).

### 2.7 Infra controls

- Healthchecks at container and process level.
- External uptime monitor pinging beacon and app.
- WAF / rate-limit at nginx layer (details in ops runbook).
- Staged deployment with pre-production environment before prod push (Phase 1 deliverable; not yet in place).

---

## 3. Incident classification

### 3.1 Severity levels

| Severity | Definition | Examples | Response |
|---|---|---|---|
| **S0** | Catastrophic — platform-wide outage, data breach with identifiable PII exposure, legal compulsion underway | Beacon dark > 1h; public confirmation of PII leak; search warrant | All hands, public comms within 2h |
| **S1** | Severe — active user-visible harm or legal exposure | Live-session abuse in progress; validated safety incident; critical security vuln exploited | On-call Admin + Operator, public/user comms within 6h |
| **S2** | Moderate — contained harm or potential exposure | Provider policy hard breach; moderation backlog > SLA; a user's data deleted by mistake | Admin within 24h, user comms within 48h if affected |
| **S3** | Low — user-affecting but limited | One meditation wrongly approved; single report stalled; a feature regression with safe fallback | Routine triage, SLA in normal workflow |

### 3.2 Public disclosure

- S0 and S1 are disclosed publicly within 14 days of resolution, via a postmortem at `/incidents`.
- S2 is disclosed publicly only if multiple users were affected or the incident has systemic learning.
- S3 is logged internally, not publicly disclosed.

Legal and privacy considerations may delay disclosure; they never eliminate it.

---

## 4. The Session Kill Switch

A single-click control, available to Admin on any live `ScheduledSession`, that:

1. Terminates the LiveKit room, disconnecting all participants.
2. Locks the session to prevent restart from the UI.
3. Suspends the Provider's ability to start new sessions pending review.
4. Captures a snapshot of the session metadata for incident records.
5. Surfaces a generic "session ended" message to participants.

The Kill Switch is used in response to:

- Imminent harm (hate speech, sexual content, threats).
- Compromised Provider account (suspected takeover mid-session).
- Legal compulsion.
- Severe technical malfunction (inaudible, looping, or corrupted output).

Use of the Kill Switch is logged with the Admin identity, the timestamp, and the declared reason, and is reviewed by a second Admin post-incident.

---

## 5. Incident playbooks

### 5.1 Live-session abuse (S1)

1. **Detect** — report arrives, or Admin observing notices.
2. **Triage** (< 5 min) — Admin joins the session silently as observer, confirms.
3. **Act** — apply Kill Switch if abuse is active; otherwise mute/ban the participant.
4. **Preserve evidence** — session recording retained; participant list captured.
5. **Notify** — affected participants receive an acknowledgement email within 24h.
6. **Investigate** — Provider action reviewed; policy breach decision per [CONTENT_POLICY.md](./CONTENT_POLICY.md).
7. **Learn** — incident added to the postmortem queue.

### 5.2 Data exposure (S0–S1)

1. **Contain** — revoke suspect credentials, rotate secrets, freeze affected surface.
2. **Assess** — determine what data was accessible and for how long.
3. **Notify** — affected users notified within the timeframe required by the applicable data-protection law (72 hours for GDPR).
4. **Report** — regulators notified per obligation.
5. **Remediate** — close the exploit path, audit for similar patterns.
6. **Disclose** — public postmortem within 14 days of containment.

### 5.3 Beacon dark (continuity incident)

1. **Detect** — external monitor triggers.
2. **Fallback** — playlist-bot fallback takes over within 10 seconds (automated).
3. **Respond** — Operator on-call investigates live source.
4. **Communicate** — status page updates within 15 minutes.
5. **Restore** — return to live source; confirm via canary listener.
6. **Postmortem** — for any incident ≥ 5 minutes.

### 5.4 Copyright complaint (S2–S3)

1. **Acknowledge** — within 3 business days.
2. **Assess** — validate the complaint's facial legitimacy (DMCA-style or local equivalent).
3. **Takedown** — hide content pending resolution if complaint is facially valid.
4. **Notify Provider** — within 2 business days of takedown.
5. **Counter-notice path** — offered per applicable law.
6. **Resolve** — restore content on valid counter-notice, or remove permanently.

### 5.5 Regulatory inquiry (S1)

1. **Do not respond publicly.** Route to counsel.
2. **Preserve** — place legal hold on relevant records.
3. **Cooperate under counsel guidance.**
4. **Disclose to users** — where legally permissible and relevant to their decision-making.

---

## 6. Operational hygiene

### 6.1 Secrets rotation

- Zitadel client secrets: rotated annually.
- Database credentials: rotated annually.
- Stripe webhook secrets: rotated after any team-member offboarding that had access.
- LiveKit API keys: rotated after any team-member offboarding that had access.
- Stripe API keys: separate test / live keys, principle-of-least-privilege scoping, rotated after any incident.

### 6.2 Access review

- Quarterly review of who holds ADMIN, PROVIDER, and (future) RESEARCHER roles.
- Semi-annual review of third-party integrations with access tokens.
- On every team offboarding, immediate revocation of access and secret rotation as applicable.

### 6.3 On-call

- A named Operator is on-call at all times (Phase 2 commitment).
- Secondary on-call for overflow.
- Paging via a dedicated channel with documented escalation.

### 6.4 Drills

- Quarterly restore-from-backup drill, documented.
- Semi-annual incident-simulation (tabletop exercise on S0 scenarios).
- Annual penetration test (once budget supports).

---

## 7. Public-facing commitments

The following appear on the public site under `/trust`:

- Our privacy and data practices (linking to Privacy policy).
- Our content policy (linking to [CONTENT_POLICY.md](./CONTENT_POLICY.md), user-facing summary).
- How to report content or behaviour.
- How to contact the safety team (email address, response-time expectation).
- A status page with live uptime and a feed of recent incidents.
- Our approach to research ethics, linking to [RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md) summary.

---

## 8. Things we don't do

- We do not "shadow-ban" — a Provider whose content is hidden is told it is hidden, and why.
- We do not remove content without giving the Provider a reason citing a rule.
- We do not pretend the beacon is live when it's on fallback.
- We do not use moderation as a tool to settle non-policy disputes (taste, style, theological disagreements).
- We do not allow Admins to moderate content from a Provider with whom they have a financial or personal conflict; such cases are reassigned.

---

## 9. Review

This policy is reviewed at minimum semi-annually, and after any S0 or S1 incident. Review results are summarized in the public transparency report.
