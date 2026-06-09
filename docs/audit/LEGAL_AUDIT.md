# Legal Audit — Product & Policy Documentation

*Audit date: 2026-06-09 · Scope: the `docs/` policy corpus + `BUSINESS_RULES.md` + root `README.md` claims · See [README.md](./README.md) for methodology and severity scale.*

Each finding states: where it is (file:line), what it says, why it is a problem, and a recommended action. Line numbers refer to repo state at commit `b72b279`. Findings are ordered by severity, then by document.

---

## BLOCKER

### L1 — No license; "All rights reserved" on a repo being prepared for public release

- **Where**: `README.md:95` ("© 2026 AlterMundi. All rights reserved. Content and code ownership details are maintained in separate legal agreements"); no `LICENSE` file anywhere in the repo; `package.json` has `"private": true` and **no `license` field**.
- **Problem**: Publishing a repository with no license is not a neutral default — it leaves every visitor with zero rights to use, copy, or run the code, while the README's reference to "separate legal agreements" (which are not in the repo and are not identified) creates ambiguity about who owns what. If the intent is open source, a license must be chosen; if the intent is source-available/proprietary, that must be stated explicitly (`LICENSE` file with proprietary terms, `"license": "UNLICENSED"` in `package.json`).
- **Action**: Counsel + AlterMundi decide the licensing posture **before** visibility flips. Add `LICENSE`, set `package.json` license field, and make `README.md:95` consistent with the decision. Note that AlterMundi's existing public projects may set a precedent worth matching.

### L2 — Guaranteed data rights (export, deletion) that the system cannot deliver

- **Where**:
  - `BUSINESS_RULES.md:31` — Listener guarantee: "One-click account export; one-click account deletion."
  - `BUSINESS_RULES.md:279` — "a Listener may download, via `/api/users/me/export`, their profile, listening history, favourites, research participations and responses, patronage status, and journal entries."
  - `BUSINESS_RULES.md:280` — "a Listener may delete their account at any time via `/api/users/me`. Deletion purges identifiable data within 30 days."
- **Problem**: Neither endpoint exists (`src/app/api/users/me/route.ts` implements GET only; verified 2026-06-09). These are written as present-tense product guarantees naming specific API routes. If published, they are representations about data-subject rights (GDPR Arts. 15/17/20 territory, and Argentina's Ley 25.326 equivalents) that the platform cannot honor. A regulator or journalist testing the claim would falsify it in minutes.
- **Action**: Either implement export + deletion before release, or rewrite §1.1 and §9.1 as commitments with a phase marker. Do not publish a named endpoint that returns 404/405.

### L3 — GDPR 72-hour rule misstated (wrong addressee)

- **Where**: `docs/TRUST_AND_SAFETY.md:137` — Data-exposure playbook: "**Notify** — affected users notified within the timeframe required by the applicable data-protection law (72 hours for GDPR)."
- **Problem**: GDPR's 72-hour deadline (Art. 33) applies to notifying the **supervisory authority**. Notification of affected data subjects (Art. 34) is "without undue delay" when the breach is high-risk — a different obligation with a different trigger. As written, the playbook misstates the law in a document intended for public release, and an incident team following it literally would conflate the two duties.
- **Action**: Correct the playbook to distinguish Art. 33 (authority, 72h) from Art. 34 (users, without undue delay, high-risk threshold). Add the applicable Argentine framework (Ley 25.326 / AAIP guidance) since the operating entity and hosting are in Argentina, and identify which law applies when.

### L4 — Session recording based on implied consent

- **Where**: `docs/TRUST_AND_SAFETY.md:54` — "Recordings are disclosed to participants before joining. **Participation implies consent to recording.**" Related: `BUSINESS_RULES.md:106` ("Recording is disclosed in-UI to participants before they join").
- **Problem**: "Participation implies consent" is precisely the consent model GDPR rejects (consent must be unambiguous, and recording of voice in a contemplative/wellness session context can capture special-category data — see L13). It also contradicts the platform's own research-consent posture (`docs/RESEARCH_PROTOCOL.md` §2.2: "Informed consent for every instrument, before collection"). The product is one consent standard; the sessions are another.
- **Action**: Replace with an affirmative pre-join consent step ("this session is recorded — Join and accept / Decline"), or rely on a lawful basis other than consent with counsel's sign-off, and align the wording across both docs.

### L5 — The live marketing site claims research activity that does not exist

- **Where**: `docs/RESEARCH_PROTOCOL.md:13-17` — "The public site makes three research-related claims: 1. We administer 'already standardized surveys within the psychological research field'… 2. We are 'developing a battery of tests…'". Also `docs/VISION.md:50` ("our own uptime, our own aggregate listener metrics, our own provider count — these are public" — they are not), and `BUSINESS_RULES.md` §6 written in operative present tense.
- **Problem**: Per the roadmap itself, **no research data collection exists until Phase 3**, and no consent/survey models exist in the schema (verified). The protocol doc candidly records that harmonicbeacon.com *already* makes present-tense claims of administering surveys. `RESEARCH_PROTOCOL.md:194` itself names the failure mode: "a skeptical journalist or a regulator finds that we collect data under vague consent, never publish anything, and use the research frame as marketing." Right now the exposure is the inverse but equally damaging: claiming research that is not occurring — consumer-protection (deceptive practice) territory, and brand-fatal for a "decentralized science" positioning.
- **Action**: Audit harmonicbeacon.com copy now (do not wait for Phase 1): re-tense research claims to "we are building / will administer." Re-tense `BUSINESS_RULES.md` §6 and `VISION.md` promise 6 to future commitments. This is the single highest-credibility-risk item in the corpus.

---

## HIGH

### L6 — Safety and compliance controls asserted in the present tense that do not exist

- **Where** (selection; full technical inventory in [TECH_AUDIT.md](./TECH_AUDIT.md)):
  - `BUSINESS_RULES.md:62` "Every administrative action is written to the audit log" — no audit log exists.
  - `BUSINESS_RULES.md:302-304` "Every scheduled session has an Admin-accessible kill-switch… Every content surface… has a report button. Reports are acknowledged within 24 hours" — none implemented.
  - `docs/TRUST_AND_SAFETY.md:32-36` CAPTCHA, email verification before first listen, per-IP signup rate limit — none implemented.
  - `docs/TRUST_AND_SAFETY.md:65-66` "At-rest encryption on Postgres. PII in logs is mechanically filtered" — neither is true; the app logs user emails in plaintext (`src/lib/auth-config.ts:89`).
  - `docs/TRUST_AND_SAFETY.md:199-208` public `/trust` page, status page — do not exist.
- **Problem**: For a wellness-adjacent platform inviting vulnerable users, publicly asserting safety controls that don't exist is worse than not having them: it is a misrepresentation that aggravates liability in any later incident ("you told users reports were acknowledged within 24 hours"). SLA promises (24h acknowledgement, 5-business-day review, postmortems within 14 days) are quasi-contractual once published.
- **Action**: A single decision applies to the whole class: every control statement gets either (a) implemented, or (b) re-tensed and phase-tagged. Legal should specifically review the SLA numbers before they are ever published, because they become the standard the platform is judged against.

### L7 — README presents draft policies as "enforceable" commitments

- **Where**: `README.md:81` — "The product makes public commitments that are **documented and enforceable**," followed by links to the five policy docs — every one of which is marked "Draft · pending validation."
- **Problem**: "Enforceable" invites a contractual reading of documents the team itself has not ratified, and which (per this audit) the system does not implement. It is the single word in the corpus most likely to be quoted back in a dispute.
- **Action**: Replace with accurate framing, e.g. "documented; they will bind us as they are ratified and shipped." Keep the doc-status banners prominent.

### L8 — Contradiction: provider recording/content license — perpetual or revocable?

- **Where**:
  - `BUSINESS_RULES.md:108` — "the platform retains a **perpetual, royalty-free license** to serve it [the session recording]."
  - `BUSINESS_RULES.md:286-287` — "the platform's license to serve them is **revoked on removal** unless otherwise agreed."
  - `docs/CONTENT_POLICY.md:194` — "License **terminates on content removal**, subject to cached-delivery technical tail of up to 30 days."
  - `docs/CONTENT_POLICY.md:198` — "Term: **perpetual** license for content the Provider chose to publish, **terminable by removal**."
- **Problem**: "Perpetual" and "terminates on removal" are different deal terms stated as the same policy in two canonical documents. The Provider Content Agreement (maintained outside the repo per CONTENT_POLICY §7) will have to pick one; until then, the published summary contradicts itself — a dispute magnet with the exact audience (Providers) these docs are meant to reassure. Note "perpetual, terminable" is also internally confused drafting: the intended term is likely "non-exclusive license for the duration of publication, plus a 30-day technical tail."
- **Action**: Counsel fixes the term once, in the Content Agreement, and all three doc locations are rewritten from it.

### L9 — Contradiction: two different provider revenue-share models, both called "50%"

- **Where**:
  - `BUSINESS_RULES.md:202` — "a defined share (**default 50%, configurable per-provider**) of *attributable patronage revenue* is paid monthly."
  - `docs/MONETIZATION.md:121` — "Attributable revenue share **pool = 50% of net patronage revenue (after payment processing fees and Harmonic Beacon's operating cut** — published quarterly)," distributed pro-rata by listening time.
- **Problem**: These are materially different economics: (a) a per-provider 50% share of revenue attributable to that provider vs. (b) a common pool of 50% of *net-of-operating-cut* platform revenue split pro-rata. Under (b), "50%" of "net after our cut" can be an arbitrarily small fraction of gross — describing it with the same headline number as (a) is the kind of statement a payments regulator or a provider dispute would characterize as misleading. The canonical doc and its detail doc must not disagree on money.
- **Action**: Pick one model; define "net" exhaustively (what the "operating cut" is, who sets it, where it is published); rewrite both docs from the single definition. Until the formula is fixed, do not publish a percentage.

### L10 — Tax-deductibility implication for patronage payments

- **Where**: `docs/MONETIZATION.md:175` — "Annual patrons receive a year-end summary **for deductibility where applicable**"; `docs/phases/PHASE_2_PARTICIPATION.md:43` — "Annual year-end summary email with total patronage contribution (**for tax-deductibility where applicable**)."
- **Problem**: Patronage payments to a non-charitable entity are generally not tax-deductible in any of the named launch geographies. "Where applicable" hedges, but the sentence exists to suggest deductibility. Unless the receiving AlterMundi entity has charitable status in the patron's jurisdiction, this invites patrons to take deductions the platform implied were available.
- **Action**: Remove the deductibility framing, or condition it explicitly on the entity's verified status per jurisdiction ("a summary of your contributions; consult your tax advisor — patronage is not a charitable donation unless stated"). Tie to the "tax advisor engagement" open thread (`docs/README.md:67`).

### L11 — DMCA framework assumed for an Argentina-operated platform

- **Where**: `BUSINESS_RULES.md:161` — "copyright complaint (**DMCA path**)"; `docs/CONTENT_POLICY.md:168,177` and `docs/TRUST_AND_SAFETY.md:151-158` use the better-hedged "DMCA-style notice or equivalent under applicable law."
- **Problem**: DMCA safe-harbor protection requires, among other things, a registered agent with the US Copyright Office and is US law; the platform is operated from Argentina on Argentine infrastructure with an international audience. Naming "DMCA" as *the* path overstates available protection and understates obligations under other regimes (e.g., EU DSA notice-and-action if EU users are in scope — and EU pricing/VAT plans say they are).
- **Action**: Counsel defines the actual notice-and-takedown framework (jurisdiction, agent registration if DMCA protection is wanted, DSA exposure assessment) and the docs adopt one consistent, hedged formulation.

### L12 — Health-benefit claim leaks past the platform's own language rules

- **Where**: `docs/PRODUCT_PRINCIPLES.md:83` — "The populations that **most benefit from the beacon** include neurodiverse, disabled, elderly, and non-technical users."
- **Problem**: The corpus's own rule (`PRODUCT_PRINCIPLES.md:45-46`) bans unhedged clinical-adjacent claims; "populations that most benefit" is an unhedged efficacy claim about clinically defined populations, in the very document that defines the rule. Singly it is small; in a regulator's or journalist's hands it is the example that shows the discipline is cosmetic. Same pattern risk: `docs/VISION.md:7` "help a human being remember a state of spiritual homeostasis" is fine under the rules (spiritual frame), but the boundary must be policed exactly because the frame walks the line.
- **Action**: Rewrite to accessibility framing without the efficacy claim ("The populations the beacon must not exclude include…"). Add this audit's finding as a test case for the planned language linter (`PRODUCT_PRINCIPLES.md:50`).

### L13 — GDPR special-category data (mental health) not addressed anywhere

- **Where**: `docs/RESEARCH_PROTOCOL.md` §3 (instruments: POMS-SF, STAI-6, PANAS, WHO-5 — mood and anxiety scales), §4 (data handling), §4.3 ("Pseudonymized data: retained **indefinitely**").
- **Problem**: Mood/anxiety/well-being survey responses are health data — special-category under GDPR Art. 9 — and the protocol never performs that classification, names a lawful basis, or addresses Art. 9(2) conditions. Two specific frictions: (a) pseudonymized data **is still personal data** under GDPR; "retained indefinitely" needs a justification and conflicts with the doc's own erasure framing; (b) the EU is plainly in scope (EUR/GBP pricing in `MONETIZATION.md:77`, EU VAT in `PHASE_2:31`). Argentina's Ley 25.326 has an analogous sensitive-data category. The protocol's ethics posture is genuinely good — this is a legal-basis gap, not an ethics gap.
- **Action**: Add a data-protection section to RESEARCH_PROTOCOL.md (classification: Art. 9 health data; lawful basis: explicit consent; pseudonymization ≠ anonymization; retention justification; cross-border transfer analysis for the AR/EU pair). This belongs to the "Counsel engagement" open thread and should gate Phase 3, as the doc already implies.

### L14 — Third-party processor claim is false-by-roadmap

- **Where**: `docs/RESEARCH_PROTOCOL.md:118` — "**no third-party processor touches identifiable data except Stripe (billing) and our email provider (transactional)**."
- **Problem**: Stated in the present tense when neither Stripe nor an email provider is integrated; more importantly, the roadmap then adds processors the sentence excludes: Sentry with "release tracking" (`PHASE_1:59`), Resend/Postmark (`PHASE_2:101`), **Firebase Crashlytics** (`PHASE_3:70` — Google as processor, with its own data-sharing posture), Stripe Connect KYC, push-notification services. The absolute claim will be falsified by the platform's own plan.
- **Action**: Convert to a maintained, dated processor list ("current processors: …; we update this list before adding any") — which is also what GDPR Art. 28/30 record-keeping will need anyway.

### L15 — Names of third parties imply associations that do not exist

- **Where**: `docs/MONETIZATION.md:151-156` (Mind & Life, Fetzer, John Templeton, Sloan, Ford, Mozilla, IDB as "candidate funders"); `docs/RESEARCH_PROTOCOL.md:85` (Apple Health, Google Fit, Oura, Muse, Whoop as "candidate integrations"); `docs/RESEARCH_PROTOCOL.md:184` (CONICET, Mind & Life as partner candidates).
- **Problem**: In an internal doc these are work lists; published, they read as an ecosystem the product participates in. None of these organizations has any stated relationship with the project. Foundations in particular are sensitive to being named in fundraising-adjacent material.
- **Action**: Low-cost: a one-line disclaimer where lists appear ("named organizations are candidates we may approach; no affiliation or endorsement is implied"), or move candidate lists out of the public corpus into the issue tracker (which `docs/README.md:71` already says is where open threads belong).

### L16 — Psychometric instruments named without licensing clearance

- **Where**: `docs/RESEARCH_PROTOCOL.md` §3.2–3.4 (POMS-SF, STAI-6, PANAS, WHO-5, FFMQ-SF), §8.3 ("Some validated scales (e.g. PSS, PANAS) are free; others may have fees or use restrictions. A scale-licensing audit is Phase 2 work").
- **Problem**: The doc partially self-flags, but understates it: **POMS-SF is a commercially licensed instrument (MHS)** and **STAI (including short forms) is licensed via Mind Garden with per-administration fees** — the two scales the protocol names as the likely pre/post pair (`PHASE_3:97-98`: "likely POMS-SF + STAI-6"). Administering them in-product without a license is a copyright problem inside the research surface, which is the platform's most scrutinized surface.
- **Action**: Do the licensing audit **before** instruments are named in any public doc; prefer genuinely free/open scales where equivalent (e.g., WHO-5 is free with attribution; I-PANAS-SF and PSS have permissive research-use terms). Re-mark §3 lists as "subject to licensing audit."

---

## MEDIUM

### L17 — "The beacon never goes dark" as an absolute public promise

- **Where**: `docs/VISION.md:45`, `BUSINESS_RULES.md:258`, `docs/SLO.md` §1, `README.md:83` ("the beacon never goes dark").
- **Problem**: The SLO doc itself targets 99.5% audibility — i.e., up to ~3.6 dark hours/month inside target. The covenant framing is good brand writing, and SLO §4 defines "dark" carefully; the risk is the absolute sentence traveling without its definition (press quotes, app-store copy) and ending up in a deceptive-practice or warranty argument.
- **Action**: Keep the covenant; ensure Terms of Service expressly disclaim availability warranties and define outage remedies; in marketing surfaces, pair the sentence with the audibility metric ("our target and track record: status page").

### L18 — Minor consistency and drafting items for the legal pass

1. **S1 communication timing conflict**: `TRUST_AND_SAFETY.md:86` (table: "public/user comms within **6h**") vs `TRUST_AND_SAFETY.md:129` (playbook: acknowledgement email "within **24h**"). Pick one per artifact type.
2. **Garbled data-rights parenthetical**: `BUSINESS_RULES.md:279` — "(JSON for data; original audio not included for journal-attached recordings that don't exist yet)" — un-parseable in a rights statement; rewrite.
3. **Probation review tier referenced but undefined in lifecycle**: `CONTENT_POLICY.md:101` defines a "Providers on probation" review tier and `:153` a path into probation, but `BUSINESS_RULES.md` §3.3 offboarding categories never define probation as a state. Define it once.
4. **"Severe breach… public disclosure where legally permissible"** (`BUSINESS_RULES.md:148`): naming an offboarded provider publicly has defamation exposure; require counsel sign-off per instance, and say so.
5. **Recording ownership vs. research data ownership boundary**: `BUSINESS_RULES.md:108` (provider owns recordings) vs Listener participants' voices inside those recordings — the Content Agreement should address participant rights in recorded sessions, not only provider rights.
6. **Age gating is policy-only**: `PHASE_1:38` ("Age gate at signup: affirmation of 18+") does not exist in code, and `RESEARCH_PROTOCOL.md:43` relies on it for the minors exclusion. When re-tensing (L6), note the research-consent dependency explicitly.

---

## Closing note for counsel

The corpus's biggest structural virtue is also the audit's main lever: it already contains the honesty standard it needs (`VISION.md` promise 7: *"'We believe' and 'we hope to prove' are never replaced with 'we have proven' without evidence"*). Almost every BLOCKER and HIGH above is resolved by applying that standard reflexively — to the docs themselves, not only to product copy. The recommended global mechanic is in [README.md §Recommended release path](./README.md): re-tense, phase-tag, banner the draft status, and let the genuinely strong policy thinking stand on accurate ground.
