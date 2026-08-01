# Harmonic Beacon dramaturgical stage grammar

> **Status: Design contract — pending product validation and implementation.**
> This document describes the target composition for issue #72. It does not
> describe production behavior in `main` and it authorizes no audio or media
> topology change. **[Planned — weekend MVP follow-up]**

*Draft · 2026-07-31 · prototype against `6284b16` and PR #63 baseline*

## 1. Experience proposition

The stage is a scene held inside a room, not a presenter above an audience.
Composition communicates the current social shape before labels do:

- **solo** — one person holds the room;
- **dyad** — facilitator and protagonist meet with equal visual weight;
- **circle** — a protagonist is held by two or three other people;
- **chorus** — five or six people form one legible ensemble.

The tapestry is the collective ground under that scene. It signals that the
people on camera are held by a larger room without turning the audience into a
directory, feed, or control surface.

This is a prototype-first contract. Production `StageLayout`, `StageTile`,
`ThumbnailTapestry`, LiveKit behavior, and audio remain unchanged until the
composition is accepted.

## 2. What the current seam teaches us

`selectStageArrangement()` currently chooses one spotlight, then five narrow
auxiliaries. The same `spotlight` value controls all of these concerns:

1. which person is visually dominant;
2. which DOM tile moves to the large grid position;
3. which publication requests the 720p layer;
4. which person active-speaker detection currently favors.

That is internally coherent for a broadcast, but not for a psychodrama. In a
dyad, the active speaker should not alternately shrink the other person. In a
circle, speech should not reorder the people holding the scene. PR #63 already
protects stable React keys and avoids recreating video elements during a
spotlight change; the next policy should preserve that lifecycle work while
stopping layout changes in response to speech.

The new seam separates three outputs:

- `compositionRole`: spatial meaning (`protagonist`, `facilitator`, `holder`);
- `sceneOrder`: stable DOM and visual order;
- `qualityPriority`: the one publication that may request 720p.

Active speech may change `qualityPriority` and a non-layout speaking treatment.
It must not change `compositionRole` or `sceneOrder`.

## 3. Proposed pure policy

The implementation should introduce a pure policy above the existing
stage-layout seam. The names below are a proposed contract, not committed API.

```ts
type SceneKind = "empty" | "solo" | "dyad" | "circle" | "chorus";
type SceneRole = "protagonist" | "facilitator" | "holder";
type Presence = "connected" | "reconnecting" | "absent";

interface SceneMember extends StagePublisher {
  presence: Presence;
}

interface SceneOptions {
  protagonistIdentity?: string | null;
  activeSpeakerIdentity?: string | null;
}

interface ScenePlacement<T> {
  member: T;
  role: SceneRole;
  order: number;
  quality: "high" | "standard" | "none";
}

interface SceneComposition<T> {
  kind: SceneKind;
  placements: ScenePlacement<T>[];
  overflow: T[];
}
```

### 3.1 Deterministic selection rules

1. Collapse duplicate identities. The first canonical record wins, matching
   the current leak-prevention rule.
2. Reject publishers beyond the six-person server cap into `overflow`; never
   decode a seventh stream.
3. Sort the canonical scene roster once by durable `grantOrder`, breaking an
   exact tie with opaque `identity`. LiveKit arrival order is never an input.
4. Select the protagonist in this order:
   1. a valid operator-selected `protagonistIdentity`;
   2. the most recently granted non-facilitator;
   3. the assigned facilitator;
   4. the first stable roster member.
5. Select the facilitator by `isFacilitator`. There may be at most one assigned
   facilitator in the scene. If absent, no other person is relabelled as one.
6. Keep the protagonist first in semantic/DOM order. Put the facilitator next
   when distinct, then holders in stable grant order.
7. Choose the scene solely from canonical member count: 0 `empty`, 1 `solo`,
   2 `dyad`, 3–4 `circle`, 5–6 `chorus`.
8. Give 720p quality priority to the connected active speaker when valid;
   otherwise the connected protagonist; otherwise the first connected member.
   Every other connected camera remains at the intended 360p layer. Equal
   visual weight does not require an extra 720p decoder.
9. A camera-off or reconnecting member has `quality: "none"` and retains their
   placement. Media state never determines social rank.

This policy contains no clock, DOM, SDK object, viewport, or localization. A
caller supplies the roster and explicit reconnect state; CSS maps placements to
responsive geometry.

### 3.2 Pinned protagonist

“Pinned” means dramaturgically selected protagonist, not temporary visual
spotlight. It remains until the conductor explicitly chooses another person,
unpins, or removes that person from the durable stage grant.

All attendees must receive the same protagonist identity. A local operator
React state is therefore insufficient. Implementation needs one event-scoped,
durable source of truth delivered with the stage control state. Until that
exists, the layout may use the deterministic newest-non-facilitator fallback,
but the UI must not offer a pin control that only one browser can see.

If the protagonist disconnects while retaining a grant, keep their place as a
`reconnecting` presence card for a short, server-defined grace window. The pure
policy does not run that timer. Rejoining with the same event-scoped identity
reuses the same placement and DOM key. After the durable grant is removed, the
scene closes around the remaining people.

### 3.3 Stable identity and transition rules

- React keys are always event-scoped participant identities, never array
  indexes, roles, track SIDs, or grid positions.
- A tile stays under one list parent. Composition changes update data attributes
  and CSS grid areas; they do not render a second tile or detach the video.
- Active-speaker changes update only speaking state and requested simulcast
  quality. They never reorder DOM nodes.
- Promotion adds one new stable identity. If that person becomes protagonist,
  their keyed element may move to the first semantic/visual position; the
  relative order and elements of everyone already present remain stable.
  Demotion removes only that identity.
- A protagonist change changes roles/areas, not keys. A FLIP-style transform may
  interpolate the existing elements for 180–220 ms; no opacity crossfade may
  duplicate live video.
- Track replacement attaches the new track to the existing identity-owned video
  element and detaches only the obsolete track.
- Under `prefers-reduced-motion: reduce`, placements change instantly. Meaning
  is carried by position, outline, name, and the “protagonist” text alternative,
  never animation alone.

## 4. Responsive composition

The stage canvas uses the available inline size, with a maximum of 1184 px. The
room shell supplies 24 px side gutters on desktop, 12 px at 390 px, and 12 px at
320 px. Tiles preserve 16:9 media; camera-off cards use the same box.

| Viewport | Stage inline size | Gap | Name size | Collective-ground height |
|---:|---:|---:|---:|---:|
| 1440 | 1184 max | 16 | 14 | 124 |
| 1024 | 928 max | 14 | 13 | 112 |
| 390 | 366 | 8 | 12 | 76 |
| 320 | 296 | 8 | 12 | 68 |

### 4.1 Solo — one person holds the room

- **1440:** one 864 × 486 tile centered in the canvas.
- **1024:** one tile up to 800 × 450, centered.
- **390:** one 366 × 206 tile.
- **320:** one 296 × 167 tile.

The person may be facilitator or protagonist; the label names the actual role.
The empty space around the tile is intentional collective ground, not a missing
panel.

### 4.2 Dyad — facilitator and protagonist are co-equal

- **1440:** two equal 584 × 329 columns.
- **1024:** two equal 457 × 257 columns.
- **390:** two equal 366 × 206 rows.
- **320:** two equal 296 × 167 rows.

Neither tile grows when its person speaks. Protagonist is first in semantic
order; the facilitator is second. Equal dimensions, name treatment, border
weight, and baseline establish equality. A quiet gold protagonist marker and a
plain-language accessible label communicate role without making the
facilitator subordinate.

### 4.3 Circle — protagonist with two or three holders

At 1440 and 1024 the protagonist occupies a centered top row, 8 of 12 grid
columns. The two or three holders share an equal lower row. The geometry reads
as a held center rather than a lead video plus thumbnails.

- **1440:** protagonist about 784 × 441; holder tiles are at least 384 × 216.
- **1024:** protagonist about 614 × 345; holder tiles are at least 300 × 169.
- **390:** protagonist is 366 × 206; holders form two 179 × 101 columns. With
  three holders, the third is centered on the next row.
- **320:** protagonist is 296 × 167; holders form two 144 × 81 columns. This is
  the minimum supported tile; names remain 12 px and occupy a single line.

The facilitator is simply one holder if present. Their tile does not claim a
permanent corner or larger size.

### 4.4 Chorus — five or six people form an ensemble

- **1440:** a two-row, three-column equal grid; each tile about 384 × 216.
- **1024:** a two-row, three-column equal grid; each tile about 300 × 169.
- **390:** protagonist spans 366 × 206; the other members use two 179 × 101
  columns below.
- **320:** protagonist spans 296 × 167; the other members use two 144 × 81
  columns below.

On desktop, all six tiles are equal in size: protagonist is indicated by
placement order and a restrained outline, not broadcast-scale dominance. On a
phone the full-width protagonist gives the scene an anchor while the supporting
tiles retain the minimum legible width. No horizontally scrolling strip is
introduced.

### 4.5 Empty and audio-only states

With no stage members, show a centered sentence over the collective ground:
“The scene is opening” / “La escena se está abriendo”. Do not show an empty card
grid. In audio-only mode, keep the exact composition as presence cards and
remove all video elements/decoder requests according to the existing media
contract. This specification changes no audio connection, element, gain, or
lifecycle.

## 5. Camera-off and degraded media with dignity

A declined camera is participation, not failure.

- Keep the full tile geometry and actual name.
- Use a quiet, deterministic color field chosen from a four-token palette by
  opaque identity. Do not derive or display a profile photo, avatar, or public
  identifier.
- Show “Present without camera” / “Presente sin cámara”, not a red camera error.
- Show microphone-muted and reconnecting states as secondary text plus an icon;
  never color alone.
- “Connecting video” is reserved for a published camera whose track is not yet
  available. It must not be shown when a person declined video.
- Poor connection is primarily actionable to the affected person and staff.
  Audience treatment is the stable presence card, not an alarming health dot.
- Preserve the person’s tile during the reconnect grace interval. Announce the
  state once in a separate polite live region; do not cause the whole stage list
  to be re-announced on every quality update.

## 6. Tapestry as collective ground

### 6.1 Visual behavior

Render the existing bounded composite JPEG in a shallow band behind and below
the stage canvas. A gradient mask lets it meet the room background without a
new blur filter, shader, canvas animation, or generative layer. Stage tiles
remain opaque enough for names and faces to meet contrast targets.

Remove the implementation-facing heading “Tapestry”. When frames exist, the
accessible figure name is “The room, gathered” / “La sala, reunida”. When no
frames exist, a static gradient and truthful gathering copy replace the image;
no synthetic faces or false participant count appears.

The composite is never clickable, searchable, zoomable, or accompanied by a
public list of identities. Staff arrangement remains in the conductor cockpit
drawer, not beside service health.

### 6.2 Locating one’s own contribution without a directory

The current public JPEG contains no identity metadata, so the client cannot
truthfully identify the attendee’s cell. Implementation should add a minimal,
authenticated self-location sidecar rather than personalize or duplicate the
image:

```json
{
  "revision": "opaque-composite-revision",
  "columns": 12,
  "rows": 8,
  "self": { "column": 4, "row": 2 }
}
```

The public composite response carries the same opaque revision. Only when the
two revisions match does the client draw a non-interactive 2 px “You / Vos”
ring over the cell. The endpoint returns no participant ID, name, email, or
other cell positions. If revisions disagree, omit the ring rather than point at
someone else. This preserves one shared JPEG and its cache behavior.

This sidecar must be designed with the tapestry concurrency fix in #40: frame,
order, revision, composite, and self-position must describe one atomic
snapshot. It adds no capture, camera, LiveKit publication, or image stream.

### 6.3 Consent and lifecycle

- The collective ground uses only existing consented tapestry frames.
- Opt-out removes the attendee according to the existing expiry lifecycle; it
  does not affect room or stage admission.
- Promotion to stage stops the snapshot capture before stage camera use, as the
  current component intends.
- Hidden/disconnected/unmounted clients do not capture.
- Public-disabled mode renders no broken collective image and makes no claim
  that audience presence is visible.

## 7. Motion and interaction

Motion is an orientation aid, never ambience.

- New member: 160 ms opacity-in on the new tile only.
- Composition change: existing elements may translate to their new CSS grid
  areas over 180–220 ms using compositor transforms. No scale bounce.
- Speaking: a static/slow border intensity change, not pulsing size or layout.
- Tapestry refresh: replace the object URL without a flash; no crossfade that
  keeps two full JPEGs visible.
- Reduced motion: all durations are zero and no breathing/pulse animation runs.
- Keyboard focus never moves as a consequence of a composition change.

There are no attendee controls on the stage canvas. Staff protagonist selection
and tapestry arrangement belong to the cockpit drawer defined in #70.

## 8. Accessibility and localization contract

- Actual names are the primary visible and accessible labels. Role and media
  state follow as secondary information.
- Stage markup is one labelled list. Protagonist is first in semantic order;
  visual CSS order must match DOM order.
- The protagonist label is explicit to screen readers; speaking is not conveyed
  by color alone.
- Name text and camera-off copy meet 4.5:1 contrast. Non-text role/state outlines
  and focus indicators meet 3:1 against adjacent colors.
- No status text is smaller than 12 px at the 320 px target.
- Long names truncate visually to one line but remain complete in the accessible
  name and `title`-equivalent disclosure.
- ES and EN strings come from the typed locale catalog in #68. Do not render
  both languages simultaneously.
- The layout has no horizontal overflow at 320 CSS px and respects top/bottom
  safe-area insets.
- Screen-reader announcements are event based: joined scene, left scene,
  reconnecting, returned. Speaking and connection-quality polling are silent.

## 9. Media and CPU budget

This grammar must fit the proven weekend topology.

- At most six stage video elements and six LiveKit video subscriptions.
- Exactly one connected publication requests 1280 × 720; other visible cameras
  request at most 640 × 360. Camera-off/reconnecting/audio-only requests none.
- Active-speaker quality changes use the existing publication and element; they
  do not detach media or remount the room.
- One bounded tapestry JPEG replaces its prior object URL no more often than the
  current two-second public polling cadence. The old URL is revoked.
- No WebGL, shader, backdrop filter, live blur, participant-side generative
  rendering, second canvas loop, or new camera/LiveKit stream.
- Composition effects use opacity and transform only. No animated grid size,
  box-shadow pulse, or filter over live video.
- In a one-minute six-camera test, the new visual composition should add less
  than 5 percentage points median renderer CPU over the current stage on the
  same device/browser. No composition-triggered task may exceed 50 ms after
  initial mount.

## 10. Measured acceptance matrix

Implementation does not pass on appearance alone.

### 10.1 Pure policy tests

- Counts 0–6 map to `empty`, `solo`, `dyad`, `circle`, `chorus` exactly.
- Duplicate identities collapse and seventh/eighth publishers remain overflow.
- Input permutations return the same scene order when grant order is unchanged.
- Active-speaker changes never change composition role or order.
- Valid protagonist pin wins; stale pin falls back; unpin is deterministic.
- Facilitator is a co-equal dyad member and a normal holder in a circle.
- Camera, mic, and connection changes do not move a person.
- Only one connected camera gets high quality; camera-off gets none.

### 10.2 Layout/golden tests

Capture all 28 count/viewport pairs: 0–6 members at 1440, 1024, 390, and 320.
For every capture assert:

- no horizontal overflow and no overlap;
- visible names and at least 12 px status text;
- exact equal-area dyad within 1 CSS px;
- protagonist/holder minimum dimensions from §4;
- no tile outside the stage canvas or hidden behind controls;
- camera-off and reconnecting preserve the same geometry;
- reduced-motion screenshot carries the same role meaning.

### 10.3 DOM/media continuity tests

- Save each identity’s `HTMLVideoElement`, change active speaker, protagonist,
  count, and viewport, then assert the element object remains identical.
- A role/layout change makes zero `detach()` calls.
- Promotion creates one element and one attach for the new identity only.
- Demotion detaches/removes only that identity.
- Reconnect track replacement never leaves two video elements or an obsolete
  track attached.
- Audio-only creates no video elements and preserves presence/name ordering.
- Tapestry refresh revokes the previous object URL and leaves one image.

### 10.4 Human review

At all four widths, reviewers should be able to answer within five seconds:

1. Who is the protagonist?
2. Who is holding the scene with them?
3. Is someone present without camera versus still connecting?
4. Is the larger room present without exposing who is in it?

The #64 rubric must score at least 2/3 in Arc, Attention, Truth, Continuity,
Recoverability, Reach, and Register. Any lower score blocks implementation
acceptance.

## 11. Prototype

Open [`STAGE_GRAMMAR_PROTOTYPE.html`](./STAGE_GRAMMAR_PROTOTYPE.html) directly in
a browser. It is dependency-free and contains deterministic fixtures for all
four scene kinds, exact 1440/1024/390/320 review frames, camera-off and
reconnecting states, collective ground, and a reduced-motion toggle.

The prototype deliberately uses abstract color fields instead of photographs.
It tests hierarchy, labels, density, and responsive geometry without implying
that generated people or a new media source belong in the product.

## 12. Open product decisions before implementation

1. **Who may select the protagonist?** Proposed: assigned facilitator,
   `FACILITATOR_OP`, operator, and admin with event-operation capability; all
   changes audited. Product must confirm whether ordinary operators should have
   dramaturgical authority or only technical control.
2. **Where is protagonist state persisted?** It must be event-scoped and shared.
   Confirm a small durable session field/state endpoint rather than LiveKit
   participant metadata or browser-local state.
3. **Reconnect grace duration.** Product/ops should choose the duration from a
   rehearsal; this contract recommends 15 seconds as a starting hypothesis,
   not a shipped number.
4. **Self-location sidecar and public caching.** Confirm the revision/geometry
   approach with #40 before implementation. If atomic consistency cannot be
   guaranteed before the event, omit the “You / Vos” marker; never guess.
5. **Solo fallback.** When only a non-facilitator remains connected, should the
   solo scene hold that participant or wait for the facilitator? The proposed
   policy truthfully holds whoever still has a durable grant.

None of these decisions requires or permits changing codec, bitrate, sample
rate, buffer, gain, crossfader, audio elements, or audio lifecycle.
