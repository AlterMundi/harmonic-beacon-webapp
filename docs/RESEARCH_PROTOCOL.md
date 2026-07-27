# Research Protocol

> **Status: Draft — pending validation.** Nothing here is ratified. Claims about
> systems that do not yet exist are written in the future tense and tagged
> `[Planned — Phase N]`, per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet). A present-tense
> statement in this document is a claim about code that exists today; if you find
> one that is not, that is a bug in this document.
>
> **No research data is collected today.** There is no consent, participant,
> survey or response model in `prisma/schema.prisma`, no instrument is
> administered, and no pseudonymization pipeline runs. Read this document as the
> standard the research surface will be held to when it begins enrolling — not as
> a description of anything currently running. The surface is **[Planned —
> Phase 3]** and gated on ethics review, a named Principal Investigator, a
> documented lawful basis (§4.5), and an instrument-licensing audit (§3.1).

*Draft · 2026-04-12 · author: product design, pending validation · pending ethics review before deployment*

Authoritative rules live in [BUSINESS_RULES.md §6](../BUSINESS_RULES.md). This document is the research protocol itself: consent, instruments, data handling, ethics posture, and transparency commitments.

The Analysis pillar of the public site is a promise. This document is what will deliver on it without crossing ethical or regulatory lines.

---

## 1. Why there is a research protocol at all

The public site at harmonicbeacon.com makes three research-related claims:

1. That we administer "already standardized surveys within the psychological research field" to sense the mind of a participant before and after an experience, plus a follow-up.
2. That we are "developing a battery of tests in relation to different neurological/biological markers."
3. That we aim to establish a ground for "Harmonically Aware Technology" as a concept.

> **The first two of those claims are not true today, and the site copy has to
> change.** No survey is administered to anyone. No battery of biological-marker
> tests is in development — §3.5 defers device integration entirely. The accurate
> statements are *we are building the capacity to administer* and *we intend to
> develop*. The third claim is stated as an aim and is fine as written.
>
> The site is a separate property outside this repository, so editing this
> document does not fix it. That copy audit is its own task and does not wait for
> the research surface itself: re-tensing a false present-tense claim is cheap,
> and leaving it up while the roadmap says Phase 3 is the most damaging single
> item in this corpus. **[Planned — Phase 1]**

These claims commit us to doing actual research, responsibly. A platform that claims "decentralized science is real" while failing basic ethics review loses both its science and its brand. A platform that claims research it is not doing loses them faster, and for less.

## 2. Ethics posture

### 2.1 The frame

Harmonic Beacon is not operating under a formal IRB (Institutional Review Board), because we are not a research institution. When the research surface ships we will be a platform that collects self-reported data from consenting adults who opt into a participant role. **Before any data collected is used in formal research, an IRB-equivalent review happens** — via partnership with a research institution, via a private IRB engagement, or via the ethics committee of a partnering university. No enrollment opens before that review. **[Planned — Phase 3]**

> **Unresolved:** which of those three routes we take. It is the first open
> question in §8 and it is not a drafting decision — it needs a named
> institution or a funded private engagement, and it gates the phase.

### 2.2 The posture we hold

Even before formal IRB coverage, we will run as if we were under review. This means:

- **Informed consent** for every instrument, before collection.
- **Revocable consent** — participants can withdraw at any time.
- **Data minimization** — no field is collected unless its research justification is documented.
- **Privacy by default** — data is de-identified for analysis; identifiable data lives only in access-controlled environments.
- **Transparency** — protocol is public, preregistered where possible, aggregate findings are published.

These are the commitments, not the current state: none of the five has an implementation to point at yet, because there is nothing collecting data for them to govern. **[Planned — Phase 3]**

### 2.3 Research staff and access

Research data will be the most sensitive data in the system. It will be handled by a named **Researcher role** under a documented data-use agreement. Admin will not get raw research data access by default; elevating a Researcher will require both a written justification and a revocable scope. Neither the role nor the agreement template exists — the `UserRole` enum has three values (`LISTENER`, `PROVIDER`, `ADMIN`), and today an Admin has unrestricted read access to every table. **[Planned — Phase 3]**

### 2.4 Participant protection

- Minors will not be research participants. The consent flow will require age attestation, and under-18 accounts will be blocked from research participation regardless. **No age gate exists in code today** — signup collects no date of birth and makes no 18+ affirmation, so this exclusion currently has nothing to enforce it. The gate is Phase 1 work and the research protocol depends on it: enrollment must not open before it lands. **[Planned — Phase 1]**
- Participants in any form of therapeutic care (named in the onboarding question) will be advised that Harmonic Beacon is not a substitute for care and that participation is entirely optional. **[Planned — Phase 3]**
- Withdrawal will be a single click; we will not require a reason. **[Planned — Phase 3]**

## 3. Instruments

### 3.1 Principle

We will use **validated** instruments wherever available, with clear licensing. We will not invent new scales at the launch stage. Each instrument listed below is a candidate; final selection happens with the ethics reviewer.

> **Every instrument named in §3.2–§3.4 is subject to a licensing audit that has
> not been done.** The 2026-06-09 legal audit ([LEGAL_AUDIT.md
> L16](./audit/LEGAL_AUDIT.md)) found that two of the scales this protocol names
> as the likely pre/post pair are commercially licensed: it reports POMS-SF as
> licensed through MHS, and STAI — including its short forms — as licensed
> through Mind Garden with per-administration fees. We have not confirmed either
> term with its publisher, and nothing below should be read as a statement of
> license terms. **Each named scale needs written confirmation from its rights
> holder before it is administered to a single participant**, because
> administering a licensed psychometric instrument in-product without a license
> is a copyright problem sitting inside the most scrutinized surface the platform
> has.
>
> The audit also notes that free or permissively licensed alternatives exist
> where the construct is equivalent — it cites WHO-5 as free with attribution,
> and I-PANAS-SF and the PSS as carrying permissive research-use terms. Those
> terms also need confirming, but they are the direction to look first: where a
> free instrument measures what we need, the licensed one is a cost and a
> liability we are choosing for no research gain. **[Planned — Phase 2]**

### 3.2 Pre-session short-form (≤ 2 min)

Intent: capture baseline state before a session. Options on the shortlist (to be reviewed, subject to §3.1):

- **POMS-SF** (Profile of Mood States — Short Form) — mood state baseline, validated, widely used. Reported as commercially licensed; clearance required.
- **STAI-6** (State-Trait Anxiety Inventory — 6-item) — state anxiety, validated. Reported as licensed with per-administration fees; clearance required.
- A single open-ended *intention* field: "What brings you to the beacon right now?" — never required. Our own wording, no licensing question.

### 3.3 Post-session short-form (≤ 2 min)

Intent: capture state after a session. Options (subject to §3.1):

- **POMS-SF** repeat, for delta. Same clearance requirement as §3.2.
- **PANAS** (Positive and Negative Affect Schedule) — affect state, brief form. Check terms for the specific form used; the audit reports I-PANAS-SF as the permissive option.
- A single open-ended reflection field: "If you want to, describe what you noticed" — never required, stored in the Resonance Journal if consented. Our own wording.

### 3.4 Longitudinal follow-up (weekly, opt-in)

Intent: capture trajectory. Options (subject to §3.1):

- **WHO-5 Well-being Index** — short, validated, internationally used. Reported as free with attribution; confirm the attribution requirement and reproduce it in-product.
- **FFMQ-SF** (Five Facet Mindfulness Questionnaire — Short Form) — if we hypothesize shifts in attentional qualities. Terms unverified.
- A single open-ended *notable change* field — never required. Our own wording.

### 3.5 Device-based (deferred, Phase 3+)

Intent: objective correlates. Will only integrate if:

- The device is owned by the participant.
- Consent is explicit at device-connection time, separate from session consent.
- Data is encrypted in transit and at rest, de-identified for analysis.

Candidate integrations to evaluate: Apple Health, Google Fit, Oura, Muse, Whoop. Each integration will require its own consent and its own justification. **[Planned — unscheduled]**

> *The organizations named above are candidates we may approach. No affiliation,
> partnership or endorsement is implied, and none has any stated relationship
> with this project.*

### 3.6 Resonance Journal as a research instrument (opt-in)

The Resonance Journal (see [BUSINESS_RULES.md §7.3](../BUSINESS_RULES.md)) will be participant-owned. With separate consent, structured fields (mood score, numeric self-report) may be fed into research. Free-form text will **never** be analyzed as part of research unless re-consented in a specific study. The journal itself does not exist — no `JournalEntry` model is in the schema — and its encryption design is the unresolved question flagged in [BUSINESS_RULES.md §7.3](../BUSINESS_RULES.md). **[Planned — Phase 2]**

Note that a mood score is not a lesser category of data than the free-form body. It is the structured fields, not the prose, that §4.5 classifies as health data.

## 4. Data handling

### 4.1 Classification

Research data will be classified into three levels. None of the three exists yet; there is no research schema to classify anything in. **[Planned — Phase 3]**

- **Identifiable** — links to `User.id`, `User.email`, or other direct identifiers. Access: Researcher role only, under data-use agreement. Never exported to any analytic tool.
- **Pseudonymized** — linked to a stable research participant ID (`rpid`) that does **not** reference the user directly. Access: Researcher role in analysis environments. **Pseudonymized is not anonymous** — see §4.5.
- **Aggregate** — counts, means, distributions over ≥ N participants where N ≥ 10 (tentative; revised by ethics review). Access: public.

### 4.2 Pipeline

The intended flow, to be built in Phase 3. No stage of it runs today: there is no consent check, no research schema, no pseudonymization job and no public dashboard. **[Planned — Phase 3]**

```
user action ──┐
              ▼
  consent check  ─── no ──▶ drop
              │
              ▼ yes
  identifiable record (Postgres, encrypted at rest)
              │
              ▼ pseudonymization job
  rpid record in research schema
              │
              ▼ analytics job
  aggregate record (public dashboard)
```

Two things in that diagram are commitments rather than descriptions and should be read as such: "encrypted at rest" is not currently true of the application database ([TRUST_AND_SAFETY.md](./TRUST_AND_SAFETY.md) makes the same claim and the tech audit contradicts it), and the pseudonymization job will run inside the trusted environment.

### 4.3 Processors

An earlier draft of this document asserted that "no third-party processor touches identifiable data except Stripe (billing) and our email provider (transactional)". That sentence was wrong in both directions — neither Stripe nor an email provider is integrated, and the roadmap adds several processors the sentence excluded. An absolute claim about processors is falsified the day a dependency is added, so this section is a dated list instead. Maintaining it is also what GDPR Art. 28 and Art. 30 record-keeping will require.

**Processors with access to identifiable data, as of 2026-06-09:**

| Processor | Data | Role |
|---|---|---|
| Zitadel (`auth.altermundi.net`, AlterMundi-operated) | Email, name, OIDC subject | Identity provider — see `src/lib/auth-config.ts` |
| PostgreSQL and object storage on AlterMundi-operated hosts | All application data | First-party infrastructure |
| LiveKit, self-hosted on AlterMundi infrastructure | Live audio, participant identities | Real-time transport |

No payment processor, email provider, error-tracking, crash-reporting, analytics or push-notification service is integrated today.

**We update this list before adding a processor, not after.** The roadmap already names candidates that will belong here, each of which is a processor decision and not merely a dependency choice: Sentry with release tracking (Phase 1), a transactional email provider such as Resend or Postmark (Phase 2), Stripe including Connect KYC for provider payouts (Phase 2), Firebase Crashlytics (Phase 3 — Google as processor, with its own data-sharing posture, which is the one on this list most worth a second look before it is adopted), and a push-notification service (Phase 3). None is integrated; none may be added while this table still says it is not.

### 4.4 Retention

- Identifiable data: retained while the participant is active or has not withdrawn; purged within 30 days of account deletion. This depends on the deletion endpoint, which does not exist — see [BUSINESS_RULES.md §9.1](../BUSINESS_RULES.md). **[Planned — Phase 1]**
- Pseudonymized data: retained for longitudinal study, subject to withdrawal-time preference and to a documented retention justification per §4.5. **[Planned — Phase 3]**
- Aggregate data: retained indefinitely; never purged (it is not personal, provided the K threshold in §6.2 holds).

> **Unresolved — the retention period for pseudonymized data.** An earlier draft
> said "indefinitely", which does not survive contact with §4.5: pseudonymized
> data is still personal data, and personal data needs a storage period or the
> criteria that determine one. Longitudinal research is a legitimate reason for a
> long period; it is not a reason for an unbounded one. Counsel and the ethics
> reviewer set a number or a rule (e.g. "for the duration of the study plus N
> years, then aggregated or erased"), the consent copy states it, and this
> document is rewritten from that. Until then no retention period should be
> quoted to a participant.

### 4.5 Legal basis and special-category data

> This section is a gap in the protocol's **legal** basis, not in its ethics. The
> ethics posture in §2 is genuinely careful — opt-in by default, revocable,
> minimized, minors excluded, findings published whether or not they flatter us.
> That posture is most of what a lawful basis needs. What is missing is the
> paperwork that turns it into one, and it has to exist before enrollment rather
> than after. **[Planned — Phase 3]**

**The instruments produce health data.** POMS-SF, STAI-6, PANAS and WHO-5 measure mood, anxiety and well-being. Responses to them are data concerning health, which is a **special category** under GDPR Art. 9(1) — and processing special-category data is prohibited by default, permitted only where one of the Art. 9(2) conditions is met. Argentina's Ley 25.326 has an analogous category of *datos sensibles* covering health, with its own consent requirements. Neither classification appears anywhere in this protocol as it stands, and neither is optional. The Resonance Journal's structured mood score falls in the same category (§3.6).

**The lawful basis will be explicit consent**, under Art. 9(2)(a) and the corresponding provision of Ley 25.326, with the Art. 6 basis being consent as well. That choice has consequences the consent flow must honour:

- Explicit consent is a higher bar than ordinary consent. It has to be a clear affirmative statement covering the specific processing, freely given, and separable from every other agreement — not bundled into Terms acceptance, and not inferred from signing up or from continuing to listen. The implied-consent pattern the audit found in the session-recording flow ([LEGAL_AUDIT.md L4](./audit/LEGAL_AUDIT.md)) is exactly what must not appear here.
- Consent must be as easy to withdraw as to give, which §2.4's one-click withdrawal already commits to.
- Consent is per-purpose. A participant consenting to pre/post surveys has not consented to device data (§3.5), to journal-field analysis (§3.6), or to inclusion in a quarterly public dataset (§6.2). Each is its own consent.
- Because the basis is consent, we cannot fall back on "legitimate interests" for the same data if a participant withdraws. Withdrawal means the processing stops.

**Pseudonymized data is still personal data.** An `rpid` that can be re-linked to a user — even if only through a key we hold, and even if that key lives in a separate schema — is pseudonymization, not anonymization, and GDPR applies to it in full: access rights, erasure rights, retention limits, breach notification. Anonymous data is data that cannot be re-linked by anyone, including us. §4.4's severing of the `rpid` at withdrawal is the step that approaches genuine anonymization, and whether it arrives there depends on whether the remaining record is still singling out an individual. This is why §4.4's "indefinitely" had to go.

**Cross-border transfer.** The platform is operated from Argentina on Argentine infrastructure, and the EU is plainly in scope — [MONETIZATION.md](./MONETIZATION.md) quotes prices in EUR and GBP and [PHASE_2_PARTICIPATION.md](./phases/PHASE_2_PARTICIPATION.md) plans EU/UK VAT collection. Argentina holds an EU adequacy decision, which is the reason this is a manageable question rather than a hard one, but it is not a reason to skip the analysis: the adequacy finding needs confirming as current, the transfer needs documenting, and the position of any processor added under §4.3 in a third country needs assessing on its own terms.

**What Phase 3 owes before enrollment opens:**

- A written lawful-basis note naming the Art. 6 and Art. 9(2) grounds, reviewed by counsel.
- Consent copy that meets the explicit-consent bar, per purpose, drafted with the ethicist (§8.4).
- A retention period or rule for pseudonymized data (§4.4).
- A record of processing activities under Art. 30, of which §4.3 is the beginning.
- A DPIA. High-risk processing of special-category data at scale is close to the paradigm case for Art. 35, and the assessment of whether one is required is itself part of the file.
- A documented transfer position for the AR/EU pair.
- A named controller. Which AlterMundi entity is the controller has not been stated anywhere in this corpus, and a data subject cannot exercise a right against an unnamed one.

> **Unresolved:** all seven of the above need counsel, and the consent copy needs
> the ethicist as well. This is not work the product team can close by drafting.
> It belongs to the "Counsel engagement" open thread in
> [README.md](./README.md#open-threads) and it gates Phase 3 as squarely as the
> ethics review does.

### 4.6 On withdrawal

At withdrawal, the participant will choose:

- **Erase everything** — identifiable and pseudonymized records for that participant are purged within 30 days.
- **Erase identifiable, retain pseudonymized** — the default for participants who want to contribute to research without remaining personally linked. The `rpid` record is severed from the user.

Either option leaves aggregate data unchanged. Note that the second option is only meaningful if the severing is irreversible in practice, not merely in policy — see §4.5. **[Planned — Phase 3]**

## 5. Protocol change management

Every protocol change will be documented in this file's `CHANGELOG` (to be created) and preregistered where possible on a public registry (e.g. OSF preregistration or equivalent). Emergency fixes that could not be preregistered will be published retrospectively with a rationale. **[Planned — Phase 3]**

Versioning, once instruments are administered:

- Each instrument will carry a version (e.g. `POMS-SF v1.2 HB`). Note that a locally versioned adaptation of a licensed instrument is a derivative work, and whether we may make one at all is part of the §3.1 clearance.
- Each participant's responses will be tagged with the instrument version they answered.
- Version changes will not back-annotate existing responses.

## 6. Transparency commitments

Nothing in this section is published today. There is no `/research` page, no public dataset, and no readout. **[Planned — Phase 3]**

### 6.1 Public dashboard

A public research page will show, updated monthly:

- Number of participants (aggregate).
- Number of sessions contributing to research.
- Distribution of baseline and delta on published scales (aggregated, no individual records).
- Current preregistered protocols.
- Published findings.

The route is not named here because it does not exist yet; naming a URL that returns 404 is the thing this corpus is trying to stop doing.

### 6.2 Data releases

Every quarter, a de-identified research dataset snapshot will be published under a Creative Commons license, after ethics review. Individual records in the snapshot will be aggregated to K ≥ 10 where needed to prevent re-identification. Publication under an open license is irreversible, which is why it is a separate consent (§4.5) and why the K threshold is an ethics-reviewer decision (§8.7) rather than ours.

### 6.3 Findings

Findings will be published as:

- **Readouts** — short blog-form summaries in the Analysis section, in both EN and ES.
- **Preprints** — for substantive results, posted to PsyArXiv or equivalent.
- **Peer-reviewed** — for results that warrant it, through academic partners.

We will publish negative and null results as readily as positive ones.

## 7. What we won't do

These are refusals, and they hold from today — they constrain what we build, so they do not wait on Phase 3.

- We will not correlate research data with third-party behavioural profiles.
- We will not share identifiable research data with advertisers, data brokers, or insurers.
- We will not use research data to segment Listeners for commercial purposes.
- We will not use research findings to make therapeutic claims in our marketing.
- We will not retain research data against a participant's withdrawal, except in aggregate form if explicitly consented.
- We will not preregister a protocol and then not publish a result, positive or null.
- We will not administer an instrument we have not cleared for licensing (§3.1).
- We will not claim, on any surface, to be collecting research data that we are not collecting (§1).

## 8. Open questions (pre-validation)

Each of these needs to be resolved before the research surface launches in Phase 3. Items 1, 2, 4 and 7 need a human decision this document cannot make; item 8 needs counsel.

1. **Institutional partner.** A named research institution strengthens the IRB posture and the credibility of findings. Candidates to pursue: CONICET (AR), universities with contemplative science programs in AR/Spain, the Mind & Life network. *These are organizations we may approach. No affiliation, partnership or endorsement is implied, and none has any stated relationship with this project.*
2. **Principal investigator.** The protocol needs a PI willing to stand behind it. There is no candidate named.
3. **Instrument licensing.** See §3.1 — this is larger than an open question and is now a precondition. Each named scale needs written confirmation from its rights holder, and free equivalents should be preferred where the construct allows.
4. **Informed consent copy.** Drafting with a participant-experience focus, validated by an ethicist, and meeting the explicit-consent bar in §4.5.
5. **Preregistration platform.** OSF is a default candidate; alternatives TBD.
6. **Data-use agreement template.** For the future Researcher role (§2.3).
7. **K-anonymity threshold** for public aggregates. Default K=10 proposed; validate with an ethicist.
8. **Data-protection file.** The seven items in §4.5, including the named controller entity, the lawful-basis note, the DPIA determination and the retention rule.

## 9. Appendix: why this document exists

A decentralized-science claim is trivially easy to make and easy to fail. The failure mode is specific: a skeptical journalist or a regulator finds that we collect data under vague consent, never publish anything, and use the research frame as marketing. The protocol described here is designed to make that failure impossible by construction — consent is explicit, data is minimized, findings are published whether they flatter us or not, and the whole process is legible to an outsider. This document *is* the legibility.

The 2026-06-09 audit found that the exposure today is the inverse of the one this appendix anticipated, and no less damaging: not research conducted under vague consent, but research claimed and not conducted. The document guarded the harder failure and walked past the easier one. That is worth recording, because it is the same mistake the whole corpus made — describing the protocol so thoroughly that the description started reading as a report. The safeguard is [VISION.md](./VISION.md) promise 7, applied to this file as strictly as to any marketing page: *"'We believe' and 'we hope to prove' are never replaced with 'we have proven' without evidence we can point to."*
