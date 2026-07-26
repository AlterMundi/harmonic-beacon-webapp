# Content Policy

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet). A present-tense
> statement in this document is a claim about code that exists today; if you find
> one that is not, that is a bug in this document.
>
> **The moderation spine is real; the surfaces around it are not yet.** A
> meditation is uploaded as `PENDING`, an Admin approves or rejects it with a
> stored reason shown to the Provider, and an Admin can hide a published one.
> Publication now enforces the tag requirements in §2 — an approval that would
> publish a meditation missing them is refused. Listener reporting is built end to
> end (§5), every administrative action is written to an audit log, and an Admin
> can terminate a live session with a recorded reason.
>
> Still absent: the appeal path, the probation state (§4.6 defines its conditions
> but nothing implements them), the second reviewer for first-submission Providers
> — which has no substrate, since `Meditation` records *when* it was reviewed but
> not by *whom* — and the public policy page. Read those parts of this document as
> the standard the moderation surface will be held to, not as a description of
> what happens today.

*Draft · 2026-04-12 · author: product design, pending validation and legal review*

Authoritative rules live in [BUSINESS_RULES.md §2–4](../BUSINESS_RULES.md). This document is the detail: what Providers may and may not publish, how content is reviewed, how disputes are resolved, and how violations are handled.

A product that hosts user-generated audio in the wellness-adjacent space lives or dies on the quality of this document. It is worth writing slowly.

---

## 1. What is content?

Three surfaces on which Providers can publish, each with its own rules:

1. **Meditation** — pre-recorded audio, uploaded once, surfaced to Listeners as an overlay on the beacon. The upload endpoint accepts audio formats only; video is a surface this policy anticipates and nothing accepts yet. **[Planned — unscheduled]**
2. **Scheduled Session** — a live event hosted by a Provider, optionally recorded.
3. **Provider profile** — the biographical and stylistic information a Listener will see when deciding whether to engage. No profile page exists and the `User` model carries no biography field, so a Listener today sees a Provider's name and nothing else. **[Planned — unscheduled]**

Listener-generated content (reports, journal entries) is not "content" in the policy sense of this document; see [BUSINESS_RULES.md §9](../BUSINESS_RULES.md) for Listener data rights.

---

## 2. What Providers may publish

Aligned content includes:

- Guided meditations, contemplative practices, body-scans, visualization practices.
- Sound baths, tuned-frequency compositions, natural-soundscape recordings.
- Chant, kirtan, traditional contemplative vocal traditions, wherever the Provider has the right to record and share them.
- Somatic instruction — breath practice, posture, grounding — delivered without medical claims.
- Educational commentary about contemplative traditions, resonance, acoustics, or adjacent research, delivered as exploration rather than prescription.
- Silent or near-silent ambient layers designed to complement the beacon.

All content must have:

- A declared primary **language** tag.
- At least one of **MOOD**, **TECHNIQUE**, or **DURATION** tag.
- A stated duration accurate to within 5%.
- Title and description in the declared language (translations optional).
- A signed Provider Content Agreement covering rights.

> **The first three are policy, not enforcement.** Upload accepts a meditation
> with no tags at all, and the Admin approval endpoint validates nothing before
> it sets `isPublished` — so an Admin can today publish a meditation that
> satisfies neither tag rule. The duration rule has nothing to compare against:
> upload stores `durationSeconds = 0` with a comment deferring extraction, and no
> edit path sets it. Until the checks exist, a reviewer's eye is the only thing
> implementing any of this. **[Planned — Phase 1]**
>
> The Provider Content Agreement has not been drafted — it is the
> counsel-engagement thread in [README.md](./README.md#open-threads) — and no
> acceptance of it is recorded anywhere in the schema. Nobody has signed
> anything. **[Planned — Phase 2]**

---

## 3. What Providers may not publish

These are policy-level prohibitions. A violation triggers a takedown.

### 3.1 Therapeutic and diagnostic claims

- No statement that the content *heals*, *cures*, *treats*, *diagnoses*, *prevents*, or *reduces* a named medical or psychiatric condition.
- No phrasing of outcomes as clinical guarantees ("after this session you will no longer feel X").
- No invocation of specific pharmaceutical or clinical interventions.
- Exploratory language is fine ("we explore", "some participants report", "may invite").

### 3.2 Unverifiable metaphysical certainties applied to others

- Broad metaphysical ideas (resonance, coherence, interference, energetic states) are on-brand and welcome.
- Making metaphysical diagnoses of specific individuals, populations, or medical conditions is not. "Cancer is caused by unresolved trauma" is out. "We explore the felt sense of coherence as ratios" is in.

### 3.3 Hate and targeted harassment

- No content targeting any group on the basis of race, ethnicity, national origin, religion, caste, sexual orientation, gender identity, disability, age, or immigration status.
- No content harassing or doxxing a named individual.

### 3.4 Dangerous or exploitative practice

- No instruction that recommends stopping prescribed medication.
- No instruction that would put listeners at physical risk (no driving-while-trance, no prolonged breath-holding beyond published safety thresholds).
- No content that solicits Listeners into separate paid programs operating outside the platform in ways that evade our rules — "join my private Telegram for the real practice" is out.
- No content that promotes psychedelic, dissociative, or other substance use as part of the practice, regardless of legality.

### 3.5 Plagiarism and rights violations

- No content that uses copyrighted music, text, or recorded teaching without a clear license.
- No content that attributes traditional lineages without the community's consent (a particular risk with indigenous or closed traditions).
- No content that uses another Provider's material without credit.

### 3.6 Synthesized or impersonated identity

- Content generated by AI is permitted and must be disclosed. What the platform refuses is *hidden* synthesis, not synthesis — the refusal in [BUSINESS_RULES.md §11](../BUSINESS_RULES.md), of which this rule is the operative form. Undisclosed AI-generated content is a rights violation under this section; disclosed AI-generated content is publishable like any other submission and is reviewed on the same criteria.
- The labelled field the disclosure is recorded in does not exist — upload collects a title, a description, tags and a mix position, and nothing else — so there is nowhere to record it at upload today, and a reviewer has only the §4.4 checklist item and their own eye. **[Planned — unscheduled]**
- Voices synthesized or cloned from real people require the consent of that person, documented and auditable.
- No impersonation of a named teacher, living or historical.

### 3.7 Commercial solicitation

- No hidden upsell to an external product, course, or coaching offer.
- Crediting one's own external website/practice in the description is fine; soliciting via the content body is not.

---

## 4. Moderation workflow

### 4.1 States

A meditation moves through `ModerationStatus`: `PENDING → APPROVED | REJECTED`, plus the `isPublished` / `isHidden` flags that control visibility (see [BUSINESS_RULES.md §2.1](../BUSINESS_RULES.md)). This part is real: the states, the flags and the transitions all exist.

Approval and publication are one operation today — the Admin endpoint sets `isPublished = true` in the same write that sets `APPROVED` — so the *approved but unpublished* row in the [BUSINESS_RULES.md §2.1](../BUSINESS_RULES.md) lifecycle table is not reachable from the moderation UI.

### 4.2 Review tiers

- **First-submission Providers**: two-reviewer approval. One Admin, one Steward (or two Admins if Steward role is unavailable). **[Planned — Phase 2]**
- **Returning Providers in good standing**: single-reviewer approval. *(This is what the tooling does today — for everyone, first submission or not.)*
- **Providers on probation** (post-breach, pre-reinstatement): two-reviewer approval, mandatory. See §4.6. **[Planned — Phase 2]**
- **Emergency takedowns**: single Admin, immediate, reviewed by a second Admin within 24 hours. Hiding content is immediate and single-Admin today; the log and the second review are not. **[Planned — Phase 1]**

> The tier scheme has no substrate. `Meditation` records `reviewedAt` but not who
> reviewed — so a second reviewer, and the §4.5 rule that an appeal goes to an
> Admin not involved in the original decision, cannot be expressed in the data,
> let alone enforced. The Steward role does not exist either; `UserRole` has
> three values, `LISTENER`, `PROVIDER` and `ADMIN`. Both arrive with the
> moderation tooling. **[Planned — Phase 2]**

### 4.3 SLA

These are targets, not measurements. Nothing instruments the review queue, so no
figure below can be reported against yet, and none of them should appear on a
public surface as a guarantee until it can be. **[Planned — Phase 2]**

- Initial review: within 5 business days of submission.
- Emergency takedown decisions: within 24 hours of report or trigger.
- Appeal decisions: within 10 business days of appeal.

### 4.4 Rejection reasons

Every rejection cites a specific rule from this document by number. Free-form "doesn't fit our vibe" rejections are not permitted. The reason is stored on the meditation and shown to the Provider on their dashboard — that much works today, as a single free-text field. The checklist below is a reviewer's discipline rather than a form; the structured version arrives with the moderation queue UI. **[Planned — Phase 2]**

- [ ] Rights clear (§2 requirements, §3.5)
- [ ] No therapeutic claims (§3.1)
- [ ] No metaphysical diagnosis (§3.2)
- [ ] No harm-adjacent practice (§3.4)
- [ ] Language + tagging correct (§2)
- [ ] Audio technical quality acceptable (no clipping, no corrupted segments, reasonable SNR)
- [ ] Duration matches declared
- [ ] AI disclosure present if required (§3.6)

### 4.5 Appeals

No appeal path exists in the product — there is no appeal endpoint, no appeal
record, and no notification to route an outcome through. The rules below are what
the appeal flow will implement. **[Planned — Phase 2]**

- A Provider whose content is rejected will be able to appeal in writing.
- The appeal will be reviewed by an Admin not involved in the original decision. This one is gated on recording *who* reviewed, which the schema does not do (§4.2).
- Appeal SLA: 10 business days.
- Appeal outcomes will be final for that submission; the Provider may resubmit a revised version under the normal workflow.

### 4.6 Probation

Probation is the reviewable state referenced in §4.2 and in
[BUSINESS_RULES.md §3.3](../BUSINESS_RULES.md): the Provider keeps the role, and
their content returns to pre-publication review. No code models it — there is no
probation field on `User`, and no second review tier to place anyone in. The
entry and exit conditions below are the policy it will implement when it exists.
**[Planned — Phase 2]**

**Entry.** A Provider will be placed on probation by Admin decision on any of:

- A soft or hard breach as classified in [BUSINESS_RULES.md §3.3](../BUSINESS_RULES.md), where the breach does not warrant offboarding.
- Any threshold in §6.3 being reached.
- A pattern of validated reports about their content or their conduct in a session (§5.3).

The decision, its reason and its date will be recorded and communicated to the
Provider, who may respond in writing before it takes effect — except where the
trigger is a safety matter, in which case it takes effect immediately and the
response follows.

**Exit.** A Provider leaves probation by Admin decision when all of:

- Three consecutive submissions have been approved with no validated rule violation.
- Six months have passed since the last validated breach or upheld report.
- Any content taken down in the triggering incident has been removed or corrected.

Probation is a review posture, not a sentence with a term: it ends when the
reason for it has passed. A Provider on probation who commits a further hard
breach will be offboarded rather than placed on probation again.

---

## 5. Reports from Listeners

> **The path exists; the notifications do not.** A Listener can file a report from
> a content surface, it lands in the `Report` table, and an Admin works the queue
> at `/admin/reports`, which shows how long each report has waited and whether it
> has been acknowledged. What does not exist is any message back to the reporter —
> there is no transactional email of any kind — and there is no Steward role, so
> everything routes to an Admin. The response times below stay targets until
> something aggregates the timestamps the queue records.

### 5.1 What is reportable

- A meditation — from the player on the meditation page.
- A scheduled session — from the session list, the live-session UI and the playback page.
- The Provider behind a scheduled session. There is no standalone Provider profile page; when one exists it will carry the button. **[Planned — Phase 2]**
- A co-Listener in a live session. The UI has no participant list, so there is nothing to attach the control to. **[Planned — Phase 2]**

### 5.2 How

- A report button is visible on the content surfaces named in §5.1.
- The reporter selects a category (safety / therapeutic claim / copyright / spam / other) and may add free-form context, capped at 4,000 characters.
- A second open report from the same reporter against the same target is refused. The dialog says the earlier report is still open rather than showing an error.
- Reporters will receive an acknowledgement within 24 hours and a resolution notice within 5 business days. These are targets; there is no transactional email of any kind yet, and the dialog tells the reporter the app will not write back. **[Planned — Phase 1]**
- Reporters are never disclosed to the reported party.

### 5.3 Triage

- Reports are triaged by an Admin at `/admin/reports`, who can acknowledge, resolve, dismiss or reopen one and attach a resolution note. A Steward role does not exist. **[Planned — Phase 2]** *(the Steward role)*
- High-severity reports (safety, abuse, legal) will escalate to Admin immediately.
- A report that names an active live session can be acted on: the kill-switch exists at `POST /api/admin/sessions/[id]/terminate` and an Admin can end any session with a recorded reason (see [TRUST_AND_SAFETY.md §4](./TRUST_AND_SAFETY.md)). What is not wired is the path *from* a report *to* that action — an Admin reading a report about a live session has to find the session themselves. **[Planned — Phase 1]** *(the link between the two)*
- A pattern of validated reports about a Provider will move them to probation (§4.6).

---

## 6. Takedowns

### 6.1 Provider-initiated takedown

A Provider will be able to take down their own content at any time. There is no
provider-facing removal or unpublish path today — the provider API updates a
title, a description, tags and the mix position, and nothing else — so a Provider
who wants content down has to ask an Admin, who hides it.
**[Planned — unscheduled]**

Take-downs will be logged, once there is an audit log to log them to.
**[Planned — Phase 1]**

Historical `ListeningSession` records are unaffected: hiding leaves them
untouched, and the schema sets `ListeningSession.meditationId` to null if a
meditation row is ever hard-deleted, so the listening record survives without its
reference. (The tombstone record described in
[BUSINESS_RULES.md §9.2](../BUSINESS_RULES.md) does not exist; the null is what
happens instead.)

### 6.2 Platform-initiated takedown

Triggers:

- Policy breach discovered in review or report.
- Copyright complaint (DMCA-style notice or equivalent under applicable law).
- Legal compulsion.
- Safety incident.

> **The notice-and-takedown framework is a counsel decision and is not assumed to
> be the US DMCA.** The platform is operated from Argentina for an international
> audience, and DMCA safe harbour would require, among other things, a registered
> agent with the US Copyright Office. "DMCA-style notice or equivalent under
> applicable law" is the hedge this document uses deliberately; it should not be
> tightened into a named regime until counsel picks one. The same pass needs to
> assess DSA notice-and-action exposure if EU users are in scope — and the EUR
> and GBP pricing in [MONETIZATION.md](./MONETIZATION.md) says they are intended
> to be.

Workflow:

1. Admin hides the content: `isHidden` is set to `true`, and `ModerationStatus` and `isPublished` are left as they were. A meditation that was published stays `APPROVED` with `isPublished: true` and becomes invisible to Listeners by virtue of `isHidden` alone. That is the lifecycle invariant in [BUSINESS_RULES.md §2.1](../BUSINESS_RULES.md), and it holds here because the pre-takedown publication state is worth keeping: an unhide restores the content to exactly where it stood, and a filter has one flag to consult.
2. The reason is recorded and communicated to the Provider within 2 business days. A rejection reason is recorded on the reject path today; hiding records no reason at all, and there is no notification of any kind to communicate it through. **[Planned — Phase 2]**
3. Appeal mechanism available as in §4.5. **[Planned — Phase 2]**
4. For DMCA-style notices, a counter-notice mechanism per applicable law. Nothing implements one, and its shape depends on the framework counsel picks. **[Planned — unscheduled]**

### 6.3 Takedown thresholds

A Provider reaching any of these thresholds will enter review, and probation per
§4.6. Nothing counts: a rejection leaves one free-text reason on the current
record, which is cleared when the meditation is later approved, and no takedown
history is kept per Provider at all. The thresholds are policy waiting for a
counter. **[Planned — Phase 2]**

- 3 separate validated content rejections within 12 months.
- 2 takedowns of published content within 12 months.
- 1 severe breach (safety, abuse, fraud) — immediate offboarding.

---

## 7. Provider Content Agreement (summary)

The full agreement will be maintained outside this repo as a legal document. It has not been drafted — it is the counsel-engagement thread in [README.md](./README.md#open-threads) — so nothing summarized here has been through legal review, and no Provider has signed anything. The key terms as this document anticipates them: **[Planned — Phase 2]**

- **Ownership**: Provider retains copyright of their uploaded content.
- **License to platform**: non-exclusive, worldwide, royalty-free license to host, stream, transcode, and serve the content to authorized Listeners.
- **Moral rights**: acknowledged; attribution preserved.
- **Representations**: Provider warrants they have rights to publish the content, including any music, samples, or texts within it.
- **Indemnification**: Provider indemnifies the platform against third-party claims arising from their content.
- **Term**: unresolved — see below.
- **Compensation**: as described in [MONETIZATION.md](./MONETIZATION.md) Provider economics section, where the share is also unresolved.

> **Unresolved — do not quote a licence term to a Provider.** This document has
> said both that the licence terminates on content removal, subject to a
> cached-delivery technical tail of up to 30 days, and that it is a perpetual
> licence terminable by removal; [BUSINESS_RULES.md §2.2](../BUSINESS_RULES.md)
> has said perpetual. Those are different deal terms, and "perpetual, terminable
> by removal" is confused drafting on its own — the term a reader would guess was
> intended is a non-exclusive licence for the duration of publication plus a
> short technical tail, but guessing is exactly what nobody should be doing here.
> The Provider Content Agreement decides it once, and every location in this
> document and in BUSINESS_RULES.md is rewritten from that single source. Until
> then no term is quoted to a Provider.
>
> The Agreement also has to address the rights of the Listener participants whose
> voices are captured in a recorded session. Every wording in this corpus covers
> the Provider's rights in a recording, and none covers the rights of the people
> audible inside it, who are not party to the Agreement at all.

---

## 8. Special considerations

### 8.1 Indigenous and closed-tradition content

Some contemplative traditions are explicitly closed — the knowledge is community-held, not freely publishable. When a Provider wants to share material from such a tradition, we ask for:

- A stated permission from a community elder or keeper.
- A clear attribution of the tradition and its keepers.
- A non-extractive framing.

When in doubt, err on side of rejection.

### 8.2 Multilingual content

- Declared language must match the primary language of the content.
- Subtitling and translations are welcome but never replace the declared language.
- Machine-translated descriptions in additional languages will be flagged as machine-translated. A meditation carries one title and one description with no translation fields and no such flag, so there is nothing to mark yet. **[Planned — unscheduled]**

### 8.3 Accessibility

Providers are strongly encouraged to:

- Include a text summary of the session for Listeners who prefer to read.
- Offer captions for video.
- Avoid abrupt volume changes and frequencies known to trigger seizures (strobing audio, narrow-band ultrasonic cuts).

At launch, these are encouragements. Post-launch, they will become requirements for newly published content — but the schedule this sentence points at does not exist: the roadmap's accessibility commitment is a WCAG 2.2 AA sweep of the app and a per-phase review, not a schedule for content requirements. Somebody has to write one before this becomes a requirement anybody can be held to. **[Planned — unscheduled]**

### 8.4 Minors

No content may involve minors as guides or narrators. Content intended for minor Listeners is not on scope for the launch platform and would be its own separate product with its own policy.

---

## 9. Transparency

We will publish, at `/policy/content`:

- The current version of this document.
- Quarterly aggregate statistics: content submitted, approved, rejected by category; takedowns by reason.
- Notable policy decisions worth broader explanation.

> The page does not exist — there is no `policy` route in the app — and no
> aggregate statistics are produced, because nothing counts submissions,
> approvals, rejections by category or takedowns by reason. The public summary is
> a Phase 1 deliverable
> ([PHASE_1_CREDIBILITY.md §2.1](./phases/PHASE_1_CREDIBILITY.md))
> **[Planned — Phase 1]**; the statistics need the audit log and the queue
> instrumentation that arrive with the moderation tooling
> **[Planned — Phase 2]**.

We do not publish:

- Individual Provider moderation histories.
- Individual reporter identities.
- Content that has been taken down for legal reasons, beyond the existence of the takedown.

---

## 10. Changes to this policy

- Proposed policy changes will be posted as drafts visible to the Provider community with at least 30 days of comment. There is no surface to post them on and no channel to announce them through. **[Planned — Phase 2]**
- Substantial changes will be announced in advance to all Providers. **[Planned — Phase 2]**
- Version history will be preserved in a form a Provider can consult. Today the only history is this repository's git log, and nothing records which version of this document applied when a given meditation was published. **[Planned — Phase 2]**
