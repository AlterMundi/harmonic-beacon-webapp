# Owner-operated Live app delivery

This path updates only the app image while retaining the existing media staging
configuration. It is owner-operated as root, with no runner sudo grant. It does
not replace the original installed #590 helper or its recovery state.

Install the reviewed `hb-live-app-release.py` as
`/usr/local/sbin/hb-live-app-release`, and the matching
`hb-live-media-release.py` engine separately as
`/usr/local/libexec/harmonic-beacon/live-app-release-v1/hb-live-media-release.py`.
Files and ancestors must be root-owned and not group/world writable. Preserve
the original `/usr/local/sbin/hb-live-media-release-590` unchanged.

After qualifying the exact release source and inspecting the integrated diff,
build one candidate app image and retain its previous image. Verify source OCI
labels and unchanged worker/dependency/schema compatibility. Run doctor and
check the actual agenda, including events announced outside the database.
The owner writes `/etc/harmonic-beacon/live-app-release/permit.json` (root:root,
0600), with exactly these fields:

- `permitId`: a unique 64-character lowercase hexadecimal transaction identity;
- `sourceSha` and `priorSourceSha`: exact 40-character source revisions;
- `candidateImageId` and `priorImageId`: distinct full `sha256:` image IDs;
- `expiresAt`: timezone-qualified timestamp no more than 24 hours ahead.

The helper verifies image source labels, custody and the closed permit schema.
The transaction binds the exact wrapper, engine and permit bytes. Do not edit
any of those during a transaction: recovery requires the original bytes.
Retain each installed bundle and permit with its private recovery record before
preparing a later release. Never publish snapshots: they contain environment
values and Docker create intents.

Use `sudo /usr/local/sbin/hb-live-app-release <environment> <verb>`:

1. `staging prepare`, `staging apply`, `staging rollback` proves candidate and
   restoration on the existing media staging stack.
2. `staging prepare`, `staging apply` performs the separate forward rehearsal.
   Verify the affected user behavior on this exact candidate.
3. `production prepare`, `production apply` requires both staging records,
   their exact hashes and the currently healthy candidate in staging. New
   promotion is refused when a scheduled event is within 24 hours. Database
   and participant continuity checks remain active.
4. Read back public health/readiness, source/image identity and the affected
   behavior. Record the exact outcome and recovery target in #590.

`status` is read-only. `rollback` or `recover` restores the exact captured app
configuration and image. Expired permits or an event entering the future
window do not prevent recovery of an already-mutated transaction; real
activity continuity guards still apply. Failed apply attempts recovery.

The shared app bridge lock serializes operations. Only app is stopped/replaced;
media, database, worker, networks, mounts and runtime flags are retained. No
migration, pull or build is performed by the helper. This procedure does not
claim automated OCI delivery activation or qualify a different source.

An owner who explicitly accepts the interruption during a live test may add
`activeTestSessionId` (one exact UUID) to the private permit. This exception is
app-only: the selected session must have a title starting with `Test`, no other
session may be LIVE, and database, LiveKit, tapestry, playlist and worker container
identities must remain unchanged and running during the operation. It does not
waive staging rehearsal, exact image identity, rollback, or the future-event
window. Never infer this authorization from general host access. Existing permit
files without this field keep the normal no-live-session restriction.
