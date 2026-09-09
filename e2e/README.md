# E2E quality gates

Browser, accessibility, responsive, visual, and media-continuity gates for
Harmonic Beacon (GitHub issue #69, epic #64). Playwright + axe, one Chromium,
deterministic fixtures, no production credentials or participant data.

## What runs where

| Suite | Needs | Gate |
|---|---|---|
| `tests/smoke.spec.ts` | stack for role journeys | routing, login, keyboard focus |
| `tests/accessibility.spec.ts` | stack for role surfaces | axe WCAG 2.0/2.1 A+AA, critical/serious fail |
| `tests/responsive.spec.ts` | nothing | layout geometry at 1440/1024/768/390/320 px |
| `tests/visual.spec.ts` | stack | screenshot baselines at the same five widths |
| `tests/media-continuity.spec.ts` | stack + LiveKit | the four media invariants in desktop Chromium, Android/Chrome emulation and iPhone/WebKit emulation |
| `tests/rtc-audio-stats.spec.ts` | browser only | sanitized RTC audio-stat whitelist and per-peer failure isolation |
| `tests/stage-invitation.spec.ts` | stack + LiveKit | two-browser hand → decline/invite → fresh connection stays pending → accept → return journey |
| `tests/whole-system.spec.ts` | stack + LiveKit | two consecutive ES → EN waiting → doors → hand → invite → decline/accept → return → terminate lifecycles, selected-event health, plus one-identity `FACILITATOR_OP` admission/reconciliation |
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
   it current without regenerating anything. The guarded loader refreshes
   only non-revoked ticket expirations in the throwaway database, so fixed
   historical event timestamps remain deterministic while attendee login
   does not expire merely because wall-clock time advances.

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
   output itself. First time only, install the pinned browsers used by CI:

   ```bash
   npx playwright install chromium webkit
   ```

   CI runs Chromium screenshots before installing WebKit's OS dependencies;
   the extra WebKit font packages otherwise change Chromium rasterization on a
   fresh hosted runner. WebKit then runs as a separate command against the same
   fixture stack.

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
invariant. The probe is panel-agnostic. For the #70 cockpit it snapshots the
persistent same-origin room frame before and after every conductor drawer,
proving that operational UI changes do not replace or reactivate media.

The same probe exposes `rtcAudioStatsSnapshot()` for #93 diagnostics. It reads
active peer connections without changing them and emits only the whitelist
documented in
[`docs/verification/rtc-audio-diagnostics.md`](../docs/verification/rtc-audio-diagnostics.md).
The real-LiveKit attendee journey attaches that sanitized JSON to its test
result. It never includes RTC ids, SSRCs, participant/track identities,
device ids, candidates, IPs, ports, URLs or tokens.

## Screenshot baselines

Baselines live in `tests/visual.spec.ts-snapshots/` and are blessed
intentionally for seven surfaces (landing, staff portal, attendee audio
prompt, conductor cockpit, event hub, admission and health) at all five
widths. They contain fixture data only; dynamic participant state is masked
explicitly, animations are disabled, and the 1% pixel tolerance only absorbs
font rasterization.
Regenerate on the reference environment and review the diff before committing:

```bash
E2E_DATABASE_URL=... npm run test:e2e:update-snapshots
```

If the CI runner renders fonts differently than your machine, regenerate
there — never bump the tolerance to absorb a different platform.

## Known boundaries

- Axe runs the WCAG AA `color-contrast` rule against rendered surfaces; no
  accessibility rule is disabled.
- Android/Chrome and iPhone/WebKit projects emulate the browser/device profile
  and exercise a real local LiveKit server. They do not measure the speaker,
  microphone, radio path or native audio stack of physical devices. The dated
  rehearsal under `docs/ops/rehearsals/` remains the launch evidence for real
  iPhone Safari, Android Chrome and desktop hardware.
- The `audio-touching` label check for frozen audio paths lives in
  `.github/workflows/audio-boundary.yml`; review routing lives in
  `.github/CODEOWNERS`.
