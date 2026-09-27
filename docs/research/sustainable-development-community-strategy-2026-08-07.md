# Harmonic Beacon Sustainable Development and Community Strategy Research

Status: Historical working research (2026-08-07); recommendations are not ratified product policy. Preserved on 2026-09-27 from a local draft. Repository state, fees, laws, platform rules and the proposed schedule below describe that research date and were not revalidated during preservation.

Research date: 2026-08-07

Scope: Product Zero, Founding Listener membership, continuous crowdfunding, citizen science, community governance, distribution, X, and the path toward ecosystem sustainability

Primary repositories reviewed:

- `harmonic-beacon-webapp`
- `harmonic-beacon-webapp-early-birds`

## Purpose

This document preserves the research and strategic synthesis developed around the launch of Product Zero at `listen.harmonicbeacon.com`.

Product Zero allows a visitor to listen to the Harmonic Beacon directly or enter through an English or Spanish introduction. The proposed next step is a USD 2/month founding membership that combines continuous patronage, public product development, and citizen science.

This note records:

- the actual product and documentation state found in the repositories;
- payment economics and comparable open cultural/technical projects;
- the recommended relationship between open listening and paid support;
- non-extractive citizen-science principles and experimental sequencing;
- community governance and consent requirements;
- distribution and narrative strategy, especially for X;
- metrics, launch loops, and a provisional 90-day sequence;
- unresolved decisions that require steward confirmation.

It is a research artifact, not an approved specification. Product, governance, legal, and scientific claims must be ratified separately before implementation.

## Executive thesis

Harmonic Beacon should not primarily sell access to an audio stream. It should keep the core listening experience open and invite people to sustain and help shape a living instrument.

A concise formulation is:

> Listen freely. Help build what comes next.

The proposed USD 2/month membership is strongest as an accessible act of belonging and patronage. It is not economically sufficient as the only revenue layer and should coexist with annual billing, voluntary higher contributions, one-time support, institutional sponsors, grants, experiences, research partnerships, and later ecosystem products.

The product, community, and research relationships must remain independent:

1. A person may experience Product Zero anonymously.
2. A person may join or support the community without contributing personal data.
3. A person may opt into a specific experiment without granting blanket permission for future research.

The system-level flywheel is:

```text
Listen
  -> experience a difference
  -> encounter a question and story
  -> support or participate
  -> contribute to a bounded experiment
  -> receive results and see what changed
  -> encounter a better instrument
  -> listen again
```

Revenue, community, science, and product development should be expressions of this same reciprocal loop rather than separate departments.

## 1. Repository state and strategic contradiction

The repository material already defines substantially more than a blank minimum product:

- continuous listening;
- direct Beacon or introduction-plus-Beacon entry;
- English and Spanish listener copy;
- isolated Early Birds experience;
- a provider-neutral membership architecture;
- PayPal and Mercado Pago lanes;
- an operator-controlled anonymous public-listening mode;
- privacy and efficacy-claim constraints;
- a roadmap toward responsive and participatory experiences.

Three formulations currently coexist:

1. The original Early Birds plan describes paid private membership as the route to listening.
2. `docs/VISION.md` states that the central listening experience should remain free.
3. The current strategy proposes publishing Product Zero openly and then inviting listeners to support development for USD 2/month.

The Early Birds implementation already supports reversible anonymous listening through `EARLY_BIRDS_FREE_FOR_ALL`, but the code and operations documentation frame it as a short operator-controlled public window rather than permanent product policy.

### Recommended resolution

Keep Product Zero open, including direct listening and the English/Spanish introductions. Position membership as support, proximity to the process, bounded participation, and recognition—not as a paywall over the core experience.

This recommendation is not yet an approved decision. It must be reconciled explicitly with the existing Early Birds access model before campaign copy or entitlement rules are changed.

## 2. The proposed offer

### Founding Listener

Provisional language:

> Harmonic Beacon is open to everyone. For USD 2/month or USD 24/year, a Founding Listener helps keep the signal open and participates in the process of discovering what the instrument becomes.

Appropriate benefits have low marginal operating cost:

- Founding Listener identity, number, or start date;
- optional public recognition or anonymity;
- a readable monthly or quarterly field report;
- transparent development and funding updates;
- invitations to bounded experiments and listening sessions;
- consultative participation in selected roadmap questions;
- early access to prototypes when operationally appropriate;
- a clear record of what participant input changed and what it did not change.

Benefits to avoid at this price:

- exclusive access to the core Beacon audio;
- an obligation to produce exclusive content on a fixed cadence;
- individual support;
- physical merchandise;
- improvised binding votes;
- promises of scientific influence or personal results;
- permanent operational or governance rights;
- a community platform that requires constant moderation before a real community exists.

### Founding-price language

If the price is described as immutable, the promise should be narrow:

- USD 2 nominal base price;
- reserved while the membership remains continuously active;
- non-transferable;
- taxes external to the base price may change;
- payment providers, benefits, tools, and participation formats may evolve;
- the founding price does not grant permanent control over the project.

### Higher support without unequal power

From launch, provide at least one low-friction way to contribute more:

- custom monthly amount;
- one-time contribution;
- one or two named support levels if required by the checkout UX;
- later, a distinct institutional-sponsor program.

Higher support should not purchase a superior listening signal or more political weight. A useful explicit statement is:

> Higher levels do not buy a better version of the Beacon; they sustain the same open signal with greater intensity.

## 3. Economics of USD 2

The price is strategically defensible as an inclusive symbolic threshold, but fixed processing fees are material.

The following fee observations were current on the research date and must be rechecked before launch:

- PayPal Argentina commercial transactions: approximately 5.4% plus USD 0.30 for a domestic USD transaction. On USD 2, the estimated net is USD 1.592 before taxes, conversion, withdrawal costs, refunds, and disputes.
- PayPal micropayments: approximately 6.5% plus USD 0.05, subject to approval and account-level conditions. On USD 2, the estimated net is USD 1.82.
- Mercado Pago in Córdoba published approximately 6.53% for immediate availability and 1.55% for availability after 35 days, before VAT on the fee and applicable withholding. Including 21% VAT on the fee produces rough effective costs of 7.90% and 1.88%, before other taxes or retention.
- New Patreon pages use a platform fee plus standard payment processing; its fixed processing component makes a new USD 2 tier particularly inefficient.
- Annual billing substantially reduces fixed-fee incidence and involuntary churn.

### Indicative membership revenue

At USD 2/month, approximate monthly net before tax, currency-conversion, withdrawal, refund, and operational costs is:

| Active members | PayPal standard | PayPal micropayments | Mercado Pago immediate plus VAT on fee | Mercado Pago 35 days plus VAT on fee |
|---:|---:|---:|---:|---:|
| 100 | USD 159.20 | USD 182.00 | USD 184.20 | USD 196.25 |
| 500 | USD 796.00 | USD 910.00 | USD 921.00 | USD 981.25 |
| 1,000 | USD 1,592.00 | USD 1,820.00 | USD 1,842.00 | USD 1,962.50 |
| 2,500 | USD 3,980.00 | USD 4,550.00 | USD 4,605.00 | USD 4,906.25 |
| 5,000 | USD 7,960.00 | USD 9,100.00 | USD 9,210.00 | USD 9,812.50 |

These values are scenario estimates, not forecasts.

### Annual billing

The public story can remain “USD 2/month” while offering USD 24/year prominently. A single annual charge:

- materially reduces fixed processing fees;
- reduces twelve opportunities for payment failure to one;
- improves operational simplicity;
- preserves the inclusive monthly anchor without discounting the founding contribution.

### Revenue architecture beyond membership

Membership should validate relationship, recurrence, and legitimacy, but should not carry the whole ecosystem alone. Complementary layers include:

- voluntary larger and one-time contributions;
- institutional sponsorship;
- grants for open research and culture;
- university and laboratory partnerships;
- retreat-center or installation pilots;
- Harmonic Myth Projection sessions and facilitated experiences;
- custom integrations and instruments;
- future protocol, hardware, Constellation, developer tooling, and Harmonically Aware Technology ecosystem services.

### Transparency

A quarterly minimum report should distinguish:

- active members;
- gross and net recurring revenue;
- payment, platform, currency, and withdrawal fees;
- one-time contributions;
- spending by category;
- committed monthly costs;
- available runway;
- concentration in the five largest supporters;
- work capacity financed;
- changes in accounting criteria.

Do not display gross monthly recurring revenue as if it were available operating capacity.

## 4. Comparable models

### Godot Development Fund

Godot remains free and open. Its fund combines individual recurring levels, institutional sponsors, and one-time contributions. Recognition is the main individual benefit. The foundation publishes how its donation indicators are calculated and distinguishes limitations in gross counters.

Strategic lesson: recurring individual support works best alongside higher contributions, institutional sponsors, transparency, and eventually owned payment infrastructure.

### Blender Development Fund

Blender remains free and open-source. Individual support begins above Beacon's proposed entry price and primarily offers recognition. Corporate levels offer greater strategic interaction. The foundation publishes funded work and financial reporting.

Strategic lesson: separate universal product access, recognition for sustainers, and high-scale institutional relationships.

### Krita Development Fund

Krita remains freely available and offers multiple contribution levels with largely similar symbolic benefits. Corporate membership is separate.

Strategic lesson: several amounts do not require several different products. Recognition may scale without creating an expensive reward factory.

### OpenStreetMap Foundation

OpenStreetMap data remains open. Its low-cost individual membership is billed annually and coexists with active-contributor membership, corporate membership, formal voting, and public finances.

Strategic lesson: very low membership can work when it represents institutional belonging, is collected annually, and has precisely defined governance. Beacon must not borrow voting language unless the power is real and formal.

### The Guardian

Much of the central journalistic good remains open. Support is framed as keeping independent journalism accessible. Impact updates make patronage concrete.

Strategic lesson: the most valuable benefit can be causal and moral—“this remains open because I help sustain it”—rather than access to a private content inventory.

## 5. Risks in the membership model

- USD 2 may anchor perceived value too low.
- Fixed payment fees may consume a large percentage.
- “Immutable” may become an unsustainable promise.
- “Help build” may create entitlement or imply authority that does not exist.
- Higher supporters or sponsors may create concentration pressure.
- Community operations may cost more than streaming infrastructure.
- Membership, donation, and purchase have different legal and tax meanings.
- Platform rules and country availability may change.
- Listening for free without paying is not necessarily a failure in an open-good model.
- Asking for opinions without returning decisions or results damages trust.

## 6. Three independent relationships

### A. Experience

- Use Product Zero without an account.
- Receive the same core experience after rejecting all research.
- No sensor activation as a condition of listening.
- No silent identifiable telemetry or personal listening history.

### B. Community

- Participate in conversations, workshops, agenda setting, protocol design, and result interpretation.
- Permit different roles: listener, critic, designer, experimental participant, analyst, curator, or representative.
- Do not require voice, movement, camera, or subjective-state data to have community standing.

### C. Experiments

- Separate opt-in for each protocol.
- No advance blanket consent for any future research.
- Each materially different reuse returns to governance and, where required, re-consent.
- Leaving an experiment must not require leaving the community.

## 7. Citizen-science participation lifecycle

A non-extractive lifecycle is:

1. Encounter: try Beacon anonymously.
2. Orientation: distinguish experience, hypothesis, and research.
3. Community entry: choose interests and role without donating data.
4. Agenda: propose questions, risks, and desired outcomes.
5. Design: review protocol, burden, and consent language.
6. Invitation: receive a specific, short experimental consent.
7. Participation: pause, skip, and withdraw without penalty.
8. Interpretation: receive preliminary results and contest interpretations.
9. Publication: publish results, limitations, contributions, and dataset documentation.
10. Reuse: evaluate new purpose, risk, and compatibility.
11. Exit: export or withdraw what can still be withdrawn.
12. Closure: publish an archive, destruction, or custodial-transfer plan.

The central participation promise must state how much power people have. Consultation, collaboration, co-design, and governance are different claims.

## 8. Consent per experiment

Each experiment needs a concise, expandable experiment sheet covering:

- research question;
- known evidence versus hypothesis;
- procedure, duration, frequency, and burden;
- exact streams captured;
- potential capture of third parties or surroundings;
- local, first-party server, or external processing;
- raw signals, derived features, labels, notes, and logs retained;
- permitted purpose;
- prohibited inferences;
- access levels;
- retention periods;
- sharing and recipients;
- AI training or evaluation use, if any;
- withdrawal consequences;
- result-return promise;
- attribution choices;
- human contact and responsible entity.

Independent opt-ins are required for:

- joining the experiment;
- retaining raw signals;
- linking sessions longitudinally;
- external sharing;
- reuse in another experiment;
- publication of voice or image fragments;
- model training;
- recontact;
- nominal attribution.

Store a consent receipt with protocol version, choices, date, and later changes.

New sensors, purposes, retention periods, identifiers, linked datasets, external parties, open publication, model training, or health/emotion/identity inferences should trigger review and potentially re-consent.

Consent alone cannot legitimize a disproportionate practice. Some uses should remain prohibited even if a checkbox could be offered.

## 9. Governance and reciprocity

### Participant assembly

Potential responsibilities:

- propose questions;
- discuss priorities and findings;
- review general principles;
- elect participant representatives.

### Data and Experiments Council

Before sensitive modalities, establish a council including:

- participant representatives, preferably with parity or majority;
- the Beacon research and engineering team;
- an independent ethics or data-protection specialist;
- representation from potentially affected communities;
- modality-specific expertise when voice, camera, biometrics, or mental health appear.

Responsibilities may include protocol approval, risk classification, reuse requests, access levels, incidents, pauses, attribution, and closure.

### Operational custody

A legally and technically identifiable steward must remain responsible for security, inventory, processor contracts, rights requests, incidents, retention, and deletion. Shared governance must not dissolve accountability into an informal collective.

### Recommended community veto areas

- environmental camera or microphone activation;
- identity or biometric analysis;
- automatic emotion inference;
- clinical or quasi-clinical uses;
- publicly downloadable sensitive datasets;
- training general-purpose models;
- third-party access;
- retroactive license changes;
- linking data to location, health, or real identity.

### Reciprocity contract

Every experiment should promise:

- what personal descriptive feedback can be returned without overinterpretation;
- when aggregate results will appear;
- how uncertainty and null results will be explained;
- what tools or capabilities remain with the community;
- how participants join interpretation;
- what happened to rejected suggestions;
- where protocols and decisions are published;
- how time and direct participation costs are recognized.

Appropriate returns include personal descriptive visualizations, collective interpretation sessions, learning resources, early result access, correction rights, and co-authorship or contributorship when warranted.

Do not return unsupported scores such as “your coherence level” or “your true emotion.”

## 10. Attribution and dataset provenance

Offer attribution by:

- real name;
- persistent pseudonym;
- collective attribution;
- anonymity.

Maintain a contribution ledger separate from sensitive data. CRediT roles can represent conceptualization, methodology, investigation, curation, validation, analysis, visualization, writing, and governance.

The number of samples should not alone determine authorship. Substantial intellectual contributions should receive agreed co-authorship or collective authorship; smaller contributions should receive explicit contributorship or acknowledgment.

Each observation should preserve enough provenance to understand:

- experiment and protocol version;
- consent version and allowed scope;
- date and timezone;
- modality and device;
- software and firmware versions;
- sampling configuration and calibration;
- declared context and condition;
- instructions;
- interruptions;
- transformations and code version;
- labeling process;
- quality flags;
- withdrawal or restriction status.

FAIR does not require sensitive raw data to be open. A safer model is discoverable metadata with controlled data access.

## 11. Experimental sequence

### Experiment 0: co-create the vocabulary

Question:

> How do people describe their experience without imposing “zone,” “coherence,” or clinical categories?

Use voluntary workshops or interviews, no sensors, and participant review of notes before retention.

Outputs:

- participant language;
- perceived risks;
- meaningful experiential outcomes;
- candidate research questions;
- more authentic public copy.

### Experiment 1: anonymous post-session pulse

Optionally ask:

- whether the introduction helped;
- a brief absorption or presence response;
- comfort or valence;
- an optional free-text observation.

Safeguards:

- no account requirement;
- no IP retained in the research dataset;
- no location;
- no fine demographics;
- no longitudinal linkage;
- reviewable free text before submission.

Purpose: feasibility and language, not clinical efficacy.

### Experiment 2: within-person Product Zero comparison

Compare short sessions in randomized order:

- Beacon only;
- introduction plus Beacon;
- a defined comparison condition if justified.

Use a brief self-report, a revocable random code, preregistered hypotheses and analysis, and no voice, camera, or movement.

### Experiment 3: participatory feedback design

Use synthetic or fictional data to test which feedback representations feel useful, manipulative, confusing, or pathologizing. No personal signal capture is necessary.

### Experiment 4: bounded local movement processing

Only after the previous work:

- use deliberate gestures, not ambient monitoring;
- process on device;
- transmit only necessary statistics;
- discard raw movement immediately;
- collect no location;
- prohibit gait recognition;
- red-team reidentification risk.

### Voice and camera

Do not place voice or camera in the first research phase. Before use, require:

- working governance;
- privacy-impact assessment;
- independent ethical review;
- threat model;
- third-party capture protocol;
- demonstrated deletion capability;
- evidence that a less invasive modality cannot answer the question.

## 12. Modality limits

### Voice

Risks include identity, linguistic content, health inference, geographic origin, affect, environmental sounds, and third parties.

Default limits:

- no continuous capture;
- local processing where possible;
- separate transcript from acoustic signal;
- prohibit speaker recognition;
- minimize raw-signal retention.

### Camera

Risks include faces, homes, documents, minors, and non-consenting third parties.

Default limits:

- no environmental camera in early pilots;
- deliberate framing;
- local preview;
- local blur where relevant;
- no facial recognition.

### Movement

Risks include gait-based identity, health inference, routine, location, and longitudinal profiling.

Default limits:

- bounded gestures;
- no GPS;
- no continuous tracking;
- local feature extraction;
- reidentification assessment.

### Subjective states

Risks include distress, medicalization, stigma, intimacy, and measurement reactivity.

Default limits:

- skippable questions;
- low sampling burden;
- non-diagnostic language;
- do not ask about crisis or suicide without an appropriate support protocol.

### Initial red lines

- always-on microphone or camera;
- making participants solely responsible for third-party capture;
- inferring emotion as objective fact;
- diagnosing mental health;
- scoring coherence, authenticity, or personal worth;
- employment, education, insurance, credit, or surveillance use;
- face, voice, or gait recognition;
- involving minors in the initial phase;
- publishing raw voice, face, or movement data;
- indefinite retention “in case it becomes useful”;
- requiring research participation for Beacon access;
- changing data purpose through general terms updates.

## 13. Legal and claims boundary

This research is not legal advice. Implementation requires professional review based on jurisdiction, population, claims, and protocol.

In Argentina, Law 25.326 requires, among other things, adequate and non-excessive data, specified purposes, informed consent where applicable, security, confidentiality, rights of access/rectification/deletion, and controls over sharing and international transfer.

Argentina's adoption of Convention 108+ adds safeguards relevant to health and uniquely identifying biometric data. Resolution 1480/2011 provides guidance for human health research. If “in the zone” remains an experiential description, the risk profile is lower. If Beacon claims diagnosis, treatment, emotional regulation, therapeutic effectiveness, or mental-health outcomes, it moves toward human-health research and potentially additional product regulation.

For EU residents, GDPR may apply. Voice, face, and movement become special-category biometric data when used for unique identification; they may remain personal data even without that purpose. Sensitive or systematic profiling may require a data-protection impact assessment. Consent does not automatically remove AI Act restrictions on emotion-recognition or biometric uses.

## 14. Narrative architecture

Sequence the story as:

1. A concrete experience available now.
2. A perceptual question that invites conversation.
3. The material process and decisions behind the experience.
4. Harmonically Aware Technology as an evolving design hypothesis.
5. The roadmap as a natural expansion of what people have already experienced.

Principles:

- “Listen” before “understand our theory.”
- Present Harmonically Aware Technology as a developing hypothesis, not an established category.
- Turn roadmap items into questions rather than a premature feature inventory.
- Use membership as a periodic invitation, not the subject of every message.
- Prefer approximately 80% experience/process/knowledge and 20% direct invitation.
- Avoid efficacy claims that outrun evidence.

Possible milestone questions:

- Product Zero: What happens when a continuous harmonic signal is available to anyone at any time?
- Sensing: How should the Beacon respond to the body without distracting from the body?
- Reflecting: How can voice or movement shape a field that returns a previously unavailable expression?
- Connecting: Can people share a field without creating another social feed?
- Learning: Which differences are repeatable, which are personal, and how can they be investigated together?
- Harmonically Aware Technology: What conditions should a technology satisfy to relate harmonically to its users and environment?

## 15. Distribution architecture

### Nicolás/founder account: initial 60–70% of editorial energy

Role:

- trust;
- first-person history;
- uncertainty and decisions;
- questions;
- demonstrations;
- links between HIT and concrete experience.

Editorial promise:

> I am investigating and building this.

### Harmonic Beacon account: initial 25–35%

Role:

- canonical product memory;
- demo and pinned entry point;
- changelog;
- roadmap;
- experiments and results;
- documentation;
- signal status.

Editorial promise:

> This exists; this is how it sounds and how it evolves.

### Transparent agent account: initial 0–10%

Activate only when it has a repeatable, distinct editorial function, such as traceable synthesis, process observations, or system records.

Editorial promise:

> I am an automated system, publicly administered by Nicolás, documenting this process and its limits.

### Current X constraints

The official policies reviewed on the research date state that:

- multiple accounts may be used for distinct, non-duplicative purposes;
- coordinated artificial amplification and substantially identical posting are prohibited;
- automated accounts should be labeled and connected to a public human administrator;
- website scripting can lead to suspension; automation should use the official API;
- automated likes, indiscriminate following, unsolicited DMs, and keyword-only automated replies are prohibited or restricted;
- operating an AI-powered automated reply bot requires prior written and explicit approval from X;
- AI-assisted drafting followed by human review/publication is distinct from autonomous operation.

Therefore a CompAII account is viable as a transparent narrative layer, not as a mechanism to multiply reach. It should not autonomously reply until the applicable approval exists.

## 16. Owned audience and community surfaces

Use X for discovery and conversation, not as the canonical community database.

From launch, create an exportable mailing list under a Harmonic Beacon domain. A stronger CTA is:

> Receive the next listening and field note.

A short welcome sequence can cover:

1. what Beacon is and is not;
2. Product Zero listening;
3. one response question;
4. the next chapter;
5. optional support.

Do not open an empty Discord or equivalent high-moderation surface. Sequence community infrastructure as:

1. email and personal replies;
2. small periodic listening session or Space;
3. private group only after a recurrent nucleus can converse without all activity being produced by the core team.

## 17. Editorial system and cadence

Create one weekly source artifact and derive platform-native pieces rather than duplicating identical posts across accounts.

Useful formats:

- a 15-second listening fragment plus one perceptual question;
- a field note: “We tried X, expected Y, and observed Z”;
- audible or visual before/after;
- an open decision requesting reasons, not only votes;
- a translation from one HIT idea to one concrete product experience;
- a weekly or biweekly Beacon Log;
- a 30–45 minute Space with one narrow question and a short demo.

Indicative sustainable cadence:

- founder: approximately 5–7 original posts/week, including one demonstration;
- brand: approximately 3–4 posts/week;
- agent: 1–3 posts/week after activation;
- one direct support invitation every 4–6 substantive publications.

Cadence is a capacity constraint, not a virtue. A substantive biweekly letter is better than a hollow weekly obligation.

## 18. Paid distribution

Do not use paid distribution to discover the story.

Stages:

1. No organic signal: no paid; use manual conversation and direct demos.
2. Organic winner: lightly amplify content that already produced qualified listening, replies, or signups.
3. Reliable landing and measurement: test adjacent audiences and conversion paths.
4. Validated launch loop: use paid as an accelerator.

Do not optimize for likes. Optimize for qualified visits, successful listening, return, email signup, substantive response, support, and experimental participation.

## 19. Outreach by stage

### Stage A: 0–20 real interlocutors

Contact young researchers, audio developers, experimental artists, educators, and open-tool builders. Ask for diagnosis, not promotion.

A useful framing is:

> I am building a minimal experience around listening and harmonically aware technology. I am not asking for promotion. May I send you a two-minute demo and ask one question about what feels solid or problematic?

Candidate seeds discovered during research, to be re-verified before contact:

- `@highskye`: immersive audio and open tools;
- `@rrr00bb`: instrument and music-software development;
- `@_stc`: algorithmic and open musical systems;
- `@AlexSantosMayo`: neuroscience curation;
- `@niroshajmurugan`: biophysics, cochlea, and auditory perception.

### Stage B: 20–100 participants or subscribers

- small Spaces;
- guest mini-essays;
- cross-newsletter recommendations;
- private demos;
- ask for a public question or critique rather than a prefabricated endorsement.

### Stage C: evidence and repeatable format

Approach music-tech newsletters, design and technology podcasts, neuroscience communicators, and creative-tool communities with a verifiable story rather than a generic description.

Additional candidates to re-verify:

- `@musicben_eth`: music-tech and generative-tool analysis;
- `@AgustinMIbanez`: Latin American neurocognition, when evidence supports a rigorous conversation;
- VideoLAN, Ardour, IEM/SPARTA, and open-audio communities when there is a technically relevant integration or learning.

### Stage D: larger amplification

Only after the project has:

- an immediate demo;
- a clear sentence;
- evidence of return or participation;
- usable testimonials;
- a real newsworthy milestone.

Then approach larger media, artists, institutions, foundations, and paid channels. Do not mass-message or automate unsolicited outreach.

## 20. Launch loops

### Weekly loop

```text
Observation -> demo -> conversation -> adjustment -> field note
```

Possible rhythm:

- Day 1: question or tension;
- Day 2: substantive participation in adjacent conversations;
- Day 3: demo;
- Day 4: what was learned or changed;
- Day 5: short letter and next test.

### Milestone loop

```text
Teaser -> access -> event -> feedback -> changelog -> evidence -> next chapter
```

Product Zero, sensors, camera, mixes, sessions, and the expressive feedback loop can each be a distinct chapter. The post-launch explanation is as important as launch day.

## 21. Metrics

Do not use follower count or time trapped in the application as the north star.

### Open-good health

- successful listening starts;
- introduction/direct-listening choice;
- successful introduction-to-Beacon handoff;
- playback failures;
- privacy-preserving aggregate return at 7 and 30 days.

### Community health

- substantive replies;
- mailing-list responses;
- repeat participation;
- experiment completion and withdrawal rates;
- participant questions entering the agenda;
- percentage of experiments with publicly returned results;
- participant input that changed the product or received an explicit explanation.

### Sustainability

- active Founding Listeners;
- gross versus net recurring revenue;
- monthly versus annual mix;
- payment failures;
- 30/90-day retention;
- higher-support mix;
- one-time contributions;
- revenue concentration;
- hours required to deliver member benefits;
- infrastructure and work capacity covered.

### Distribution funnel

- qualified reach;
- substantive replies, bookmarks, and quoted commentary;
- unique tracked visits;
- listening starts;
- email conversion;
- return;
- support conversion;
- repeat participation;
- referrals and unsolicited invitations.

Use UTM dimensions by account, format, chapter, and piece. Track outreach separately as sent -> response -> demo -> collaboration -> referral.

## 22. Provisional 90-day sequence

### Days 1–15: prepare the field

- ratify open-listening policy;
- finalize Product Zero entry and public copy;
- create an owned mailing list;
- define aggregate, privacy-preserving metrics;
- publish a readable roadmap;
- define Founding Listener terms precisely;
- run 15–20 private listening conversations;
- build a small library of clips, images, and field notes.

### Days 16–30: The Signal Is Open

- publish Product Zero;
- lead with experience before theory;
- use no paid distribution;
- run Experiment 0, co-creating vocabulary;
- publish the first Beacon Log;
- collect failures and language under explicit boundaries.

### Days 31–45: Build the Beacon

- open USD 2/month and USD 24/year support;
- allow larger and one-time amounts;
- publish concrete funding thresholds;
- distinguish gross, net, and fees;
- explain consultative participation versus decision authority.

### Days 46–60: We Heard This

- publish what was heard and what changed;
- hold a small Space or listening circle;
- run the anonymous post-session pulse;
- publish the first compact financial report;
- repeat the two strongest organic formats.

### Days 61–90: first roadmap chapter

- release one demonstrable milestone;
- run the milestone loop from teaser through changelog;
- begin participatory design of the feedback loop using synthetic data;
- approach aligned newsletters, artists, and specialists;
- consider a small paid test only for validated organic material;
- announce the next bounded experiment.

## 23. Decisions still required

1. Is core Product Zero listening permanently open, or only open during operator-controlled windows?
2. What exact influence does Founding Listener membership confer?
3. Which decisions remain solely with project stewards?
4. Which decisions are consultative, co-designed, binding, or subject to community veto?
5. What monthly net amount marks infrastructure coverage, stable development, and broader ecosystem sustainability?
6. Which legal entity receives each type of payment, and how are membership, purchase, sponsorship, and donation classified?
7. Which payment path will be primary for international and Argentine supporters?
8. What is the first explicit funding threshold shown publicly?
9. Which aggregate analytics are compatible with the no-personal-listening-history promise?
10. What independent ethical and legal review will precede sensor, voice, camera, or health-adjacent research?
11. When does Founding Listener enrollment close, if ever?
12. What distinct, non-duplicative editorial function would justify a CompAII X account?

## 24. Recommended immediate policy statement

Subject to steward approval:

> Harmonic Beacon is an open signal and an evolving instrument. Anyone can listen. The community may sustain it, help formulate questions, and voluntarily participate in bounded experiments whose results and decisions return to the community. USD 2 does not buy a better Beacon; it helps the Beacon remain open, evolve, and learn responsibly.

## Primary references

### Payment and comparable models

- PayPal Argentina business fees: https://www.paypal.com/ar/business/paypal-business-fees
- Mercado Pago Argentina fees: https://www.mercadopago.com.ar/ayuda/19495
- Patreon creator fee overview: https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview
- Patreon annual memberships: https://support.patreon.com/hc/en-us/articles/360041721372-Annual-memberships-creator-overview
- Godot Development Fund: https://fund.godotengine.org/
- Godot donation methodology: https://godot.foundation/2025/01/07/how-we-calculate-donations/
- Blender Development Fund: https://fund.blender.org/about/
- Blender Foundation: https://www.blender.org/about/foundation/
- Krita Fund: https://fund.krita.org/
- OpenStreetMap Foundation support: https://supporting.openstreetmap.org/
- OpenStreetMap Foundation finances: https://osmfoundation.org/wiki/Finances
- The Guardian support: https://support.theguardian.com/contribute
- Open Collective budgets: https://docs.opencollective.com/help/collectives/budget
- Open Collective pricing: https://opencollective.com/pricing

### Citizen science, ethics, and data

- Eleta et al., citizen-science participation promises: https://theoryandpractice.citizenscienceassociation.org/articles/10.5334/cstp.171
- Cooper et al., anti-extractive citizen science and shared control: https://onlinelibrary.wiley.com/doi/full/10.1029/2022CSJ000025
- European Citizen Science Association principles: https://www.ecsa.ngo/10-principles/
- Carroll et al., CARE Principles: https://datascience.codata.org/articles/10.5334/dsj-2020-043
- Lee et al., dynamic consent: https://pmc.ncbi.nlm.nih.gov/articles/PMC11365279/
- Pierce and Evram, roles in citizen science: https://insights.uksg.org/articles/10.1629/uksg.538
- Kröger, Lutz, and Raschke, voice privacy: https://link.springer.com/chapter/10.1007/978-3-030-42504-3_16
- Barrett et al., limitations of emotion inference from facial movements: https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856/
- Meyer et al., wearable-camera ethics: https://pmc.ncbi.nlm.nih.gov/articles/PMC9307222/
- Doherty et al., wearable-data privacy: https://pmc.ncbi.nlm.nih.gov/articles/PMC12167361/
- Myin-Germeys et al., Experience Sampling Method: https://pmc.ncbi.nlm.nih.gov/articles/PMC5980621/
- NISO CRediT: https://credit.niso.org/
- Gebru et al., Datasheets for Datasets: https://cacm.acm.org/research/datasheets-for-datasets/
- Argentina Law 25.326: https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/texto
- Argentina Law 27.699, Convention 108+: https://www.argentina.gob.ar/normativa/nacional/ley-27699-375738/texto
- Argentina Resolution 1480/2011: https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-1480-2011-187206/actualizacion
- European Commission AI regulatory framework: https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai

### Distribution and platforms

- X authenticity policy: https://help.x.com/en/rules-and-policies/authenticity
- X automated account labels: https://help.x.com/en/using-x/automated-account-labels
- X automation rules: https://help.x.com/en/rules-and-policies/x-automation
- X organic best practices: https://business.x.com/en/basics/organic-best-practices
- X Ads Campaigns 101: https://business.x.com/en/help/campaign-setup/campaigns-101
- X conversion tracking: https://business.x.com/en/help/campaign-measurement-and-analytics/conversion-tracking-for-websites
- X creative best practices: https://business.x.com/en/advertising/creative-best-practices
- X Spaces: https://help.x.com/en/using-x/spaces
- Product Hunt launch guide: https://www.producthunt.com/launch
- Product Hunt launch preparation: https://www.producthunt.com/launch/preparing-for-launch
- Product Hunt Notion case: https://www.producthunt.com/stories/how-notion-fostered-an-avid-community-on-product-hunt
- Product Hunt Loom case: https://www.producthunt.com/stories/how-loom-grew-its-user-base-after-its-product-hunt-launch

## Provenance note

This synthesis combines direct repository inspection, official platform and payment documentation, primary project/foundation material, peer-reviewed citizen-science and privacy literature, Argentine legal sources, and three parallel research investigations completed on 2026-08-07. Fast-moving platform policies, pricing, candidate social accounts, and legal applicability must be re-verified at the point of implementation.
