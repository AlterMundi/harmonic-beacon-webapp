# Quality Gates — Browser, Accessibility, Visual, Media Continuity

**Branch:** `feat/ux-professionalization`
**Issue:** #69 (parent epic #64)
**Date:** 2026-07-31

*Validated locally · 2026-07-31*

This document records what the issue #69 quality gates are, what they
proved on the branch that introduced them, and what they deliberately do
not cover yet. Running instructions live in [e2e/README.md](../../e2e/README.md);
this file is the evidence register, not the how-to.

## Gate inventory

| Gate | Implementation | CI enforcement |
|---|---|---|
| Functional smoke (roles, routing, keyboard) | `e2e/tests/smoke.spec.ts` | `.github/workflows/e2e.yml` |
| Accessibility (axe WCAG 2.0/2.1 A+AA) | `e2e/tests/accessibility.spec.ts` | same |
| Responsive geometry (1440/1024/768/390/320 px) | `e2e/tests/responsive.spec.ts` | same |
| Visual baselines (same five widths) | `e2e/tests/visual.spec.ts` + snapshots | same |
| Media continuity, real browser + LiveKit | `e2e/tests/media-continuity.spec.ts` + `e2e/helpers/media-probe.ts` | same |
| Sanitized RTC audio diagnostics | `e2e/tests/rtc-audio-stats.spec.ts` + `docs/verification/rtc-audio-diagnostics.md` | same |
| Stage invitation consent, two browsers + LiveKit | `e2e/tests/stage-invitation.spec.ts` | same |
| Media continuity, integration level | `src/app/session/[id]/__tests__/media-continuity.test.tsx` | existing `test` job (Vitest) |
| Frozen audio boundaries | `.github/CODEOWNERS` | `.github/workflows/audio-boundary.yml` (`audio-touching` label) |

## Evidence from the introduction run

Environment: throwaway Postgres 16 container seeded from
`db/test-fixture.sql` + `prisma migrate deploy`; `livekit/livekit-server`
dev container (`devkey`/`secret`); production build (`next build`) served
by Playwright; Chromium 149 (Playwright 1.61.0).

- **Smoke: 10/10 passed.** Attendee ticket login, identical generic failure
  for revoked and unknown codes, facilitator/operator/admin staff journeys,
  keyboard-only path with visible focus.
- **Accessibility: 6/6 passed**, zero critical/serious violations on
  landing (also under `prefers-reduced-motion`), staff login, attendee
  session shell, operator admission, facilitator console and each of its
  five open drawers. The gate caught
  one real defect on introduction: unnamed `<select>` elements in
  `AdmissionConsole` (fixed with accessible names in the same branch).
- **Responsive:** the current gate covers 7 scenarios × 5 widths — no horizontal
  overflow on the landing, staff portal, attendee room or conductor cockpit;
  event-health paths wrap, and controls remain inside the viewport at 320 px.
- **Visual:** the current gate covers 7 surfaces × 5 widths against reviewed
  baselines for the landing, staff portal, attendee audio prompt, conductor
  cockpit, event hub, admission and health. Dynamic participant state is
  explicitly masked.
- **Media continuity, browser: 2/2 passed.** Facilitator published real
  mic+camera; attendee activated audio once; exercising every mounted
  control (volume, mix, hand raise/lower) and audio-only off/on produced
  zero signaling-socket closes, zero `RTCPeerConnection` closes, zero media
  element detachments, zero duplicate sources, zero extra `play()` or
  `AudioContext.resume()` calls. The staff cockpit mounts exactly one
  subscribe-only preview room in its persistent same-origin frame; opening
  all five conductor signals produces the same zero-close, zero-detach,
  zero-reactivation result.
- **RTC audio diagnostics are measurement, not an acoustic fix.** The probe
  can attach loss, jitter, RTT, concealment, level, codec and whitelisted
  track settings from real local LiveKit while excluding identities,
  candidates, device ids and signaling data. Physical routing and listening
  remain explicit gaps under #93/#94.
- **Stage invitation: 1/1 passed.** Two independent browser identities
  completed hand raise → invite → decline and hand raise → invite → accept
  with fake camera+microphone → staff return. The test waits on durable
  UI state and real LiveKit publication rather than request completion.
- **Media continuity, Vitest: 2/2 passed** in the standard `npm test`
  gate with the LiveKit client faked.
- **Repository gates: 576/576 unit/integration tests passed**, together
  with TypeScript, ESLint and the production build.

## Deliberate gaps (not silently weakened, tracked)

- **Color contrast is enforced.** Axe runs WCAG AA contrast against rendered
  translucent surfaces; no accessibility rule is disabled.
- **The cockpit uses a persistent same-origin room frame.** This isolates the
  frozen audio provider from operational drawer renders while keeping one
  staff experience and one room mount. The real-browser continuity test
  measures the frame directly across all panel changes.
- **Scheduled sessions have a truthful waiting-room boundary.** Tests that
  need a live room transition the local fixture session to `LIVE` and
  restore it in `finally`; the database guard accepts only a loopback host
  and a database named exactly `beacon_test`.
- **Remaining Phase B evidence is intentionally physical:** two consecutive
  complete event lifecycles and real-device Safari/iOS + Firefox/Chrome
  rehearsal remain tracked by #24. The automated suite now covers the full
  hand/invitation consent journey and the muted subscribe-only cockpit.
- **The #64 0–3 rubric now has a dated provisional scorecard** in
  [`2026-08-04-quality-rubric.md`](./2026-08-04-quality-rubric.md). It uses
  these gates as evidence and keeps human/physical-device sign-off explicit;
  it does not close #64 or #69 by itself.
