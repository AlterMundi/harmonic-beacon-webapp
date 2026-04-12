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
- **NextAuth v5** with **Zitadel OIDC** (roles `BEAC_ADMIN`, `BEAC_PROVIDER`, `BEAC_LISTENER`)
- **LiveKit** for the live beacon (WebRTC, room `beacon`, primary publisher `beacon01`)
- **go2rtc** for on-demand meditation streaming
- **Docker Compose** for production deploy (see `deploy/`)
- **Vitest** for testing

## Getting started (development)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

The app needs a running Postgres, a reachable LiveKit server, a Zitadel OIDC client, and go2rtc for meditation streaming. See `TESTING.md` for the go2rtc integration notes and `deploy/` for the production-shaped setup.

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
├── go2rtc/              # Streaming configuration
├── deploy/              # Production deploy artifacts
├── docs/                # Vision, principles, roadmap, phase plans
│   └── phases/          # Phase-by-phase project plans
├── BUSINESS_RULES.md    # Canonical policy document
├── TESTING.md           # Integration testing notes
├── docker-compose.yml   # Production compose
└── Dockerfile           # App container
```

## Operational commitments

The product makes public commitments that are documented and enforceable:

- **[The Covenant of Continuity](./docs/SLO.md)**: the beacon never goes dark.
- **[Trust & Safety](./docs/TRUST_AND_SAFETY.md)**: reports acknowledged within 24 hours, S1 postmortems published publicly.
- **[Research ethics](./docs/RESEARCH_PROTOCOL.md)**: informed consent, revocable participation, preregistered protocols, de-identified public aggregates.
- **[Content policy](./docs/CONTENT_POLICY.md)**: no therapeutic claims, rule-cited moderation, appeals available.
- **[Monetization](./docs/MONETIZATION.md)**: patronage-not-paywall, core experience free forever.

## Deploy

Production deploys run on a managed host with Postgres on the host and Next.js + go2rtc in Docker Compose. See `deploy/README.md` for the deployment runbook.

## License & ownership

© 2026 AlterMundi. All rights reserved. Content and code ownership details are maintained in separate legal agreements; Provider content terms are summarized in [CONTENT_POLICY.md §7](./docs/CONTENT_POLICY.md).
