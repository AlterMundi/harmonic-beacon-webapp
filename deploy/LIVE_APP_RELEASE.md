# Owner-operated Live app delivery

This path updates the app image while retaining the existing media staging
configuration. A closed optional permit can also update tapestry when its
dependency artifact is part of the same qualified change. It runs through the root-owned helper, with no runner sudo grant. It does
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

For an app+tapestry delivery, include all three additional fields:
`candidateTapestryImageId`, `priorTapestryImageId` (full distinct image IDs), and
`priorTapestrySourceSha`. The candidate tapestry image must carry the same source
revision as the app candidate. Partial fields, unknown services and combination
with the active-test exception are rejected. Rollback/forward proof binds the
complete selected image set; production rechecks every selected staging image.

## Build-context permissions

Keep release snapshots, permits and credentials root-private. The tracked Docker
build context must still have application-readable public assets: extracting a Git
archive under a restrictive root umask can leave nested public directories at
0700, which Docker preserves. Use 0755 for tracked context directories without
changing the private artifact parent, credential files or release snapshots.

Before staging, verify the exact candidate image as its configured application
user. Do not override that user with root:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --entrypoint node "$candidate_image" -e '
const fs = require("fs"), path = require("path");
if (process.getuid() === 0) throw Error("non-root application user required");
const root = "/app/public";
for (const name of fs.readdirSync(root, { recursive: true })) {
  fs.accessSync(path.join(root, name), fs.constants.R_OK);
}
console.log("public assets readable by application user");'
```

An unreadable asset rejects that image before replacement. Rebuild from the same
reviewed source with corrected context modes, retain the failed image and its
transaction evidence, and admit a fresh exact image permit after recovery.
Never edit an active transaction's helper or permit to substitute an image.

## Transaction and rehearsal

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

The shared app bridge lock serializes operations. Only the selected app and optional tapestry images are replaced;
LiveKit, playlist, database, worker, networks, mounts and runtime flags are retained. No
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

## Appointed Unix operators

Staff API authority does not include image delivery. For an operator appointed
by the human, install the exact command grant in
`deploy/hb-live-app-release.sudoers.example` as root-owned mode0440 and validate
it with `visudo -cf` before adoption. Add only that operator's existing Unix
account to the local `hb-live-operators` group. Reuse its existing SSH identity;
do not grant Docker access, a root shell, environment overrides, or write access
to helpers, permits, engine bundles or transaction evidence.

The ten explicit environment/verb invocations reuse the reviewed helper. They
allow preparing, applying, inspecting and recovering the current root-admitted
image set; they do not admit new image identities or build source. The root
custodian still qualifies/builds the source and admits its exact image permit.
An operator can execute the complete staging rollback/forward and production
transaction after admission. Record this distinction: command installation is
not independent build/admission capability or real receiving acceptance.

Before replacing a previous permit, hold the shared app-bridge operation lock,
preserve its exact bytes and engine/wrapper bundle with its recovery record,
and verify the previous transaction is terminal while still holding that lock.
Keep active and previous images independently retained. Never replace a permit
while another operator is preparing/applying/recovering its transaction. Current
status, image/provenance checks and activity controls remain mandatory. Removing
the group membership revokes this host delivery grant; it does not revoke the
separate Staff credential.

Build work uses a named host screen/tmux session, retained exit status and a
bounded log. Place its tracked context on the data filesystem. Retain source
identity, artifact digest and necessary recovery evidence, then remove the
disposable context/archive after successful image qualification. The existing
storage maintainer owns eligible image/cache retention; never prune required
rollback images to make capacity checks pass.

## Bounded operator build and admission

Install the reviewed `deploy/hb-live-candidate.py` as root-owned mode0755
`/usr/local/sbin/hb-live-candidate`. Create root-owned mode0700
`/mnt/beacon-data/builds/live-operator` and a root-owned mode0600 `build.lock`
inside it. Validate/adopt the same sudoers template above only for appointed
operators. Helpers, permits, logs and recovery snapshots remain root-private.

The additional exact helper supports `build SHA40`, `status SHA40` and
`admit SHA40`, plus `readback SHA40` for a bounded runtime/agenda snapshot.
The snapshot exposes only selected container/image/source identities, health and
non-PII scheduling counts; it contains no environment or raw diagnostics. It accepts only the current protected `release` head, a uniquely
merged PR and the successful GitHub Actions `delivery-gate-release` on that
PR's exact head. Admission additionally verifies the trusted gate workflow/event/base,
the actual current CI attempt and its GitHub Actions aggregate check, and equality
of the merged source tree with that qualified head. Fixed GitHub HTTPS reads and the fixed public repository fetch
independently verify caller-supplied identities. Neither caller paths, Docker
arguments, image files, source archives, environments nor arbitrary commands
are accepted. App-only compatibility rejects changed dependencies, migrations,
build/Compose definitions and media services. The two existing packaged operator
utilities (Staff API client and exact-account role adjustment, including its
test) may travel with a qualified app source; this never installs or executes
them on the host or changes their separate authority. Broader changes use their owning
reviewed adapters rather than weakening this restriction.

`build` starts a named finite host screen job and returns. GNU screen must
fork with `-dmS` before the launcher releases its build lock; the native launcher
regression exercises a real worker waiting on that lock. A launcher timeout
leaves pending evidence for inspection, never permission to retry automatically. `status` reports its
retained result; a pending result does not prove the job is running. An existing
source never starts another build automatically. The exact image is built from
a root-owned source, carries the source label and baked SHA, and passes a
non-root public-assets read before admission. `admit` requalifies the source,
holds the shared release lock, preserves the previous permit/bundle and prior
image independently, and writes the new closed23-hour image-pair permit. A
replay cannot renew or replace an existing admitted transaction. The result binds
the production image/source and verified migration coordinate; admission rejects
a changed base/schema under the release lock. If staging
currently runs a different pending release, recover it with its existing permit
before admission of the next source; never edit an active transaction.

Bounds: one active/pending build, three retained build records, one hour,20MiB
log,256MiB/10000 tracked source files,512MiB per Git output file,20GiB initial
root/data reserve and a10GiB build stop floor. Successful disposable source
contexts are removed; failed/uncertain contexts and logs remain for diagnosis.
The three-record ceiling stops additional accumulation. `retire SHA40` lets the appointed operator
retire only an unreferenced terminal build. It rejects current/admitted/prior
release sources, any source/image still referenced by a container, and pending
work. It preserves and verifies the result/log in a root-private archive before
removing only the derived source context/build directory. Six archives are kept;
current recovery sources remain protected. Images, permits, deployment snapshots
and application data are never removed. After diagnosing a terminal failed build,
explicit retirement followed by `build` supports a fresh attempt without
replaying uncertain work. A pending result cannot be retired: inspect the named
job and preserve uncertainty before recovery. Actual images and required recovery
bundles remain under their owning retention policy. To stop a stuck build, inspect its
exact named screen and Docker process first; stop only that task, retain its
unknown result and inspect state before any explicit retry. No timer, model
wakeup, root shell, runner activation or automatic production promotion is added.

Receiving sequence over the operator's existing SSH route:

```text
sudo -n /usr/local/sbin/hb-live-candidate readback SHA40
sudo -n /usr/local/sbin/hb-live-candidate build SHA40
sudo -n /usr/local/sbin/hb-live-candidate status SHA40
sudo -n /usr/local/sbin/hb-live-candidate admit SHA40
sudo -n /usr/local/sbin/hb-live-app-release staging prepare
sudo -n /usr/local/sbin/hb-live-app-release staging apply
sudo -n /usr/local/sbin/hb-live-app-release staging rollback
sudo -n /usr/local/sbin/hb-live-app-release staging prepare
sudo -n /usr/local/sbin/hb-live-app-release staging apply
```

Verify staging provenance and actual changed behavior. Confirm the live activity,
next event and externally announced24-hour window before production prepare/apply.
Read back public production health/readiness and exact image identity. An installed
grant is not acceptance: the receiving operator must exercise build, admission
and staging recovery using its own authenticated route before autonomous delivery
is claimed. Listen has a separate root-owner delivery path; this helper cannot
build/admit or replace Listen, Account, workers, media or databases.
