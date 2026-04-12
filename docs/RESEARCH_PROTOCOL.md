# Research Protocol

*Draft · 2026-04-12 · author: product design, pending validation · pending ethics review before deployment*

Authoritative rules live in [BUSINESS_RULES.md §6](../BUSINESS_RULES.md). This document is the research protocol itself: consent, instruments, data handling, ethics posture, and transparency commitments.

The Analysis pillar of the public site is a promise. This document is what delivers on it without crossing ethical or regulatory lines.

---

## 1. Why there is a research protocol at all

The public site makes three research-related claims:

1. We administer "already standardized surveys within the psychological research field" to sense the mind of a participant before and after an experience, plus a follow-up.
2. We are "developing a battery of tests in relation to different neurological/biological markers."
3. We aim to establish a ground for "Harmonically Aware Technology" as a concept.

These claims commit us to doing actual research, responsibly. A platform that claims "decentralized science is real" while failing basic ethics review loses both its science and its brand.

## 2. Ethics posture

### 2.1 The frame

At launch, Harmonic Beacon is not operating under a formal IRB (Institutional Review Board) because we are not a research institution. We are a platform that collects self-reported data from consenting adults who opt into a participant role. **Before any data collected is used in formal research, an IRB-equivalent review happens** — via partnership with a research institution, via a private IRB engagement, or via the ethics committee of a partnering university.

### 2.2 The posture we hold

Even before formal IRB coverage, we run as if we were under review. This means:

- **Informed consent** for every instrument, before collection.
- **Revocable consent** — participants can withdraw at any time.
- **Data minimization** — no field is collected unless its research justification is documented.
- **Privacy by default** — data is de-identified for analysis; identifiable data lives only in access-controlled environments.
- **Transparency** — protocol is public, preregistered where possible, aggregate findings are published.

### 2.3 Research staff and access

Research data is the most sensitive data in the system. It is handled by a named **Researcher role** (future, Phase 2) under a documented data-use agreement. Admin does **not** get raw research data access by default; elevating a Researcher requires both a written justification and a revocable scope.

### 2.4 Participant protection

- Minors are not research participants. The consent flow requires age attestation; under-18 accounts are blocked from research participation regardless.
- Participants in any form of therapeutic care (named in the onboarding question) are advised that Harmonic Beacon is not a substitute for care and that participation is entirely optional.
- Withdrawal is a single click; we do not require a reason.

## 3. Instruments

### 3.1 Principle

We use **validated** instruments wherever available, with clear licensing. We do not invent new scales at the launch stage. Each instrument listed below is a candidate; final selection happens with the ethics reviewer.

### 3.2 Pre-session short-form (≤ 2 min)

Intent: capture baseline state before a session. Options on the shortlist (to be reviewed):

- **POMS-SF** (Profile of Mood States — Short Form) — mood state baseline, validated, widely used.
- **STAI-6** (State-Trait Anxiety Inventory — 6-item) — state anxiety, validated.
- A single open-ended *intention* field: "What brings you to the beacon right now?" — never required.

### 3.3 Post-session short-form (≤ 2 min)

Intent: capture state after a session. Options:

- **POMS-SF** repeat, for delta.
- **PANAS** (Positive and Negative Affect Schedule) — affect state, brief form.
- A single open-ended reflection field: "If you want to, describe what you noticed" — never required, stored in the Resonance Journal if consented.

### 3.4 Longitudinal follow-up (weekly, opt-in)

Intent: capture trajectory. Options:

- **WHO-5 Well-being Index** — short, validated, internationally used.
- **FFMQ-SF** (Five Facet Mindfulness Questionnaire — Short Form) — if we hypothesize shifts in attentional qualities.
- A single open-ended *notable change* field — never required.

### 3.5 Device-based (deferred, Phase 3+)

Intent: objective correlates. Only integrates if:

- The device is owned by the participant.
- Consent is explicit at device-connection time, separate from session consent.
- Data is encrypted in transit and at rest, de-identified for analysis.

Candidate integrations: Apple Health, Google Fit, Oura, Muse, Whoop. Each integration requires its own consent and its own justification.

### 3.6 Resonance Journal as a research instrument (opt-in)

The Resonance Journal (see [BUSINESS_RULES.md §7.3](../BUSINESS_RULES.md)) is participant-owned. With separate consent, structured fields (mood score, numeric self-report) may be fed into research. Free-form text is **never** analyzed as part of research unless re-consented in a specific study.

## 4. Data handling

### 4.1 Classification

All research data is classified into three levels:

- **Identifiable** — links to `User.id`, `User.email`, or other direct identifiers. Access: Researcher role only, under data-use agreement. Never exported to any analytic tool.
- **Pseudonymized** — linked to a stable research participant ID (`rpid`) that does **not** reference the user directly. Access: Researcher role in analysis environments.
- **Aggregate** — counts, means, distributions over ≥ N participants where N ≥ 10 (tentative; revised by ethics review). Access: public.

### 4.2 Pipeline

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

The pseudonymization job runs inside the trusted environment; no third-party processor touches identifiable data except Stripe (billing) and our email provider (transactional).

### 4.3 Retention

- Identifiable data: retained while the participant is active or has not withdrawn; purged within 30 days of account deletion.
- Pseudonymized data: retained indefinitely for longitudinal study, subject to withdrawal-time preference.
- Aggregate data: retained indefinitely; never purged (it is not personal).

### 4.4 On withdrawal

At withdrawal, the participant chooses:

- **Erase everything** — identifiable and pseudonymized records for that participant are purged within 30 days.
- **Erase identifiable, retain pseudonymized** — the default for participants who want to contribute to research without remaining personally linked. The `rpid` record is severed from the user.

Either option leaves aggregate data unchanged.

## 5. Protocol change management

Every protocol change is documented in this file's `CHANGELOG` (future) and preregistered where possible on a public registry (e.g. OSF preregistration or equivalent). Emergency fixes that couldn't be preregistered are published retrospectively with a rationale.

Versioning:

- Each instrument has a version (e.g. `POMS-SF v1.2 HB`).
- Each participant's responses are tagged with the instrument version they answered.
- Version changes do not back-annotate existing responses.

## 6. Transparency commitments

### 6.1 Public dashboard

A public `/research` page shows, updated monthly:

- Number of participants (aggregate).
- Number of sessions contributing to research.
- Distribution of baseline and delta on published scales (aggregated, no individual records).
- Current preregistered protocols.
- Published findings.

### 6.2 Data releases

Every quarter, a de-identified research dataset snapshot is published under a Creative Commons license, after ethics review. Individual records in the snapshot are aggregated to K ≥ 10 where needed to prevent re-identification.

### 6.3 Findings

Findings are published as:

- **Readouts** — short blog-form summaries in the Analysis section, in both EN and ES.
- **Preprints** — for substantive results, posted to PsyArXiv or equivalent.
- **Peer-reviewed** — for results that warrant it, through academic partners.

We publish negative and null results as readily as positive ones.

## 7. What we won't do

- We will not correlate research data with third-party behavioural profiles.
- We will not share identifiable research data with advertisers, data brokers, or insurers.
- We will not use research data to segment Listeners for commercial purposes.
- We will not use research findings to make therapeutic claims in our marketing.
- We will not retain research data against a participant's withdrawal, except in aggregate form if explicitly consented.
- We will not preregister a protocol and then not publish a result, positive or null.

## 8. Open questions (pre-validation)

Each of these needs to be resolved before the research surface launches in Phase 3:

1. **Institutional partner.** A named research institution strengthens the IRB posture and the credibility of findings. Candidates to pursue: CONICET (AR), universities with contemplative science programs in AR/Spain, Mind & Life network.
2. **Principal investigator.** The protocol needs a PI willing to stand behind it.
3. **Instrument licensing.** Some validated scales (e.g. PSS, PANAS) are free; others may have fees or use restrictions. A scale-licensing audit is Phase 2 work.
4. **Informed consent copy.** Drafting with a participant-experience focus, validated by an ethicist.
5. **Preregistration platform.** OSF is a default candidate; alternatives TBD.
6. **Data-use agreement template.** For the future Researcher role.
7. **K-anonymity threshold** for public aggregates. Default K=10 proposed; validate with an ethicist.

## 9. Appendix: why this document exists

A decentralized-science claim is trivially easy to make and easy to fail. The failure mode is specific: a skeptical journalist or a regulator finds that we collect data under vague consent, never publish anything, and use the research frame as marketing. The protocol described here is designed to make that failure impossible by construction — consent is explicit, data is minimized, findings are published whether they flatter us or not, and the whole process is legible to an outsider. This document *is* the legibility.
