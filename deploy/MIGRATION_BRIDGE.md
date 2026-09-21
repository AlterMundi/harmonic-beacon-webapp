# Candidate-pinned migration bridge v2

This is a bounded companion to the still-recoverable app-only v1 bridge. It
does not replace, finalize, or overwrite `/var/lib/harmonic-beacon/app-bridge`,
its permit, activation, state, image, or rollback authority. The two helpers
share the v1 operation lock so their mutations cannot overlap. V2 has its own
root at `/var/lib/harmonic-beacon/migration-bridge-v2` and configuration at
`/etc/harmonic-beacon/migration-bridge-v2`.

V2 accepts one reviewed release-first-parent archive, one exact set of additive
migration names and raw-byte SHA-256 values, exact current app/worker image IDs
and revisions, the exact already-present production PostgreSQL image ID, and
canonical production/rehearsal runtime profiles. It never
accepts a path, image, SQL statement, migration name, or environment override
from the unprivileged caller. It does not read or write OCI publication state.

### Historical migration evidence

Migration verification remains checksum-closed but does not pretend every
production row was created from today's file bytes. Two applied checksums are
accepted as explicit repository evidence only while each corresponding current
file retains its separately bound checksum:

- `20260728120000_weekend_mvp`: applied bytes `0ebfb48f…` from commit
  `29b0f567…`; current bytes `e654db87…` selected at merge `e6b70f15…`.
- `20260818030000_four_saturday_public_cycle`: applied bytes `eb2984af…`
  from commit `82f0b246…`; current fresh-bootstrap bytes `3418053a…` selected
  at merge `4d6d9095…`.

The full hashes and commits live in `src/lib/migration-history.ts`. The second
current file must remain intact because it creates `public_access` before the
later ensure migration references that column on a fresh database. Any other
checksum, migration name, or change to either current file rejects the alias.
The state report records every accepted historical match.

Prisma can retain an unsuccessful row after it is explicitly rolled back and
create a new row for a successful retry. Such rolled-back rows remain checksum
validated but are not effective applied, failed, duplicate, or conflicting
records. More than one non-rolled-back row, an unfinished non-rolled-back row,
or a row that is both finished and rolled back remains a hard failure. This
does not authorize ledger edits or `migrate resolve`; it only classifies the
records already present.

## Installation and authority

Install the reviewed helper, fixed Compose files, existing archive validator
and LiveKit probe, and canonical profiles as root-owned files. Preserve the v1
helper and its active state. The production profile must reflect the actual
reviewed flags; for the current Live contract both `promoInvitations` and
`tapestryPublic` are `true`. Profile hashes bind bytes and the helper maps both
booleans, origin and LiveKit endpoint into the app environment.

```bash
sudo install -d -o root -g root -m 0700 \
  /etc/harmonic-beacon/migration-bridge-v2 \
  /var/lib/harmonic-beacon/migration-bridge-v2/inbox \
  /usr/local/libexec/harmonic-beacon/runtime-public-config
sudo install -o root -g root -m 0755 deploy/hb-migration-bridge-root \
  /usr/local/sbin/hb-migration-bridge
sudo install -o root -g root -m 0644 deploy/hb-migration-bridge-production.compose.yml \
  /usr/local/libexec/harmonic-beacon/migration-bridge-production.compose.yml
sudo install -o root -g root -m 0644 deploy/hb-migration-bridge-rehearsal.compose.yml \
  /usr/local/libexec/harmonic-beacon/migration-bridge-rehearsal.compose.yml
sudo visudo -cf deploy/hb-migration-bridge.sudoers
sudo install -o root -g root -m 0440 deploy/hb-migration-bridge.sudoers \
  /etc/sudoers.d/hb-migration-bridge
```

Install `candidate.tar` and a completed closed permit mode `0600` only after
independently checking its source/tree, archive inventory, exact current app
and worker images/revisions, Compose/profile/helper digests, migration names
and `sha256sum prisma/migrations/*/migration.sql`. The source must be the final
release candidate, not an isolated main candidate that omits release history.

## Rehearsal and activation

`stage` never migrates the shared staging database. It takes a custom-format
snapshot of Live PostgreSQL, restores it under an isolated `hb_restore_stage_*`
database in a disposable PostgreSQL container on a dedicated internal Docker
network, proves the permit's exact pending migration inventory, migrates that
copy and starts candidate app/worker probes with no Account, commerce, PMP,
mail, public ingress, production database network, or production LiveKit
authority. `stage-rollback` runs
the exact current production app and worker against the migrated copy;
`stage-reapply` restores the exact candidate pair.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge stage
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge stage-rollback
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge stage-reapply
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge status
```

If `stage` is interrupted after its immutable candidate image and `staging`
state were persisted, `stage-resume` is the only reuse path. It accepts only
that same permit and phase, rechecks the copied archive, migration bytes,
candidate image labels and unchanged production app/worker endpoints, then
recreates the isolated restore and rehearsal without rebuilding the image.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge stage-resume
```

Record the external candidate acceptance as the root-owned rehearsal receipt,
then install a fresh, short-lived v2 activation binding its digest, candidate
image and both production base images. Repository tests prove the helper's
closed command and recovery boundaries only; they are not that receipt. The
receipt must come from the helper's real `stage`, `stage-rollback`, and
`stage-reapply` sequence on the candidate image and isolated restored Live
snapshot.

## Production apply and recovery

`apply` compares the exact app and worker endpoints, migration table and
rehearsal containers before mutation. It checks DB/LiveKit continuity, records
fence intent, fences new loopback app/LiveKit entry, stops app and worker,
repeats continuity, and creates a fresh root-only custom dump on the mounted
backup filesystem. It restores and migrates another isolated database, boots
the exact prior app and worker against it without production secret bundles or
external service networks, then binds that proof before the first production
migration write. It migrates forward, drains durable grant effects, replaces
app and worker with the one candidate image, verifies image IDs, readiness,
runtime profile, worker heartbeat and private boundary from inside the fence,
and only then removes the fence.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge apply
```

Failure cleanup and explicit `recover` accept only the permit-bound candidate
or prior app/worker endpoints. Once a production migration may have started,
the helper rereads real migration state and runs the durable-grant and scene
capacity rollback barriers when any permitted migration applied. It never
restores the Live database from the dump. It restores both exact prior binaries
against the forward schema and retains the fence if that cannot be proved.
Permit expiry does not disable bound rollback, recovery, or status.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge recover
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-migration-bridge rollback
```

Before a real operation, verify `/mnt/beacon-data` is a mounted filesystem with
capacity, PostgreSQL contains exactly the permitted pending migrations, the
v1/v2 shared lock is a secure root-owned regular file, no bridge command is in
flight, and both prior images remain available. Never overwrite either bridge's
state or use the backup as an automatic production rollback.
