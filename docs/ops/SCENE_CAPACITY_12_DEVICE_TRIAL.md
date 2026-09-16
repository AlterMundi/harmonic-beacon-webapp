# Scene Capacity Qualification — 6 / 9 / 12 Publishers

This runbook qualifies the **small-group Stage scene** only. It does not qualify a broadcast with tens or hundreds of additional viewers.

## Product contract

- A scheduled session persists one scene capacity: `6`, `9`, or `12`.
- Existing sessions and new sessions default to `6` until an authorized system administrator changes them.
- Every active publication grant counts, including the assigned facilitator when the facilitator publishes.
- A reduction below active grants fails with HTTP `409`; nobody is disconnected and no grant is revoked implicitly.
- Each qualifying device must publish both microphone audio and camera video.

## Synthetic qualification

The dedicated harness creates one isolated Stage test room, no Beacon room, no mass audience, and no subscriber load. For each profile it creates exactly N distinct synthetic identities; every identity publishes both audio and video.

Dry-run the exact 12-publisher plan:

```bash
npm run load:scene-capacity -- \
  --profile scene-12 \
  --run-id scene-12-plan \
  --duration 90 \
  --dry-run \
  --manifest artifacts/load-test/scene-12-plan.json
```

Run against a remote rehearsal target only with a fresh explicit ownership nonce
and a confirmation bound to the resulting nonce-suffixed room:

```bash
LIVEKIT_URL=wss://rehearsal.example.invalid \
LIVEKIT_INTERNAL_URL=https://rehearsal.example.invalid \
LIVEKIT_API_KEY=... \
LIVEKIT_API_SECRET=... \
npm run load:scene-capacity -- \
  --profile scene-12 \
  --run-id scene-12-QUALIFIER \
  --ownership-nonce 11111111-1111-4111-8111-111111111111 \
  --duration 90 \
  --allow-remote \
  --confirm-test-room 'LOADTEST:rehearsal.example.invalid:rehearsal.example.invalid:hb-load-scene-scene-12-qualifier-12-11111111111141118111111111111111' \
  --manifest artifacts/load-test/scene-12-qualifier.json
```

Generate a new UUID for every real run; the fixed UUID above is documentation
only. The harness configures the owned room with 60-second LiveKit empty and
departure timeouts. It never calls LiveKit's name-only `deleteRoom`: after the
load exits, the now-empty room is retained for bounded server-side expiration,
so a same-name replacement cannot be deleted by a cleanup race.

A valid manifest must report:

- `status: PASS`;
- one simultaneous observation whose identity set is exactly
  `hbscene-12_pub_0` through `hbscene-12_pub_11`, with exactly one microphone
  track and one camera track on every identity;
- `qualification.failures: []`;
- `cleanup.strategy: livekit-automatic-expiration`, with no explicit deletion,
  only after the run created and verified ownership of the exact
  `hb-load-scene-*` room.

Both `LIVEKIT_URL` and `LIVEKIT_INTERNAL_URL` are independently validated. If
either endpoint is remote, the confirmation binds both endpoint hosts and the
room. The child process receives only the CLI path plus the three required
LiveKit values; manifest output is redacted and serialization fails closed if
the API key or secret appears.

Synthetic proof does **not** replace the physical-device trial.

## Physical-device trial checklist

### Preconditions

- [ ] Julián (or the designated facilitator) and the device team are present.
- [ ] Twelve distinct physical devices are numbered `D01` through `D12`.
- [ ] The marked rehearsal session is not a production event and has no mass audience.
- [ ] Rollback target is known: set the session back to `6`; no host rollback is needed for a session-setting rollback.
- [ ] Operator cockpit, public Stage UI, `/api/ops/health`, and LiveKit room telemetry are visible.
- [ ] Each device has granted microphone and camera permission.

### Device evidence table

Complete one row per distinct device. Never copy evidence between rows.

| Device | Hardware / OS | Browser + version | Network path | Mic track | Camera track | Reconnect result | Notes |
|---|---|---|---|---|---|---|---|
| D01 | | | | | | | |
| D02 | | | | | | | |
| D03 | | | | | | | |
| D04 | | | | | | | |
| D05 | | | | | | | |
| D06 | | | | | | | |
| D07 | | | | | | | |
| D08 | | | | | | | |
| D09 | | | | | | | |
| D10 | | | | | | | |
| D11 | | | | | | | |
| D12 | | | | | | | |

### Sequence

#### Capacity 6

- [ ] Authorized control shows `6` and persists after a cockpit refresh.
- [ ] D01–D06 join and each publishes one microphone and one camera track.
- [ ] Server telemetry shows 6 participants/publishers, 6 audio tracks, and 6 video tracks.
- [ ] UI shows six live tiles and the operator count agrees with the server.
- [ ] A seventh promotion is refused without revoking or disconnecting anyone.
- [ ] Attempting to set an unsupported value is refused.

#### Capacity 9

- [ ] Change the same session to `9`; record actor and timestamp from the audit log.
- [ ] D01–D09 publish audio and video simultaneously.
- [ ] Server telemetry shows 9/9/9/9 and UI/operator counts agree.
- [ ] Refresh and rejoin one device; capacity remains `9` and the reconnect restores both tracks.
- [ ] Attempt to reduce to `6` while more than six grants are active; confirm HTTP `409`, unchanged capacity, and zero forced disconnects.

#### Capacity 12

- [ ] Change the same session to `12`; record actor and timestamp from the audit log.
- [ ] D01–D12 publish audio and video simultaneously.
- [ ] Server telemetry shows 12 participants/publishers, 12 audio tracks, and 12 video tracks.
- [ ] UI shows twelve identities without hidden overflow; desktop, tablet, and mobile layouts remain legible.
- [ ] Reconnect at least one device from each represented network/browser family.
- [ ] Confirm health remains green and record any publish, decode, permission, or reconnection failure.

### Evidence and acceptance

Record:

- session ID and scheduled event ID;
- build commit / deployed artifact digest;
- start/end UTC timestamps;
- screenshots or exported telemetry for each 6/9/12 checkpoint;
- the completed device table;
- all publication/reconnection failures, including recoveries;
- rollback result after returning the rehearsal session to `6`;
- Julián’s exact acceptance or rejection statement, with timestamp.

Do not infer or pre-fill Julián’s acceptance. If the team or twelve devices are unavailable, leave this section explicitly **PENDING — HUMAN/PHYSICAL DEPENDENCY**.
