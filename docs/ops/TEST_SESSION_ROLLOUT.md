# Test-session visibility rollout and rollback

`ScheduledSession.isTest` is the only visibility source of truth. Runtime code
must never infer it from a title, description, room name, or ticket code.

## Rollout

1. Apply `20260801010000_scheduled_session_is_test`. It adds a non-null column
   with a `false` default, so existing application versions can keep running.
2. The migration marks only the two stable fixture UUIDs ending in `0101` and
   `0102` as tests. Review those rows before deployment; no title-based update
   is allowed.
3. Deploy the application and confirm the public landing query includes
   `isTest: false`, while staff see fixture events only inside the collapsed
   Test area of `/ops/events`.
4. Re-run the explicit production seed (`isTest: false`) or test fixture seed
   (`isTest: true`) as appropriate.

## Rollback

The additive column is safe to leave in place when rolling application code
back. Do not drop it during an event. If a fixture was classified incorrectly,
update that row by its reviewed UUID; never use a title pattern.
