# Harmonic Beacon — Web

The web portal for the Harmonic Beacon ecosystem. A 24/7 continuous broadcast of natural harmonics, paired with curated overlays, delivered through the web app at `beacon.altermundi.net`. Public marketing lives at `harmonicbeacon.com`.

Harmonic Beacon is a product of **AlterMundi**. It is framed publicly as an instrument for *Harmonic Information Theory* and pairs the listening experience with an opt-in research protocol.

## Where to start

New to this repo? Read these documents in order:

1. **[docs/VISION.md](./docs/VISION.md)** — what Harmonic Beacon is and is not.
2. **[docs/PRODUCT_PRINCIPLES.md](./docs/PRODUCT_PRINCIPLES.md)** — standing rules for decisions.
3. **[BUSINESS_RULES.md](./BUSINESS_RULES.md)** — canonical policy spine.
4. **[docs/ROADMAP.md](./docs/ROADMAP.md)** — long-term development project across four phases.

Index of all documentation: **[docs/README.md](./docs/README.md)**.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **PostgreSQL** via Prisma 7
- **Durable PostgreSQL sessions** for ticket-bound attendees and seeded staff roles
- **LiveKit** for the live beacon (WebRTC, room `beacon`, primary publisher `beacon01`)
- **HTTP range requests** for on-demand meditation playback (`src/lib/stream-file.ts`)
- **Docker Compose** for production deploy (see `deploy/`)
- **Vitest** for testing

## Getting started (development)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

The app needs a running Postgres and reachable LiveKit and tapestry services. Meditation audio is served by the app itself over HTTP with range requests, so it needs no extra service. See `deploy/` for the production-shaped setup.

## Scripts

```bash
npm run dev              # Next.js dev server
npm run build            # prisma generate + next build
npm start                # production server

npm run db:migrate       # prisma migrate dev
npm run db:push          # prisma db push (schema sync, no migration)
npm run db:seed          # seed database
npm run db:studio        # open Prisma Studio

npm test                 # vitest run
npm run test:watch       # vitest watch
npm run test:coverage    # coverage report
```

## Repository layout

```
.
├── src/                 # Next.js app
│   ├── app/             # Routes (pages + API routes)
│   ├── components/      # Shared UI
│   ├── context/         # React contexts
│   ├── lib/             # Utilities and clients
│   └── __tests__/       # Test suites
├── prisma/              # Schema, migrations, seed
├── services/
│   └── playlist-bot/    # Fallback audio service
├── deploy/              # Production deploy artifacts
├── docs/                # Vision, principles, roadmap, phase plans
│   └── phases/          # Phase-by-phase project plans
├── BUSINESS_RULES.md    # Canonical policy document
├── docker-compose.yml   # Production compose
└── Dockerfile           # App container
```

## Operational commitments

The product makes public commitments in its policy corpus. They are documented, and they will bind us as they are ratified and shipped — every doc linked below is currently marked "Draft · pending validation" (see [docs/README.md](./docs/README.md)):

- **[The Covenant of Continuity](./docs/SLO.md)**: the beacon never goes dark — a covenant of intent, not an uptime warranty; the published target permits measured, reported downtime ([BUSINESS_RULES.md §8.1](./BUSINESS_RULES.md)).
- **[Trust & Safety](./docs/TRUST_AND_SAFETY.md)**: reports will be acknowledged within 24 hours and S1 incidents will get a public postmortem. Neither exists yet — there is no report model and no incidents page. **[Planned — Phase 1]**
- **[Research ethics](./docs/RESEARCH_PROTOCOL.md)**: informed consent, revocable participation, preregistered protocols, de-identified public aggregates — the standard the research protocol will be held to once it starts enrolling. No research data is collected today. **[Planned — Phase 3]**
- **[Content policy](./docs/CONTENT_POLICY.md)**: no therapeutic claims is a standing rule enforced today through moderation review; appeals of a moderation decision are not yet available. **[Planned — Phase 2]**
- **[Monetization](./docs/MONETIZATION.md)**: patronage-not-paywall, core experience free forever. No payment processing or entitlement model exists yet, so every published meditation is free to everyone today by default rather than by an enforced floor. **[Planned — Phase 2]**

What's live today:

- **Health checks**: `/api/health` (liveness) and `/api/health/ready` (readiness — verifies the database, bounded by a timeout) are implemented and back the deploy's container healthchecks.
- **Log hygiene**: credentials in connection strings and signed-URL tokens are stripped from every log line before it's written (`src/lib/redact.ts`), and a test walks every `console.*` call in `src/` to catch PII-bearing fields (`src/lib/__tests__/no-pii-in-logs.test.ts`).

## Deploy

Production deploys run on a managed host with Postgres on the host and Next.js in Docker Compose. See `deploy/README.md` for the deployment runbook.

## License

The source code in this repository is licensed under the **Apache License 2.0**
([LICENSE](./LICENSE)). You may run it, modify it, and deploy it, including
commercially, subject to the license's attribution and notice requirements.
Contributions come in under the same license via §5, so there is no CLA — see
[CONTRIBUTING.md](./CONTRIBUTING.md), which asks for a DCO sign-off instead.

**This covers code only.** Provider audio, session recordings, and the beacon
stream are not covered and are governed by the Provider Content Agreement — see
[CONTENT_POLICY.md §7](./docs/CONTENT_POLICY.md).

**Trademarks are not licensed.** Apache-2.0 §6 grants no trademark rights, and
"Harmonic Beacon", "AlterMundi" and the Harmonically Aware Technology seal are
marks of Asociación Civil AlterMundi. Running this software does not make a
deployment a Harmonic Beacon; joining the Constellation is governed by its
charter, which is a separate trademark license. [NOTICE](./NOTICE) states this in
full, along with the third-party components whose licenses carry obligations of
their own.

Copyright © 2026 Asociación Civil AlterMundi.
