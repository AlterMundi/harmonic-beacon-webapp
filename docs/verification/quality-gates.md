# Quality Gates — Browser, Accessibility, Visual, Media Continuity

**Branch:** `feat/ux-09-quality`
**Issue:** #69 (parent epic #64)
**Date:** 2026-07-31

*Draft · 2026-07-31 · pending validation*

This document records what the issue #69 quality gates are, what they
proved on the branch that introduced them, and what they deliberately do
not cover yet. Running instructions live in [e2e/README.md](../../e2e/README.md);
this file is the evidence register, not the how-to.

## Gate inventory

| Gate | Implementation | CI enforcement |
|---|---|---|
| Functional smoke (roles, routing, keyboard) | `e2e/tests/smoke.spec.ts` | `.github/workflows/e2e.yml` |
| Accessibility (axe WCAG 2.0/2.1 A+AA) | `e2e/tests/accessibility.spec.ts` | same |
| Responsive geometry (1440/1024/390/320 px) | `e2e/tests/responsive.spec.ts` | same |
| Visual baselines (same four widths) | `e2e/tests/visual.spec.ts` + snapshots | same |
| Media continuity, real browser + LiveKit | `e2e/tests/media-continuity.spec.ts` + `e2e/helpers/media-probe.ts` | same |
| Media continuity, integration level | `src/app/session/[id]/__tests__/media-continuity.test.tsx` | existing `test` job (Vitest) |
| Frozen audio boundaries | `.github/CODEOWNERS` | `.github/workflows/audio-boundary.yml` (`audio-touching` label) |

## Evidence from the introduction run

Environment: throwaway Postgres 16 container seeded from
`db/test-fixture.sql` + `prisma migrate deploy`; `livekit/livekit-server`
dev container (`devkey`/`secret`); production build (`next build`) served
by Playwright; Chromium 149 (Playwright 1.61.0).

- **Smoke: 9/9 passed.** Attendee ticket login, identical generic failure
  for revoked and unknown codes, facilitator/operator/admin staff journeys,
  keyboard-only path with visible focus.
- **Accessibility: 6/6 passed**, zero critical/serious violations on
  landing (also under `prefers-reduced-motion`), staff login, attendee
  session shell, operator admission, facilitator console. The gate caught
  one real defect on introduction: unnamed `<select>` elements in
  `AdmissionConsole` (fixed with accessible names in the same branch).
- **Responsive: 12/12 passed** (3 tests × 4 widths) — no horizontal
  overflow, login controls inside the viewport at 320 px.
- **Visual: 8/8 passed** (2 surfaces × 4 widths) against baselines blessed
  in the same environment.
- **Media continuity, browser: 2/2 passed.** Facilitator published real
  mic+camera; attendee activated audio once; exercising every mounted
  control (volume, mix, hand raise/lower) and audio-only off/on produced
  zero signaling-socket closes, zero `RTCPeerConnection` closes, zero media
  element detachments, zero duplicate sources, zero extra `play()` or
  `AudioContext.resume()` calls. Ops cockpit surfaces mount no media at
  all (zero sockets, peer connections, audio contexts).
- **Media continuity, Vitest: 2/2 passed** in the standard `npm test`
  gate with the LiveKit client faked.

## Deliberate gaps (not silently weakened, tracked)

- **`color-contrast` axe rule disabled.** Measured contrast is part of the
  #73 visual-system acceptance; the rule must be re-enabled when that
  lands. Comment in `accessibility.spec.ts`.
- **Cockpit panels are not yet in the live shell.** Today's ops consoles
  are separate pages that mount no media (pinned by a test). The #70
  single-mount cockpit must extend the exercise in
  `media-continuity.spec.ts` — the probe and assertions are already
  panel-agnostic.
- **Attendees cannot enter a SCHEDULED session** (stage token requires
  `LIVE`, see `src/lib/room-entitlement.ts`), so tests open doors by
  flipping the fixture session to `LIVE` and restoring it. A truthful
  waiting room is #65's scope.
- **Phase B of issue #69 is not automated here**: two consecutive event
  lifecycles, full hand-flow journeys, operator-preview-muted, and
  real-device Safari/iOS + Firefox/Chrome evidence remain rehearsal
  activities (#24) that can now cite these gates instead of re-verifying
  the layers they cover.
- **The #64 0–3 rubric is not yet scored per surface**; these gates supply
  the Continuity and Reach evidence for that scoring.
