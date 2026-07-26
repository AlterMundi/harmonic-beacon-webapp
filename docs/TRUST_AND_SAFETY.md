# Trust & Safety

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet). A present-tense
> statement in this document is a claim about code that exists today; if you find
> one that is not, that is a bug in this document.

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

Zitadel handles password policy and authentication flows; we don't roll our own. Sign-up and sign-in are Zitadel-hosted — the application has no signup route of its own. **[Delegated — Zitadel]**

The controls below are the intended posture. None of them is implemented in this codebase, and none has been confirmed in the Zitadel instance either. Some of them — CAPTCHA, email verification, signup rate limiting — are the kind of thing Zitadel can enforce, so the first step is not to build them but to inspect the instance configuration and record what it actually does; whatever is not covered there is app-level work. Until that inspection happens, treat all four as absent.

- A CAPTCHA will gate signup (hCaptcha, Turnstile, or the Zitadel equivalent). **[Planned — Phase 1]**
- Email verification will be required before first listen. The listen-gating half is app-level regardless of where verification happens, and does not exist. **[Planned — Phase 1]**
- A per-IP rate limit will apply to signup attempts. The nginx rate limits in §2.7 cover this app's own routes, not the Zitadel-hosted signup form, so they do not provide this. **[Planned — Phase 1]**
- Silent email-domain risk scoring (disposable-email detection) will be used to flag, not block. **[Planned — unscheduled]**
- An age gate (affirmation of 18+) will be applied at signup. It does not exist, which matters beyond signup: [RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md) relies on it to exclude minors from research, so the research consent flow cannot be built on top of it until it is real. **[Planned — Phase 1]**

### 2.2 Role controls

**Roles are granted in Zitadel, and only in Zitadel.** The `UserRole` value in this application's database is a projection of the Zitadel project-role claim, rewritten at every sign-in ([BUSINESS_RULES.md §1](../BUSINESS_RULES.md)). The application therefore does not grant, revoke or edit roles. The admin surface shows a user's role read-only, with no control to change it, and `PATCH /api/admin/users/[id]` refuses with a 409 naming Zitadel as where the grant belongs. A role changed anywhere but Zitadel would be silently reverted at that user's next sign-in, which is a worse control than none — it looks like an authorization decision and is not one. **[Delegated — Zitadel]**

That placement also puts the control where the audit trail is. Zitadel records who granted which project role to whom and when. This application has no role change to log, because it performs none; what it does log is the refused attempt, as `user.role_change_refused`. That entry is worth having — an Admin reaching for a control that should not be reachable says something about the surface they were shown.

- PROVIDER role granted by named Admin action only, performed in Zitadel and recorded in Zitadel's audit trail. **[Delegated — Zitadel]**
- ADMIN role changes require two-Admin approval (one initiator, one validator). Zitadel is where that is configured and enforced; nobody has confirmed the instance is configured for it, so treat it as unverified rather than as a control in place. **[Delegated — Zitadel]**
- Future RESEARCHER role change will require a signed data-use agreement reference. **[Planned — Phase 3]**

The sign-in path also accepts a legacy `certified_provider` claim as a PROVIDER grant, alongside `BEAC_PROVIDER`. It is **retained and deprecated**: documented here and in [BUSINESS_RULES.md §1](../BUSINESS_RULES.md) rather than left silent, which is what this section's posture actually objects to, and removed from the sign-in path once the accounts holding it have been migrated to `BEAC_PROVIDER`. That migration is an open task. Until it is done, `certified_provider` is a second, older way to hold PROVIDER, and an access review (§6.2) has to look at both claims to see the whole roster.

### 2.3 Content controls

Per [CONTENT_POLICY.md](./CONTENT_POLICY.md) — moderation, review, takedown, appeals.

### 2.4 Live-session controls

Publish rights are decided once, when the join token is issued: a Provider gets `canPublish`, a Listener does not unless their invite grants it. That is the whole of the live-session control surface today. There is no mid-session path to grant or withdraw a voice, and no Admin path into a session at all.

- Every scheduled session will have a Session Kill Switch (see §4 below). **[Planned — Phase 1]**
- Every participant in a session will be able to raise a hand / request to speak; a Provider will not unilaterally unmute a participant — consent happens in-client. Neither the hand nor the mid-session grant exists; the practical effect today is that a Listener simply cannot be unmuted, which satisfies the consent half by accident and not the affordance. **[Planned — Phase 2]**
- Recording will be disclosed in-UI before joining, and joining will require affirmative consent — an explicit accept, not participation treated as agreement. The disclosure will say that the session is recorded, that the participant's own audio is captured as a separate track, and that the recording belongs to the Provider, so the participant cannot afterwards have their track pulled out of it. That last clause is the one that makes the arrangement honest: the recording genuinely cannot be unpicked later ([BUSINESS_RULES.md §9.1](../BUSINESS_RULES.md)), so the person has to know before they join rather than discover it when they ask. Today there is no pre-join disclosure at all, and the in-session recording indicator renders only for publishers, so a Listener in a recorded session is neither told nor asked. **[Planned — Phase 1]**
- Participant-muting will be a Provider capability; banning will be an Admin capability; the Provider will be able to flag a participant and escalate. **[Planned — Phase 2]**
- Session chat (if/when we build it) uses a character-frequency anti-flood control and a report-this-message UI. **[Planned — unscheduled]**

### 2.5 Report capture

> **Reporting is end to end.** The `Report` model, the filing endpoint and the
> admin triage routes are built, the report button is on the content surfaces, and
> `acknowledgedAt` is stamped when an admin first moves a report off OPEN — which
> is what makes the 24-hour acknowledgement measurable rather than merely stated.
> The triage queue at `/admin/reports` shows, per report, how long it has been
> waiting and whether it has been acknowledged. Nothing aggregates that across the
> queue and nothing enforces the target, so the response times stay off public
> surfaces. The playbook in §5.1 now begins with an event a Listener can produce.

- The report button is on the meditation player, on the recorded- and scheduled-session lists, on the session playback page, in the live-session UI for Listeners, and on the Provider behind a scheduled session. Participant rows do not exist as a UI, and there is no standalone Provider profile page; both will carry the button when they are built. **[Planned — Phase 2]** *(participant rows and Provider profiles)*
- A report captures: reporter, target (user/content/session), category, and free-form context. It does not capture context metadata (URL, playback position) or a "do you want a response" flag; the app never writes back to a reporter, and the dialog says so rather than implying a reply. **[Planned — unscheduled]** *(context metadata and the response flag)*
- Reports land in a single queue that an Admin works. There is no routing to a Steward role and no notification of any kind — an Admin has to open the queue to find out a report exists. **[Planned — Phase 1]** *(routing and notification)*

### 2.6 Data controls

- PII in logs is mechanically filtered. Every raw error on its way to a log passes through a redactor that strips credentials from connection strings and signatures from presigned URLs, the auth path no longer logs an email address, and a test walks every `console.*` call in `src/` and fails the build on a PII-bearing field. This is enforcement, not a convention. Field-level tagging arrives with structured logging, which does not exist yet ([SLO.md §9](./SLO.md)). **[Planned — Phase 1]** *(for structured logging only)*
- At-rest encryption on Postgres **will be** verified and documented. Nothing in this repo establishes it — it is a property of the host and the volume, not of the application, and no one has checked. Do not repeat the claim until someone has. **[Planned — Phase 1]**
- Secrets in `/etc/sai-harmonic-beacon/production.env`, readable only by the runtime user; rotation policy in §6.
- Research data handled per [RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md).

### 2.7 Infra controls

- Healthchecks at container level, backed by a liveness probe (`/api/health`, which deliberately does not touch the database) and a readiness probe (`/api/health/ready`, which does, under a short timeout). The app, go2rtc and the playlist bot each have one.
- Rate limiting at the nginx layer: per-IP zones on the streaming and API paths (details in ops runbook). A WAF **will** sit in front of it; there is none today, and the rate limits are not one. **[Planned — unscheduled]**
- An external uptime monitor will ping the beacon and the app. Nothing monitors either from outside the host today, which is why the audibility number in [SLO.md §2](./SLO.md) cannot be reported. **[Planned — Phase 1]**
- Staged deployment with pre-production environment before prod push. Deployment goes straight to production today. **[Planned — Phase 1]**

---

## 3. Incident classification

### 3.1 Severity levels

| Severity | Definition | Examples | Response |
|---|---|---|---|
| **S0** | Catastrophic — platform-wide outage, data breach with identifiable PII exposure, legal compulsion underway | Beacon dark > 1h; public confirmation of PII leak; search warrant | All hands, public comms within 2h |
| **S1** | Severe — active user-visible harm or legal exposure | Live-session abuse in progress; validated safety incident; critical security vuln exploited | On-call Admin + Operator, public/user comms within 6h |
| **S2** | Moderate — contained harm or potential exposure | Provider policy hard breach; moderation backlog > SLA; a user's data deleted by mistake | Admin within 24h, user comms within 48h if affected |
| **S3** | Low — user-affecting but limited | One meditation wrongly approved; single report stalled; a feature regression with safe fallback | Routine triage, SLA in normal workflow |

The Response column names an on-call rotation and an Operator role, neither of which exists — the OPERATOR role is scaffolded in [BUSINESS_RULES.md §1.4](../BUSINESS_RULES.md) and the rotation is a Phase 2 commitment (§6.3). Read the column as the intended response, staffed today by whoever is available. **[Planned — Phase 2]**

The response times in the table are targets. Once published they read as quasi-contractual, so they should not appear on a public surface before there is a queue that measures them.

> **Unresolved:** S1 communication timing is stated twice and differently — "public/user
> comms within 6h" in the table above, and an acknowledgement email to affected
> participants "within 24h" in the playbook at §5.1. These may be two different
> obligations (a public statement versus a direct notification to identified
> participants) or they may be one obligation written down twice with a
> contradiction in it. No number should be inferred from this document until it is
> settled. The product lead decides, with counsel review before either figure is
> published, since both become the standard we are judged against.

### 3.2 Public disclosure

- S0 and S1 will be disclosed publicly within 14 days of resolution, via a postmortem on the public incidents page. That page does not exist. **[Planned — Phase 1]**
- S2 will be disclosed publicly only if multiple users were affected or the incident has systemic learning. **[Planned — Phase 1]**
- S3 is logged internally, not publicly disclosed.

Legal and privacy considerations may delay disclosure; they never eliminate it.

---

## 4. The Session Kill Switch

> **The Kill Switch exists**, at `POST /api/admin/sessions/[id]/terminate`. An
> Admin can end any live session, including one whose Provider is the problem —
> a compromised account, abuse from the host mic — which was the case with no
> control at all. It stops any active egress, disconnects participants, moves the
> session to ENDED, and requires a written reason: terminating someone else's live
> session without recording why is what the audit log exists to prevent, so a
> missing reason is a refusal rather than a default.
>
> Three of the five behaviours below are delivered. Locking the session against
> restart falls out of the status change, since starting requires SCHEDULED.
> **Not delivered:** suspending the Provider's ability to open new sessions
> pending review — there is no suspension field on `User`, so this was left
> unbuilt rather than invented — and the participant-facing message, which is
> client-side. Both are tracked. **[Planned — Phase 1]** *(items 3 and 5)*

A single-click control, available to Admin on any live `ScheduledSession`, that will:

1. Terminate the LiveKit room, disconnecting all participants.
2. Lock the session to prevent restart from the UI.
3. Suspend the Provider's ability to start new sessions pending review.
4. Capture a snapshot of the session metadata for incident records.
5. Surface a generic "session ended" message to participants.

The Kill Switch will be used in response to:

- Imminent harm (hate speech, sexual content, threats).
- Compromised Provider account (suspected takeover mid-session).
- Legal compulsion.
- Severe technical malfunction (inaudible, looping, or corrupted output).

Use of the Kill Switch will be logged with the Admin identity, the timestamp, and the declared reason, and reviewed by a second Admin post-incident. That logging is the audit log of [BUSINESS_RULES.md §1.3](../BUSINESS_RULES.md), which does not exist either; the two ship together or the control ships unaccountable. **[Planned — Phase 1]**

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
