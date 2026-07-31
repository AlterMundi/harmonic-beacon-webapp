# E2E quality gates

Browser, accessibility, responsive, visual, and media-continuity gates for
Harmonic Beacon (GitHub issue #69, epic #64). Playwright + axe, one Chromium,
deterministic fixtures, no production credentials or participant data.

## What runs where

| Suite | Needs | Gate |
|---|---|---|
| `tests/smoke.spec.ts` | stack for role journeys | routing, login, keyboard focus |
| `tests/accessibility.spec.ts` | stack for role surfaces | axe WCAG 2.0/2.1 A+AA, critical/serious fail |
| `tests/responsive.spec.ts` | nothing | layout geometry at 1440/1024/390/320 px |
| `tests/visual.spec.ts` | stack | screenshot baselines at the same four widths |
| `tests/media-continuity.spec.ts` | stack + LiveKit | the four media invariants, real browser + server |
| `src/app/session/[id]/__tests__/media-continuity.test.tsx` | nothing | same invariants in Vitest/jsdom (`npm test`) |

Suites that need the stack skip with a precise reason when it is missing —
they never weaken their assertions to pass.

## The deterministic stack

1. **Fixture database.** Any throwaway Postgres; the repo pins the content:

   ```bash
   docker run -d --name hb-e2e-pg -p 55432:5432 \
     -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=beacon_test postgres:16-alpine
   E2E_DATABASE_URL=postgresql://postgres:e2e@localhost:55432/beacon_test npm run db:fixture:load
   DATABASE_URL=postgresql://postgres:e2e@localhost:55432/beacon_test npx prisma migrate deploy
   ```

   The dump predates pending migrations by design; `migrate deploy` brings
   it current without regenerating anything.

2. **LiveKit** (only for the media-continuity suite):

   ```bash
   docker run -d --name hb-e2e-livekit --network host \
     livekit/livekit-server:latest --dev --node-ip 127.0.0.1
   ```

   Dev credentials are LiveKit's public placeholders (`devkey`/`secret`).

3. **Run the gates:**

   ```bash
   E2E_DATABASE_URL=postgresql://postgres:e2e@localhost:55432/beacon_test npm run test:e2e
   ```

   Playwright builds the app (`npm run build`) and serves the production
   output itself. First time only: `npm run test:e2e:install` (Chromium;
   pinned to the revision cached on the runner).

Environment overrides: `E2E_BASE_URL` (already-running stack; the server
step is skipped), `E2E_DATABASE_URL`, `E2E_LIVEKIT_URL`,
`E2E_LIVEKIT_API_KEY`/`_SECRET`, `E2E_PORT`. The managed server always runs
with the pinned test pepper and `E2E_DASHBOARD_ENABLED=1`, and these
process env values always win over any local `.env*` file — the gates
cannot silently run against production.

## Media-continuity probe

`helpers/media-probe.ts` injects before the app and observes the platform
surfaces a regression must touch — cross-origin (LiveKit signaling)
WebSocket close, `RTCPeerConnection.close`, `<audio>/<video>` attach/detach
and duplicate sources, `HTMLMediaElement.play`, `AudioContext` creation and
resume. A flow is bracketed by two snapshots and
`expectMediaContinuity(before, after)` fails with the exact broken
invariant. The probe is panel-agnostic: when the #70 single-mount cockpit
lands, opening its panels is added to the exercise in
`media-continuity.spec.ts` and the same assertions prove the invariant.

## Screenshot baselines

Baselines live in `tests/visual.spec.ts-snapshots/` and are blessed
intentionally: surfaces contain fixture data only, no time-based content,
animations disabled, 1% pixel tolerance for font rasterization. Regenerate
on the reference environment and review the diff before committing:

```bash
E2E_DATABASE_URL=... npm run test:e2e:update-snapshots
```

If the CI runner renders fonts differently than your machine, regenerate
there — never bump the tolerance to absorb a different platform.

## Known boundaries

- The `color-contrast` axe rule is disabled with a comment in
  `accessibility.spec.ts`: measured contrast is part of the #73 visual
  system acceptance, and the rule must be re-enabled when it lands.
- Real-device Safari/iOS and Firefox/Chrome evidence remains a human
  supplement (issue #69 Phase B), not automation.
- The `audio-touching` label check for frozen audio paths lives in
  `.github/workflows/audio-boundary.yml`; review routing lives in
  `.github/CODEOWNERS`.
