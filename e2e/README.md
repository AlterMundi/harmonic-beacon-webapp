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

Server-removal coverage installs a test-only state observer before the isolated
admin call, clears its history immediately before removal, and requires an
observed `disconnected`/`reconnecting` state followed by `connected`. Only after
that boundary does it revalidate the exact stage and Beacon publisher
associations and sample both native clocks again before exercising the restored
exit guard. LiveKit retains native track objects while recovering transport, so
this contract intentionally proves post-cycle identity and advancing playback
rather than requiring object replacement or a second `TrackSubscribed` event the
SDK does not promise.

## Effective audio activation (#495)

`tests/audio-activation.spec.ts` selects as **live continuity without capture**.
It requires the real fixture DB, application and a loopback LiveKit server;
missing fixtures fail both locally and in CI, never skip. Test-side publishers
use the installed LiveKit SDK and synthesized WebAudio tracks over real RTP in
the Beacon and Spanish stage rooms. No microphone/camera permission is granted.
The listener fixture denies all device acquisition and records every request.
It strongly retains the exact instrumented `MediaDevices` object for the document
lifetime: WebKit can otherwise recreate its wrapper and lose the interceptor.
It explicitly expects the existing default-on ThumbnailSender's one video-only
attempt (`audio:false`, 320×320, facingMode ideal `user`) on entry/refresh, and
one more only after a real app `connected=false/true` lifecycle (retained in
unit coverage). The transport case deliberately qualifies **SDK resume**: it
requires `reconnecting`/`signalReconnecting`, true resume signaling with two
**distinct** participant SIDs, a complete signaling-probe history and no
peer-connection replacement/closure. The one-shot fault closes exactly both
existing native signaling WebSockets with code 4000 and observes both real close
events. It targets only the fixture LiveKit origin and `/rtc` or `/rtc/v1`;
unrelated sockets, native peer connections and RTP are not faulted. Subsequent
SDK handshakes are immediately allowed (no lingering offline mode). Browser
`setOffline` did not reliably sever both signaling connections, notably Firefox.

The wire assertion decodes the actual public protocol without accessing private
SDK fields: legacy `/rtc` requires `reconnect=1` + `sid`, while SDK 2.17 defaults
to `/rtc/v1` with protobuf `join_request` carrying `reconnect=true` +
`participantSid`. Requiring legacy URL keys on v1 would reject genuine resume.
Both formats preserve the same strict semantic gate; malformed/ambiguous wire
data, missing SIDs, incomplete history and any fresh join fail closed.
A fresh app join is rejected, not silently
counted as another permitted capture. SDK resume leaves ThumbnailSender's separate
`connected` prop true, so this case requires **exactly one** original denied
thumbnail attempt throughout recovery. It rejects any microphone or
other capture request, unexpected extra attempt, or acquired video track.
Before/after audio activation and control snapshots must be identical, including
the native-denial and initial-Beacon retry cases. Live-room tests must call
`activateAudioAtMostOnce()` instead of clicking the Start audio CTA directly:
the CTA can disappear after locator resolution when native output becomes ready.
The helper clicks at most once when the control is visible and accepts an absent
or hidden control only after `expectEffectiveAudioReady()` proves both owned
rooms ready (and advancing native tracks when received audio exists). Responsive
geometry checks likewise measure the CTA only while visible; a connected room
with no visible CTA must satisfy the same effective-readiness contract. DOM
presence or a hidden locator is never activation evidence. The camera product
policy is unchanged. Capture evidence is attached to the sanitized media
receipts.
The publisher uses `E2E_LIVEKIT_URL`, `E2E_LIVEKIT_API_KEY`/`_SECRET` and
`E2E_LIVEKIT_ROOM_NAME` (defaults: localhost:7880, devkey/secret, beacon). Keep
the latter identical to the application's `LIVEKIT_ROOM_NAME`.

Run sequentially on the isolated fixture stack, not against production:

```bash
npx playwright test e2e/tests/audio-activation.spec.ts --project=chromium --workers=1
npx playwright test e2e/tests/audio-activation.spec.ts --project=firefox --workers=1
```

The iPhone-WebKit project must select the same `live continuity without capture`
describe title in the combined candidate. This worktree's current config discovers
these cases only for Chromium/Firefox; selection/CI integration is a parent-owned
remaining gate, not a WebKit pass. Physical iPhone Safari remains a separate gate.

The cases cover entry/refresh, real native-play denial and retry, initial Beacon
token outage and recovery, transport recovery, and native playback while unused
SDK auxiliary contexts remain suspended. Fault injection affects only browser
playback policy, signaling sockets, or one token route; the app, entitlement checks,
SDK and media server remain real. Success requires two distinct received tracks with advancing native clocks
(excluding only SDK 2.17.0's `livekit-dummy-audio-el` iOS workaround),
correct visible activation/retry behavior, then effective-readiness attributes.
The initial Beacon retry demands its missing second native source **before** new
attributes. The native-denial fixture suppresses SDK native `autoplay` property
writes and rejects explicit `play()` calls. WebKit can still start a MediaStream
with `autoplay=false`, so a per-element real `play` event guard calls native
`pause()` while the fault is active, including on detached SDK elements.
The test first proves both real outputs are paused with autoplay disabled and
two distinct live tracks. A rejected gesture must leave their native snapshots
unchanged; releasing policy alone must also leave them unchanged. Only the real
retry gesture may produce advancing playback on those same tracks. No paused,
clock, track, readiness or SDK state is fabricated. Failure diagnostics are
captured before room cleanup, and sanitized receipts omit token-bearing URLs.

When both native sources are already playing on entry/refresh/recovery, the test
requires advancing playback and a hidden Start-audio CTA **before** the helper can
click; it then asserts zero activation clicks. Otherwise it allows at most one
activation and still demands positive readiness. `native-autoplay` annotations
record which branch actually ran; a policy-blocked run is not automatic-playback
qualification. No test skips because autoplay was denied or the stack was absent.

The `attendee audio prompt` visual baseline makes the opposite branch deterministic:
it publishes one real audio-only source to the isolated Beacon room and applies the
same native-playback denial before entry. The source is stopped in `finally`; no
runner autoplay policy, synthetic readiness attribute, or stage video can decide
whether that snapshot contains the activation CTA. The test hides only the prompt
card's consumer-specific transient error so the baseline remains scoped to prompt
layout, while its denial counter still proves a real native `play()` rejection.

### Native-only readiness contract and corrected graph assumption

Both app rooms retain the SDK default `webAudioMix: false`. With owned outputs,
the observer requires connected transport and every native element's current
`paused`/`ended`/`error` state to be healthy. Only with no owned outputs does it
fall back to public `canPlaybackAudio`. SDK connect-time auxiliary acquisition
is not awaited and can emit a late false flag after native playback succeeds;
that flag must not overwrite actual healthy output evidence. A later paused,
ended, errored or newly blocked source still invalidates readiness (no success
latch). The ordering test uses real public SDK connect/startAudio calls with
platform/transport doubles, not private SDK fields. It observes **neither
private SDK AudioContext** and
does not measure speaker output. Intentional native mute/zero volume and no
publisher are not permission failures (the browser suite separately requires real
sources so its playback assertions cannot pass vacuously).

The SDK 2.17.0 probe found that `startAudio()` can resolve and report
`canPlaybackAudio=true` while its auxiliary context is suspended. That alone is
**not evidence of silence on the existing native route**. The earlier requirement
that both SDK contexts must run was an incorrect technical assumption, not an
approved product regression. The rejected RED/probe evidence is retained in the
#495 operational checkpoint; the regression now checks the actual output contract.

Public `webAudioMix.audioContext` injection would enable a new remote WebAudio
route, not merely expose state. A real-SDK/native-Chromium probe measured nonzero
signal with graph gain 1 while native volume was 0 and muted; the new graph bypasses
existing native controls. No routing migration, context injection, private-field
access or acoustic change is authorized or implemented. The observer fails closed
unless resolved public `room.options.webAudioMix === false`; both `true` and an
explicit context are unsupported even if native playback succeeds. Unit Room mocks
preserve supplied options instead of silently pretending mixing is disabled.

Local unit/type/lint results are not full-stack qualification. The combined exact
candidate still needs sequential real-stack browser execution, browser-selection
verification, independent review and release-specific acoustic/device gates.
An optional Start-audio click without positive assertions is not proof.
JSON receipts omit signaling URLs because they carry ephemeral tokens.
The shared `leaveConnectedRoom` helper clicks the room button in its Page/Frame
but locates #70's single confirmation in the outer Page (`Frame.page()`). It
accepts only the actual current and legacy English/Spanish exit labels and
retains the original room-state disappearance assertion after confirmation.
Navigation/SDK teardown changes are separate parent-owned integration work.

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
