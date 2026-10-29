# Room stability and local device checks

Sai requested this batch on October 29, 2026 after the October 28 encounter:
remove the listening explanation, address room movement and the entry error,
and implement the deferred microphone/camera/speaker check. Issue469 owns the
room outcome; issue126 retains its broader in-room switching/physical matrix.

## Behavior

- The room and waiting page no longer show “Cómo funciona la escucha”. Existing
  gain, device, hand, scene-exit and room-exit controls remain.
- The embedded operator room measures connected content after loading, rather
  than continuing to observe a detached loading element sized to its own iframe.
- The tapestry reserves its image area while frames decode and refresh. Raised
  hand overlays still require the matching composite/layout revision.
- An authenticated/DB-known event absent from the ephemeral compositor is an
  empty initial state. The composite returns204, and its Staff roster is empty.
  Missing DB events, permission failures and actual upstream failures retain
  their respective errors; the GET performs no registration or data writes.
- Presence keeps Serializable isolation and row locks. Only explicit PostgreSQL
  serialization rejection is replayed, with a bounded whole-transaction retry.
  Ambiguous commit/connection errors are never replayed. Older observations
  cannot move heartbeat timestamps backwards or reopen a newer closed interval.
  Exhaustion returns private503 with a bounded, non-identifying log category.
  Both direct COMMIT adapter errors and P2010-wrapped row-lock conflicts require
  the exact typed `TransactionWriteConflict` cause; arbitrary P2010 is not retried.
- Confirming a scene exit disables automatic tapestry capture before the server
  can deliver a permission change ahead of its HTTP response. Returning to the
  audience cannot start another camera request behind that exit gesture.

## Device check boundary

`/devices` is a separate **pre-meeting** surface, linked from the profile and
waiting room. It does not join a room or use room/device/media resources owned
by an active encounter. Inputs start only after their explicit buttons. The
microphone meter is local and has no speaker loopback. Camera preview is muted.
The test tone is a locally synthesized650ms WAV with a page-owned Blob URL. Output selection
appears only when the browser exposes `HTMLMediaElement.setSinkId`; other
browsers use system settings. No capture is recorded, uploaded or published.

Stop, continuation, hiding the page, pagehide and unmount release only the
check's own inputs, meter context and playback. Late permission results are
discarded and stopped. Device IDs stay in volatile page state. Values are not
written to a server or persistent browser storage.

This slice does not claim in-room microphone replacement, durable preferences,
Bluetooth/physical output acceptance or a physical iPhone/Android pass. Those
remain explicit issue126 requirements. No acoustic content, codec, media-server,
schema, Account provider, membership or production role change belongs to this
app-only batch.

## Evidence limits

The PostgreSQL test reproduces concurrent Serializable rejection before the
retry and converges five requests to one interval after it. It proves this
writer defect; missing request attribution means the38 log records observed
on October28 cannot all be assigned to this caller or a visible user failure.
Browser emulation proves lifecycle and geometry, not actual speaker audibility.
The row-update contention regression separately forces the presence snapshot to
wait on an uncommitted participant update and verifies convergence after its commit.
Deployment provenance and recovery belong in the single issue469 receipt.
