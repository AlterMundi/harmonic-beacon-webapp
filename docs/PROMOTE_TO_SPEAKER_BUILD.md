# Build Spec — Interactive "Sharing Round" via Promote-to-Speaker

**Status:** Engineering spec for review · 2026-07-25 · **reconciled against `main` 2026-07-28**
**Audience:** External reviewer + their agents. Self-contained; every file/symbol referenced is real and cited.
**Repo:** `harmonic-beacon-webapp` (Next.js 16 App Router · LiveKit · Prisma/Postgres · Auth.js v5).

> **🔬 Peer-review note (2026-07-28).** From
> [`docs/reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md`](./reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md):
> - **`maxPublishers` must be set AND enforced (server + UI) before tickets are sold** — it's a launch blocker,
>   not a config detail. Load-test at the cap ×1.5.
> - **The cost driver is *receivers × subscribed bitrate*, not publisher count.** 40 publishers watched by 500
>   receivers ≈ ~18.9 TB/event (~$2,000/mo) — far more than a 40-person circle (~240 GB). So a big audience
>   *watching* the camera circle is the expensive case; state per-session whether all attendees receive the
>   circle or only the circle members do.
> - **Promoted-after-recording-starts speakers are NOT captured** by the per-track egress snapshot; and Cloud
>   breaks today's local-path egress. **Recording off for launch**, or dynamic/composite egress → R2/S3 first.
> - Admission itself (who may even get a session token) is **not enforced today** — see the pivot plan; this
>   spec's promotion logic assumes the entitlement gate exists.

> **🔄 Reconciliation note (2026-07-28).** This spec was first drafted against `release`; these are the deltas
> after re-reading current `main`. The design is unchanged; anchors and integration points are corrected below.
> - **Session-page line numbers all shifted** (`src/app/session/[id]/page.tsx` grew). Current anchors: `Room`
>   creation **:142**; token fetch **:121-128**; `canPublish` state **:63** (set at **:132**); `toggleMic`
>   **:249-271** (now `async`); `RoomEvent` handlers **:145-183**; mic button gate **:486**. The connect
>   `useEffect` dep array is `[id, inviteCode, retryToken]` (**:216**) — **`retryToken` (:74) is the existing
>   reconnect mechanism** a role-change reconnect should reuse.
> - **NEW terminal/disconnect machinery to integrate with (did not exist before):** `classifyDisconnectReason`
>   (**:31-49**), `disconnectState` (**:73**), `intentionalDisconnectRef` (**:83**), and a terminal "Session
>   ended / Connection lost" view (**:361-409**). **Any deliberate `room.disconnect()` for promotion/reconnect
>   must set `intentionalDisconnectRef.current = true` first**, or it trips the "session ended" screen.
> - **go2rtc has been removed** (commit `9512899`). `AudioContext.tsx` no longer has `loadMeditationFromGo2rtc`
>   (dead code, deleted); meditation is now a local HTML5 `<audio>` element, and `/api/meditations` is GET-only.
>   Ignore any go2rtc references this spec inherited.
> - **Unchanged / still valid:** `token/route.ts` `canPublish` logic (**:62, 89-91**) + identity `user-${user.id}`
>   (**:121**); `createSessionToken(room,identity,name,canPublish)` and `getRoomService()` in `livekit-server.ts`;
>   video/camera is still **100% greenfield** (no camera code anywhere); `SessionSpeaker`/`SessionMode` and the
>   voucher models proposed here **do not exist yet and have no naming collisions**. `SessionInvite.canPublish`
>   still exists as the seed noted below.

---

## 1. Goal & product context

Paid group sessions are led by a **provider** (facilitator). During the session there is a **sharing round**:
individual **listeners** unmute and speak their experience to the whole room, one (or a few) at a time. We must
support this **without letting 500 people publish audio simultaneously** — that's neither needed nor affordable
— and **without losing the current sub-second WebRTC latency**.

The mechanism is **promote-to-speaker**: listeners join muted with no publish rights; when it is someone's turn,
the provider grants that person publish rights for the duration of their share, then revokes them. This is a
standard LiveKit "interactive livestream" pattern and is an *extension of code that already exists* in this
repo, not a rewrite.

### 1.1 Two interaction modes (video added 2026-07-27)

Sessions also include a **connection exercise where everyone activates their camera, like a Zoom meeting**
(mutual audio + video). That is *not* a promotion — it's a whole-room mode. So a session moves between two modes
(often as phases of one session):

| Mode | Who publishes | Media | Group size | Mechanism |
|------|---------------|-------|-----------|-----------|
| **Circle** (connection exercise) | **Everyone** | audio **+ video** | **small — ≤ ~25 ideal, ≤ ~50 hard cap** | session-level "open floor": grant all participants publish |
| **Broadcast + sharing round** | provider, then 1–3 promoted listeners | audio (+ video for the active speaker) | hundreds+ | per-speaker promote-to-speaker (§4) |

**Hard physics constraint (see infra analysis Part 3.5):** "everyone on camera" and "hundreds in one room"
cannot coexist — no SFU/Zoom renders 500 equal video tiles (uplink, egress, and browser decode limits all
break well before that). **Camera-on Circle mode is therefore a capped small-group format.** This spec supports
both modes and the transition between them; the group-size cap is a config + product decision (see §11).

**In scope now:** mutual **video** (Circle mode), per-speaker **camera** grants (sharing round), the paginated
video grid, and mode transitions — in addition to the original mic mechanic.
**Non-goals:** breakout rooms and text chat. Beacon audio sourcing is covered by the pivot plan (WS3) and the
infra analysis.

---

## 2. Current architecture (grounded)

### 2.1 The session room today
- **Listener/provider UI:** `src/app/session/[id]/page.tsx` (`SessionRoomPage`). It creates its **own**
  `livekit-client` `Room` (**:142**), fetches a token (**:121-128**), and connects. Note this is a *separate* room from the
  always-on "beacon" room managed by `src/context/AudioContext.tsx` — the crossfader in the session page mixes
  *this* session room's audio against the global beacon via `setBeaconVolume()` from `useAudio()`
  (`session/[id]/page.tsx:174-182`).
- **Token minting:** `GET src/app/api/scheduled-sessions/[id]/token/route.ts` computes a boolean `canPublish`
  and calls `createSessionToken(roomName, identity, name, canPublish)`. Identity format is **`user-${user.id}`**
  (`token/route.ts:121`). It also upserts a `SessionParticipant` row (`token/route.ts:113-119`).
- **`canPublish` is static today:** `true` for the provider (`isProvider`), otherwise `false`, unless the join
  used an invite with `invite.canPublish` (`token/route.ts:62, 89-91`). There is **no way to change publish
  rights after join** except reconnecting with a different token.
- **Mic control exists but is gated on the static flag:** `toggleMic()` (`session/[id]/page.tsx:249-271`) calls
  `room.localParticipant.setMicrophoneEnabled(true)`, and the mic button only renders `if (canPublish)`
  (**:486**). So the plumbing to publish a mic is already there — it's just permanently off for listeners.
- **Server helpers:** `src/lib/livekit-server.ts` exposes `getRoomService()` → a `RoomServiceClient` (the
  server-side API we need for live permission changes) and `createSessionToken(...)`.
- **No signaling channel exists yet** — no `publishData`/`DataReceived` usage, no participant-metadata usage.

### 2.2 What's missing for a sharing round
1. A way for a listener to **request to speak** (raise hand).
2. A way for the provider to **grant/revoke publish rights live**, without the listener reconnecting.
3. **Persistence** of "this user is currently a speaker," so a refresh/reconnect doesn't silently drop their
   rights (the token route is the source of truth and currently doesn't know about promotions).
4. **Provider moderation UI**: hand queue, promote/demote, mute, mute-all, end-round.
5. **Client reaction** to permission changes (show/hide mic, auto-mute on demote).

---

## 3. Requirements & constraints

| # | Requirement |
|---|-------------|
| R1 | ≤ N concurrent *sharing-round* speakers (config, default N=1–3). Never hundreds of publishers in Broadcast mode. |
| R2 | Promotion/demotion — and mode changes — are **live**: no reconnect, no audio/video gap. |
| R3 | Speaker/mode state **survives reconnect/refresh** (server-authoritative). |
| R4 | Provider can force-mute/-camera-off any participant and **mute-all / end round / close circle** instantly. |
| R5 | Preserve sub-second latency (stay on WebRTC/LiveKit; no HLS). Video does not change this. |
| R6 | Abuse-resistant: only authenticated, voucher-valid participants publish; provider fully controls the floor and the circle. |
| R7 | Works on mobile Safari/Chrome (mic **and camera** permission prompts, autoplay/gesture rules). |
| R8 | Echo/feedback controlled when listeners become speakers. |
| R9 | **Circle mode:** participants publish audio+video up to **`maxPublishers`** (server/infra-bound). Past it, extra participants are audio/view-only (camera slots) or publish-on-demand. |
| R10 | **Video rendering scales (Zoom model):** each client renders/receives only **`maxVisibleTiles`** (≈40) via pagination + active-speaker spotlight + selective subscription + Dynacast; simulcast/adaptive layers; **audio-only toggle**. Makes room size independent of any device. |

---

## 4. Design overview

**Server-authoritative floor control.** The database is the source of truth for who may speak; LiveKit is the
transport that enforces it in real time. Two coordinated mechanisms:

1. **Live permission change** via `RoomServiceClient.updateParticipant(room, identity, { permission })` — flips
   `canPublish` on a *connected* participant instantly. The client receives
   `RoomEvent.ParticipantPermissionsChanged` and `localParticipant.permissions.canPublish` updates **without a
   reconnect** (satisfies R2).
2. **Durable speaker state** persisted in Postgres so that the **token route** (`.../token/route.ts`) grants the
   correct `canPublish` if the user reconnects (satisfies R3). Promotion writes DB *and* calls LiveKit; the two
   are kept consistent.

**Raise-hand signaling** uses LiveKit **data messages** (`localParticipant.publishData`, topic `"hand"`) for
low-latency in-room signaling, backed by a DB row so the provider's queue survives a provider refresh. (A
pure-DB + polling fallback is described in §8 for robustness.)

```
Listener taps "Raise hand"
   → publishData({topic:"hand", raised:true})      (instant, in-room)
   → POST /api/scheduled-sessions/[id]/hands        (durable queue row)
Provider panel shows queue (from DataReceived + GET /hands)
Provider taps "Give floor" on a listener
   → POST /api/provider/sessions/[id]/speakers  {identity, action:"promote"}
        server: (a) DB upsert SessionSpeaker(active=true)
                (b) RoomServiceClient.updateParticipant(room, identity, {permission:{canPublish:true,...}})
Listener client: RoomEvent.ParticipantPermissionsChanged → canPublish=true
   → auto-enable mic (or show "You can speak — tap to talk")
Provider taps "Take floor back" / listener finishes
   → POST .../speakers {identity, action:"demote"}  → canPublish:false + unpublish + DB active=false
```

---

### 4.1 Circle mode = a session-level "open floor" (everyone on camera)

Circle mode is the same permission machinery applied to *all* participants at once, plus a size cap:

```
Provider starts Circle mode (opening connection exercise):
   → PATCH /api/provider/sessions/[id]  { mode: "CIRCLE" }
        server: (a) ScheduledSession.mode = CIRCLE
                (b) for each connected participant (≤ CAP): updateParticipant(..., {
                      canPublish:true, canPublishSources:[MICROPHONE, CAMERA] })
                (c) new joiners inherit CIRCLE via the token route (canPublish granted up to CAP)
   → clients: RoomEvent.RoomMetadataChanged → mode=CIRCLE → each client shows a
       "Turn on your camera & mic" prompt (tap = the required user gesture), then
       setCameraEnabled(true) + setMicrophoneEnabled(true); render a paginated video grid.

Provider closes Circle (moves to guided / broadcast phase):
   → PATCH /api/provider/sessions/[id]  { mode: "BROADCAST" }
        server: revoke publish for all non-provider participants; clients stop cam/mic.
   → sharing round then uses the per-speaker promote flow (§4) on top of BROADCAST mode.
```

Two grant *scopes* share one code path: **per-participant** (sharing round, §4/§6.3) and **all-participants**
(Circle mode). Both write durable state and call `updateParticipant`; both are enforced against a cap. The only
new axis vs the audio-only spec is including **`TrackSource.CAMERA`** in `canPublishSources` and rendering video.

**Two independent knobs (this is Zoom's actual model).** Do not conflate them:

1. **`maxVisibleTiles` — how many camera tiles each client renders/receives at once. Decided ≈ 40.** This is a
   **client-side** limit implemented with pagination + active-speaker spotlight + **selective subscription**
   (you only *receive* the tiles on your current page). **It makes room size irrelevant to any one device** — a
   viewer in a 40-person room or a 300-person room both only ever decode ~40 streams. This is the "how does Zoom
   show a huge call" answer, and LiveKit gives it for free.
2. **`maxPublishers` — how many people actually publish a camera at once (room capacity).** This is a
   **server/infra** limit (ingest + forwarding load), *unrelated to what any screen shows*, and it's the one
   that costs money. See §8 + infra analysis Part 3.5 for the tiers.

The mechanism that makes knob #1 cheap — same as Zoom:
- **Self-view is local** — your own camera is never uploaded-then-downloaded.
- **Simulcast:** each client publishes multiple resolution layers; the SFU forwards the layer matching each
  viewer's tile size (thumbnail for grid, high-res for spotlight).
- **Selective subscription / adaptive stream:** clients subscribe only to on-screen tiles; off-page tiles aren't
  sent or decoded.
- **Dynacast:** the SFU stops forwarding camera layers that *no one is currently viewing* (e.g., pages nobody is
  looking at) — bounds egress toward "what's actually watched," not `publishers × viewers`.

**So large rooms (e.g., 300) with everyone's camera on ARE supported** — each viewer paginates ~40 at a time,
Zoom-style. The room size is capped by infra/cost (`maxPublishers`), **not** by the screen. Small "Circle"
sessions (≤ `maxVisibleTiles`) are the special case where everyone fits on one page with no paging.

**Product option for large camera rooms:** at 300, consider **publish-when-visible/speaking** ("camera slots")
rather than 300 continuous uploads — only participants on someone's current page or the active speaker actually
publish. Far cheaper, and perceptually identical (nobody can watch 300 faces at once anyway). Decide this
explicitly (see §11 Q7).
**Mobile caveat:** even ~40 live tiles is heavy on phones — render fewer, larger tiles + scroll, or audio-heavy
mode (R10).

---

## 5. Data model changes (`prisma/schema.prisma`)

Add a durable speaker/floor record. Minimal option is a new model; alternative is fields on the existing
`SessionParticipant` (`schema.prisma:269-284`).

**Also add a session mode** to `ScheduledSession` so the token route and reconnects know the current phase:
```prisma
enum SessionMode { BROADCAST  CIRCLE }   // default BROADCAST
// on ScheduledSession:
//   mode           SessionMode  @default(BROADCAST)
//   maxVisibleTiles Int         @default(40)   // CLIENT: tiles rendered/received per screen (pagination). Zoom-style; makes room size irrelevant to any device.
//   maxPublishers   Int         @default(40)   // SERVER: max simultaneous camera publishers (infra/cost-bound). Raise for large camera rooms IF infra supports it (see §8 / infra Part 3.5).
```

```prisma
enum HandState { LOWERED  RAISED  SPEAKING }

model SessionSpeaker {
  id          String            @id @default(uuid())
  sessionId   String            @map("session_id")
  session     ScheduledSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId      String            @map("user_id")
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  identity    String            // "user-<id>", the LiveKit identity — denormalized for the token route
  state       HandState         @default(LOWERED)
  raisedAt    DateTime?         @map("raised_at")   // queue ordering
  grantedAt   DateTime?         @map("granted_at")  // when promoted
  endedAt     DateTime?         @map("ended_at")
  @@unique([sessionId, userId])
  @@index([sessionId, state, raisedAt])   // fast "who is in the queue / who is speaking"
  @@map("session_speakers")
}
```
Add the back-relations on `ScheduledSession` and `User`, and a migration. `state = SPEAKING` rows are the
authoritative "currently allowed to publish" set the token route reads.

---

## 6. API changes

### 6.1 Modify the token route (source-of-truth for reconnects) — `.../token/route.ts`
After computing the existing `canPublish` (line 62), grant it if the session is in **Circle mode** (up to the
cap) OR the user has an active speaker grant. Also return the current `mode` and the granted `sources` so the
client knows whether to enable camera:
```ts
let sources: ('microphone'|'camera')[] = [];
if (!isProvider) {
  if (session.mode === 'CIRCLE') {
    const pubCount = await prisma.sessionSpeaker.count({ where: { sessionId: id, state: 'SPEAKING' } });
    if (pubCount < session.maxPublishers) { canPublish = true; sources = ['microphone','camera']; }
    // else: publisher slots full — join as view-only (still receives up to maxVisibleTiles), surface "camera full"
  } else {
    const spk = await prisma.sessionSpeaker.findUnique({
      where: { sessionId_userId: { sessionId: id, userId: user.id } }, select: { state: true },
    });
    if (spk?.state === 'SPEAKING') { canPublish = true; sources = ['microphone','camera']; }
  }
}
```
The LiveKit token's `VideoGrant` must set `canPublishSources` accordingly (extend `createSessionToken` in
`src/lib/livekit-server.ts` to accept sources, or default to `[MICROPHONE, CAMERA]` when `canPublish`). This
makes a mid-session refresh reconnect **land in the correct mode with the right camera/mic rights** (R3). Return
`mode`, `sources`, and `isProvider` in the JSON so the client renders the right UI. (Also add the pivot voucher
gate here — same choke point; and enforce the Circle cap R9 here so over-cap joiners are view-only.)

### 6.2 New: raise/lower hand — `POST /api/scheduled-sessions/[id]/hands`
- Auth: `requireAuth()`; must be a valid participant (and voucher-valid). Body `{ raised: boolean }`.
- Upserts `SessionSpeaker` → `state = RAISED|LOWERED`, `raisedAt = now()` on raise.
- `GET /api/scheduled-sessions/[id]/hands` → current queue (provider-only), ordered by `raisedAt`.

### 6.3 New: floor control (provider) — `POST /api/provider/sessions/[id]/speakers`
- Auth: provider/admin (already enforced for `/api/provider/**` in `middleware.ts:52-59`) **and** ownership of
  the session.
- Body `{ identity: string, action: 'promote' | 'demote' | 'mute' }`.
- Enforce **R1**: reject `promote` if `count(state=SPEAKING) >= MAX_SPEAKERS`.
- `promote`: DB `state=SPEAKING, grantedAt=now()`; then
  ```ts
  await getRoomService().updateParticipant(roomName, identity, undefined, {
    canSubscribe: true, canPublish: true, canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA], // camera included so a promoted
    // sharing-round speaker can also be seen; drop CAMERA if the sharing round is audio-only (see §11 Q)
  });
  ```
- `demote`: DB `state=LOWERED, endedAt=now()`; `updateParticipant(..., { canPublish:false, canSubscribe:true })`.
  Also call `getRoomService().mutePublishedTrack(...)` (or rely on the client's permission handler to unpublish)
  so audio actually stops immediately.
- `mute`: force-mute without demoting (`mutePublishedTrack`).
- New: `POST /api/provider/sessions/[id]/speakers/mute-all` and an `end-round` that demotes every `SPEAKING`
  row in one transaction + `updateParticipant` loop (R4).

### 6.4 Provider metadata broadcast (optional but recommended)
On promote/demote, also set room/participant **metadata** via `RoomServiceClient.updateRoomMetadata` so every
client (not just the promoted one) can render "X is speaking" consistently, driven by
`RoomEvent.RoomMetadataChanged`.

---

### 6.5 New: mode transition (provider) — `PATCH /api/provider/sessions/[id]` (extend existing)
The provider route already handles `action: 'end'` (`session/[id]/page.tsx:212-216`). Add
`{ mode: 'CIRCLE' | 'BROADCAST' }`:
- → `CIRCLE`: set `ScheduledSession.mode=CIRCLE`; grant publish (audio+camera) to connected non-provider
  participants **up to `maxPublishers`** via an `updateParticipant` loop; write `SessionSpeaker(state=SPEAKING)`
  rows so reconnects inherit it; broadcast room metadata `{mode:'CIRCLE'}`. (Clients still only *render*
  `maxVisibleTiles` via pagination — knob #1.)
- → `BROADCAST`: revoke publish for all non-provider participants (`updateParticipant canPublish:false` loop),
  clear `SPEAKING` rows, broadcast metadata. Sharing-round promotion (§6.3) operates within BROADCAST.
- Enforce `maxPublishers` in a transaction; past it, participants stay view-only (R9). For large camera rooms,
  prefer **publish-on-demand / camera slots** over granting all at once (§11 Q7).

---

## 7. Client changes

### 7.1 Listener — `src/app/session/[id]/page.tsx`
- **React to live permission changes.** Add in the room-event block (near lines 95-127):
  ```ts
  room.on(RoomEvent.ParticipantPermissionsChanged, () => {
    const can = room.localParticipant.permissions?.canPublish ?? false;
    setCanPublish(can);
    if (!can && isMicOn) { /* auto-unpublish */ void toggleMic(); }
  });
  ```
  This flips the existing `canPublish` state (line 30) live, so the **already-built** mic button (line 367) and
  `toggleMic()` (line 184) simply light up when promoted — most of the listener side already exists.
- **Raise-hand button** (always visible to listeners who are not the provider): calls `publishData` + POST
  `/hands`. Show pending/queued/￼speaking status.
- **On promotion:** either auto-call `setMicrophoneEnabled(true)` or (better UX) show "It's your turn — tap to
  speak" to satisfy mobile autoplay/mic-gesture rules (R7). Recommend the explicit tap.
- **On demotion:** stop and unpublish the local mic track (the current `toggleMic` off-branch at lines 189-195
  already does this — reuse it), show "Your turn has ended."
- **Enforce echo cancellation (R8):** when enabling the mic, pass constraints —
  `room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true })` —
  or set `audioCaptureDefaults` on the `Room` options at construction.

### 7.2 Provider — moderation panel
The provider uses the same `session/[id]/page.tsx` room (they get `canPublish` via `isProvider`). Add a
provider-only panel (render when `sessionInfo` role/`isProvider` is known — the token response already returns
enough; add an `isProvider` field to the token JSON for the client):
- **Hand queue** (ordered), fed by `RoomEvent.DataReceived` (topic `"hand"`) + initial `GET /hands`.
- Per-participant actions: **Give floor / Take floor / Mute**. Buttons POST to `/speakers`.
- Global: **Mute all**, **End sharing round**.
- Live speaker indicator via `RoomEvent.ActiveSpeakersChanged` (LiveKit gives audio-level-based active speakers
  for free — useful to show who's actually talking).

### 7.3 Shared
- Handle `RoomEvent.DataReceived` for `"hand"` topic on the provider; ignore elsewhere.
- Consider extracting a small `useSessionRoom` hook, but not required for v1.

### 7.4 Video rendering (both modes) — the biggest net-new client work
The current `session/[id]/page.tsx` only attaches **audio** tracks (lines 95-115) and renders a single static
visualizer — there is **no video UI yet**. Add:
- **Video track handling:** in `RoomEvent.TrackSubscribed`, when `track.kind === Track.Kind.Video`,
  `track.attach()` into a `<video>` tile keyed by participant identity; detach on unsubscribe.
- **Camera enable on the local side:** `room.localParticipant.setCameraEnabled(true)` behind an explicit tap
  (mobile gesture/permission — R7), with a camera on/off toggle next to the existing mic toggle.
- **Paginated video grid + active-speaker spotlight (R10):** render a grid of up to ~25 tiles with pagination;
  use `RoomEvent.ActiveSpeakersChanged` to spotlight the talker. Use **selective subscription / adaptive
  stream** so off-screen tiles aren't subscribed/decoded — critical to not melt phones.
- **Mode-driven UI:** on `mode=CIRCLE`, prompt everyone to turn on camera+mic and show the gallery; on
  `mode=BROADCAST`, show the provider spotlight + (during sharing round) the current speaker.
- **Audio-only toggle (R10):** let a participant opt out of receiving video (unsubscribe all video) to save
  data/CPU on weak devices.
- **Recommended:** consider LiveKit's **`@livekit/components-react`** (`GridLayout`, `ParticipantTile`,
  `useTracks`) to avoid hand-rolling grid/pagination/adaptive-subscription — it implements R10 out of the box.
  Evaluate against the existing bespoke audio code; a hybrid (their components for the grid, your AudioContext
  for the beacon crossfade) is reasonable.

---

## 8. Edge cases, risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Reconnect drops a promoted speaker** (token route didn't know) | §6.1 makes the token route read `SessionSpeaker.state==SPEAKING`. DB is source of truth. |
| **Deliberate reconnect trips the "session ended" terminal view** (NEW machinery, `page.tsx:31-49, 361-409`) | If promotion re-mints a token and reconnects, set `intentionalDisconnectRef.current = true` (`:83`) before `room.disconnect()` — as `leaveSession`/`endSession` already do — so `classifyDisconnectReason` doesn't render the terminal screen. Prefer live `updateParticipant` (no reconnect) to sidestep this entirely. |
| **DB says SPEAKING but LiveKit permission missing (or vice-versa)** after a crash | On session `LIVE` start and on provider panel mount, run a **reconcile**: read DB speakers, re-apply `updateParticipant` for each. Treat DB as authoritative. |
| **Provider refreshes → loses the in-memory hand queue** | Queue is DB-backed (`GET /hands`); data messages only accelerate updates. |
| **Echo/feedback / "double audio"** when listener→speaker | Force `echoCancellation`/`noiseSuppression` (§7.1); auto-mute on demote; only 1–3 speakers (R1) limits feedback loops. |
| **Mobile autoplay / mic-permission gesture** | Explicit "tap to speak" on promotion, not auto-enable (R7). |
| **Abuse: mass hand-raising / trolling** | Provider owns the floor entirely; rate-limit `/hands`; only voucher-valid authenticated users (reuse pivot voucher gate); provider can revoke + a future `blockParticipant`. |
| **> N promotions race** (two provider clicks) | Enforce `MAX_SPEAKERS` server-side inside a transaction, not on the client. |
| **Cost in Broadcast mode** | Only 1–3 publishers ever → bandwidth ≈ broadcast + a trickle. No blow-up. |
| **`updateParticipant` API differences** | Pin `livekit-server-sdk` version; the permission object shape (`ParticipantPermission` / `canPublishSources` with `TrackSource.MICROPHONE`/`.CAMERA`) must match the installed SDK — verify against `package.json` before coding. |
| **Rendering hundreds of tiles (VIDEO)** | Can't draw >~40–49 tiles on any device. **Solved by knob #1** (`maxVisibleTiles`≈40 + pagination + active-speaker + selective subscription) — this is Zoom's model and it makes room size irrelevant to the viewer's device. Not a room-size limit. |
| **Room capacity / ingest (VIDEO)** | The real limit is `maxPublishers` (server ingest + forwarding). ~40–50 publishers is comfortable on a single self-hosted node. **300 all-publishing = a "large meeting" tier**: LiveKit Cloud handles it via distributed mesh (expensive egress, ~$150–190/session — see Part 3.5), or self-hosted needs a **multi-node cluster (Redis + N SFU nodes)**. Enforce `maxPublishers` server-side; use **camera slots / publish-when-visible** to keep it bounded. |
| **Video cost** | ~8–15× audio bandwidth. A ~40-cam session ≈ ~240 GB; a 300-cam session ≈ ~1.5 TB. On LiveKit Cloud metered egress this is a large bill; on a self-hosted box with included bandwidth it's ~$0 (but 300 needs multi-node compute). **Dynacast** bounds egress to what's actually viewed. **Video tilts hosting toward self-hosted** — coordinate with the infra decision. |
| **Device meltdown / mobile** | Mandatory: simulcast (default on), adaptive stream, selective subscription, paginated grid, audio-only toggle. Test on a mid-range phone at the target cap before shipping. |
| **Camera privacy / consent** | Camera-on is sensitive. Never auto-enable — always an explicit tap. Show a clear "you are on camera" indicator; provider can turn a participant's camera off but not on. State the recording/consent policy for video (see Q5). |
| **TURN for video** | More clients behind restrictive NATs will fail P2P; if self-hosting LiveKit, stand up **coturn**. LiveKit Cloud includes TURN. |

---

## 9. Testing plan

- **Unit (Vitest, matches existing `__tests__` style):**
  - token route grants `canPublish` when a `SessionSpeaker` is `SPEAKING`; denies otherwise.
  - `/speakers` promote rejects past `MAX_SPEAKERS`; demote clears DB + calls `updateParticipant`.
  - `/hands` upserts state and orders queue by `raisedAt`.
  - Mock `getRoomService().updateParticipant` (mirror `src/lib/__tests__/livekit-server.test.ts`).
- **Integration/manual:** two browsers (provider + listener) against a real LiveKit (Cloud or local): raise
  hand → promote → confirm listener can speak within &lt;1 s with no reconnect → others hear them → demote →
  audio stops. Refresh the speaker mid-turn → still a speaker. Mute-all → all speakers silenced.
- **Load smoke:** 1 publisher + ~50–100 subscriber simulcast (LiveKit CLI `livekit-cli load-test`) to confirm
  promote/demote latency holds with an audience.

---

## 10. Incremental milestones

1. **M1 — server floor control:** `SessionSpeaker` model + `SessionMode`/`maxCircle` + migration,
   `/speakers` promote/demote, `PATCH .../[id] {mode}`, token-route source-of-truth (mode + sources). Unit
   tests. (No UI yet; test via curl + LiveKit dashboard.)
2. **M2 — listener reaction (audio):** `ParticipantPermissionsChanged` handler + raise-hand button + POST
   `/hands` + live mic on promotion.
3. **M3 — provider panel:** hand queue, give/take floor, mute, mute-all, end-round, **open/close Circle**.
4. **M4 — VIDEO:** local camera enable, video-track attach, **paginated grid + active-speaker spotlight**
   (evaluate `@livekit/components-react`), Circle-mode gallery, audio-only toggle, `maxCircle` enforcement.
5. **M5 — hardening:** echo/camera constraints, reconcile-on-start, rate-limits, mobile gesture + camera
   permission UX, consent indicators, and a **load + device test at the target Circle cap** (LiveKit
   `load-test` + a real mid-range phone).

M1 is independently testable and de-risks the whole feature. **M4 (video) is the largest single chunk** — the
session page has no video UI today — and its cost/scale implications feed back into the hosting decision.

---

## 11. Open questions for the team

1. **MAX_SPEAKERS** default — strictly 1 (turn-taking) or a small panel (e.g., 3)?
2. Should promotion be **provider-driven only**, or a **queue with auto-advance** (next hand gets the floor when
   the current speaker finishes)?
3. Do we want a **listener "request" → provider "approve"** two-step, or provider unilaterally picks from a
   visible raised-hands list? (Spec assumes the latter.)
4. Should **all listeners** see who is speaking (metadata broadcast, §6.4) or only the provider?
5. **Recording implications** — should sharing-round audio **and Circle-mode video** be captured in the session
   recording? Video egress is heavier and consent-sensitive; confirm policy (this also affects storage in R2).
6. Confirm the **`livekit-server-sdk` / `livekit-client` versions** in `package.json` so API shapes are pinned.
7. **(VIDEO) Two knobs, decided separately:**
   - **`maxVisibleTiles` ≈ 40 — DECIDED.** Tiles rendered per screen; pagination + active-speaker beyond that
     (Zoom's model). Sub-question: on **phones**, cap visible tiles lower (scrollable 6–9) or audio-heavy mode?
   - **`maxPublishers` — OPEN, and it's the load-bearing infra decision.** How large can a camera-on room get?
     ≤~40–50 runs on a single self-hosted node cheaply. **Supporting ~300 all-on-camera** (Zoom-style, paginated)
     is a *large-meeting tier*: either LiveKit Cloud (works, but ~$150–190/session egress) or a **multi-node
     self-hosted cluster**. Also decide **publish-when-visible/speaking (camera slots)** vs 300 continuous
     uploads — the former is far cheaper and perceptually identical. This choice drives the hosting decision.
8. **(VIDEO) Is the sharing-round speaker on camera too, or audio-only?** Decides whether §6.3 promote grants
   `CAMERA` (spec currently does).
9. **(VIDEO)** Do sessions have **both** a large audio broadcast phase *and* a small camera-on Circle phase, or
   are camera-on sessions always small end-to-end? If a single session mixes a 200-person broadcast with an
   everyone-on-camera moment, the camera moment still can't include all 200 — clarify the intended choreography.

---

## Appendix — key files
- `src/app/session/[id]/page.tsx` — session room UI (listener + provider), mic plumbing already present.
- `src/app/api/scheduled-sessions/[id]/token/route.ts` — token mint + participant upsert; add speaker source-of-truth + voucher gate.
- `src/lib/livekit-server.ts` — `getRoomService()` (RoomServiceClient) + `createSessionToken`.
- `src/context/AudioContext.tsx` — separate global "beacon" room + local `<audio>` meditation (go2rtc removed); crossfader target (not the floor mechanic).
- `prisma/schema.prisma` — `ScheduledSession` (:235), `SessionInvite.canPublish` (:287), `SessionParticipant` (:304). New `AuditLog`/`Report` models exist but are unrelated to the floor mechanic.
- `src/lib/__tests__/livekit-server.test.ts` + `.../token/__tests__/route.test.ts` — test patterns to mirror.
