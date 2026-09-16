# Scene-capacity old-binary rollback barrier

This is the versioned, fail-closed, **read-only** compatibility barrier for an
application rollback after configurable scene capacity has been enabled.

## Schema compatibility

The forward migration is additive:

- `scheduled_sessions.max_publishers` is the historical fixed-six column. Its
  original `CHECK (max_publishers = 6)` constraint remains untouched so old
  binaries continue to read capacity `6`.
- `scheduled_sessions.scene_capacity` is the application source of truth. The
  Prisma field `ScheduledSession.maxPublishers` maps to this column, which is
  `NOT NULL`, defaults to `6`, and accepts only `6`, `9`, or `12`.
- Application rollback never drops or rewrites `scene_capacity`. Configured
  `9` and `12` values remain available for a later roll-forward.

Because the rollback barrier does not mutate capacity data, it runs for every
selected application rollback; no target-capability marker is required.

## Mandatory order

1. Fence new session entry using the release helper.
2. Stop both the app and commerce reconciler. Keep both writers stopped until
   the prior application and worker images are healthy.
3. Run the procedure from the candidate image, which owns the additive schema
   and the preflight script:

   ```sh
   npm run scene-capacity:rollback-preflight
   ```

   In the reviewed artifact rollback path, `hb-deploy-root artifact-rollback`
   runs the same command in the candidate `migrate` service after fencing and
   writer shutdown. It stores the JSON evidence as
   `scene-capacity-rollback.json` in the release transaction directory.
4. Continue only when the evidence is a closed
   `harmonic-beacon.scene-capacity-rollback-preflight.v2` object with:
   - `procedure: "scene-capacity-rollback-read-only-v2"`
   - `eligibleForOldBinaryRollback: true`
   - `verifiedUnsafeSessions: 0`
   - `legacyMaxPublishersVerified: true`
   - a non-negative `inspectedSessions` count
   - only bounded `9`/`12` entries in `nonSixConfiguredSessions`, each with at
     most six active publisher grants.
5. Start the prior binaries, verify health and exact image identity, and only
   then release the entry fence.

## Safety contract

In one serializable transaction, the procedure takes a bounded lock timeout,
locks both capacity/grant tables, row-locks every scheduled session, and reads
every session with its active publication-grant count. A grant is active only
when `publish_granted_at` is non-null and `publish_revoked_at` is null.

The barrier rejects the rollback when:

- **any** session has more than six active grants, whether its configured
  `scene_capacity` is `6`, `9`, or `12`;
- a persisted `scene_capacity` is outside `6`, `9`, or `12`; or
- any legacy `max_publishers` value is not exactly `6`.

The procedure performs no session update, participant update, audit insert,
demotion, revocation, or disconnection. Safe `scene_capacity` values `9` and
`12` are reported but persist unchanged. If the barrier refuses, keep the
candidate running (or keep writers quiesced), resolve the event operationally,
and retry only after the active grant count is naturally at most six. Failed,
missing, malformed, or stale evidence never authorizes rollback.
