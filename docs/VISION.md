# Vision

> **Status: Draft — pending validation.** Nothing here is ratified. This document
> is the frame rather than a description of the running system, and the
> trajectories under [Long horizon](#long-horizon) are directional by design.
> Where a sentence below asserts a *state* of the product rather than an
> intention, it is a claim about code that exists today; where such a claim is
> not yet true it is written in the future tense and tagged `[Planned — Phase N]`,
> per the convention in
> [README.md](./README.md#describing-what-is-not-built-yet).
>
> Promise 7 is the standard that convention applies. It is applied here to this
> document as strictly as to any page of marketing copy.

*Draft · 2026-04-12 · author: product design, pending validation*

## What Harmonic Beacon is

Harmonic Beacon is a **24/7 continuous broadcast of natural harmonics**, paired with curated audio overlays, delivered through a client that lets each listener mix the live beacon against voice and instrument layers. That client is a web application today; the mobile app is a later phase and no mobile code exists yet. **[Planned — Phase 3]** The public frame is not wellness — it is *Harmonic Information Theory*: a proposition that reality encodes itself in ratios, that systems of all scales resonate, and that a carefully constructed acoustic reference can help a human being remember a state of **spiritual homeostasis** — a natural enharmony with the whole.

The product is a research instrument as much as it is a listening experience. Every listener will be able, if they choose, to participate in a longitudinal protocol that pairs their time on the beacon with validated psychological surveys and optional biological markers, contributing to a decentralized scientific effort that tries to make harmonic awareness measurable. That protocol is not open: no survey is administered to anyone today, and enrollment waits on ethics review, a named investigator, and a documented lawful basis for handling what mood and anxiety instruments produce. See [RESEARCH_PROTOCOL.md](./RESEARCH_PROTOCOL.md). **[Planned — Phase 3]**

## What Harmonic Beacon is not

- It is **not a meditation app** in the Calm/Headspace sense. It does not compete on content library size or celebrity narrators.
- It is **not a therapeutic device**. It makes no clinical claims. The research protocol is exploratory, not diagnostic.
- It is **not a social network**. There is no feed, no follower graph, no public comment surface. Connection is felt through shared listening, not performed through posting.
- It is **not a free-forever hobby**. It is a sustained effort that must eventually pay for its infrastructure, its providers, and its research.
- It is **not a paywall**. Whatever monetization we implement must fit the brand of a patronage-supported, research-oriented, mission-led instrument.

## Who it is for

Three concentric audiences. Each is a real person, not a persona.

1. **The seeker**  — lives with the pulse of modern life, has tried meditation apps and bounced off their packaging, is drawn to ideas about resonance, energy, coherence, presence. Reads the Theory section and stays. Listens. Eventually supports.
2. **The provider** — teachers, musicians, healers, researchers with something to contribute. Willing to be vetted. Willing to be patient with a small audience in exchange for alignment with the frame.
3. **The researcher / institution** — clinics, retreat centers, universities, foundations. Interested in the protocol, interested in the data, potentially interested in licensing the instrument for their own studies or for their own populations.

A fourth audience, implicit in the Analysis pillar, is **the technologist** — the person who might one day care about *Harmonically Aware Technology* as a design concept or certification mark. They are latent. We build for them by writing precisely.

## Voice and aesthetics

The public copy is deliberate. It uses words like *interference*, *resonance*, *ratios*, *pareidolia*, *interference pattern*, *spiritual homeostasis*. It does not apologize for being philosophical. It does not hedge with "for some users" disclaimers on every sentence. It is also careful: it never promises healing, never diagnoses, never addresses a specific ailment by name.

The visual register is spacious, violet-cast, typographic, quiet. Time moves slowly inside the product. The beacon is not a dashboard.

When we write in the voice of the brand we aim for three qualities:

- **Precise, not vague.** Every sentence carries a specific idea. "Helping you relax" is vague; "making the interference pattern of the subtle audible in the material realm" is precise.
- **Confident, not salesy.** The product trusts the reader to be curious. It does not flatter, scarce, urge, or manipulate.
- **Open, not cultic.** The theory is a proposition offered for inspection, not a creed. Skepticism is welcomed; experimentation is invited.

## The promises we make

Because the positioning is unusual, our promises must be explicit so we can be held to them and so internal decisions can be checked against them.

1. **The beacon never goes dark.** Whatever it takes — redundant upstream sources, a playlist fallback — the stream remains audible. Continuity is a brand promise, not a nice-to-have. The playlist fallback exists; the redundant upstream does not yet, so today the hierarchy has two levels rather than three. See [SLO.md](./SLO.md) and the Covenant of Continuity, which set out what "dark" means and what the uptime target actually allows. **[Planned — Phase 1]**
2. **We do not sell access to presence.** Core listening (live beacon + a rotating set of overlays) stays free forever. Patronage supports the instrument; it does not gate the experience.
3. **We make no therapeutic claims.** The Analysis pillar frames research as exploration, never as treatment. Copy will be audited against this before publication; there is no audit step in the publishing path yet, and the 2026-06-09 review found a claim of this exact kind inside our own principles document. See [PRODUCT_PRINCIPLES.md §10](./PRODUCT_PRINCIPLES.md). **[Planned — unscheduled]**
4. **Participants own their data.** Research participation will be opt-in, consented per protocol, revocable at any time, and exportable in a structured format. De-identified aggregates may be published; identifiable data never leaves under any condition we choose alone. Ownership is only as real as the mechanics that deliver it, and two of those are still to be built: there is no export endpoint and no deletion endpoint yet. **[Planned — Phase 1]**
5. **Providers are vetted, not gate-kept.** The threshold is alignment with the frame, not credentials. Vetting is transparent. Appeals are possible.
6. **The instrument is observable.** The theory asks us to measure. Our own uptime, our own aggregate listener metrics, our own provider count — these will be public. None of the three is published today. There is no status page and no public metrics page; the listener and content counts exist only behind an admin-only endpoint, and uptime is not measured at all, only reported as a process counter by a liveness probe. A number that is not measured cannot be published, so this promise is owed the measurement work before it is owed a page. **[Planned — Phase 1]**
7. **We are honest about what we don't yet know.** "We believe" and "we hope to prove" are never replaced with "we have proven" without evidence we can point to.

Promise 7 is the one that governs the other six, and it governs this repository as well as the product. The 2026-06-09 audit found the corpus asserting controls, endpoints and guarantees in the present tense that do not exist in code — the documents had quietly done to themselves what promise 7 forbids doing to a reader. The convention in [README.md](./README.md#describing-what-is-not-built-yet) is that promise applied reflexively: change the tense, then tag, and let the tags be the checklist.

## Where the brand ends

The brand line between *on-mission* and *off-mission* determines what we will and won't build. A decision is on-mission if it strengthens the ability of a listener to remember enharmony with the whole, or strengthens the evidence that the instrument does what we hope. It is off-mission if it primarily optimizes for retention, conversion, ad targeting, social virality, or the aesthetics of a typical wellness SaaS product.

Examples of on-mission decisions:

- Publishing the research protocol in public.
- Building a synchronous "sitting" surface for shared listening at meaningful times.
- Investing in audio quality and low-latency delivery over any new tab.
- Letting a patron cancel with one click and no dark pattern.

Examples of off-mission decisions we will refuse:

- Adding social proof notifications ("3 people just started a session").
- Gating the live beacon behind paywalls or trials.
- Pushing notifications with emotional manipulation ("Your stress level is high — come back").
- Selling demographic data to third parties under any label.

## Long horizon

The product has three plausible long-horizon trajectories, which may coexist:

1. **The Beacon** — the operating instrument, ever-present, supporting listeners and providers, operated as a commons.
2. **The Constellation** — a federation of local beacons run by aligned communities and institutions, each a node in a larger resonance, each discoverable from the canonical app.
3. **The Seal** — *Harmonically Aware Technology* as a certification mark awarded to devices, instruments, or environments that meet defined criteria. A future business line, a long-term contribution to the ambient-technology field.

These trajectories are not a roadmap. They are a compass. The roadmap lives in [ROADMAP.md](./ROADMAP.md); it should always be readable as a sequence of steps toward one or more of these trajectories.
