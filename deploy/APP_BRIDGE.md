# Candidate-pinned Live app bridge

This is a deliberately narrow, temporary release path for an already reviewed
Live application candidate when the OCI host genesis is not ready. It does not
restore the legacy runner-workspace trust model. It builds from a copied,
digest-bound, root-owned archive, exercises that exact image in the existing
isolated Live staging app, and can then replace only the production application
container. It never migrates a database or replaces PostgreSQL, LiveKit,
playlist, tapestry, analytics, or the commerce reconciler.

The existing `hb-deploy`, deploy workflow, OCI helper, and lane selector are
unchanged. Installing this bridge, installing a permit, invoking a verb, and
reviewing the resulting evidence are separate operator decisions. A successful
source review or unit test is not staging, rollback, or production proof.

## Fixed authority boundary

The runner can invoke exactly `stage`, `apply`, `rollback`, or `status` without
arguments. It cannot select a candidate, archive, image, path, Compose file, or
environment. Root installs:

- `/usr/local/sbin/hb-app-bridge`, mode `0755`;
- `/usr/local/libexec/harmonic-beacon/hb-app-bridge-archive.py`, mode `0755`;
- `/usr/local/libexec/harmonic-beacon/hb-app-bridge-livekit.py`, mode `0755`;
- both `hb-app-bridge-*.compose.yml` files, mode `0644`;
- `/etc/harmonic-beacon/app-bridge/permit.json`, root-owned mode `0600`;
- `/var/lib/harmonic-beacon/app-bridge/inbox/candidate.tar`, root-owned mode
  `0600`;
- `deploy/hb-app-bridge.sudoers` after `visudo -cf` succeeds.

The permit is closed JSON. It binds the source revision/tree, deterministic
archive digest/size/entry count, fixed Compose bytes, build provenance, expiry,
and the exact currently deployed production image and revision. Obtain the
base image ID through a reviewed read-only diagnostic; never infer it from a
mutable tag.

## Preparing one permit

Use a clean checkout of the reviewed source. The archive may contain only
regular files and directories. Exclude the repository's two development-only
skill symlinks and reject any other non-regular tree entry:

```bash
git status --porcelain=v1
git ls-tree -r HEAD | awk '$1 != "100644" && $1 != "100755" && $1 != "120000" { exit 1 }'
test "$(git ls-tree -r HEAD | awk '$1 == "120000" { print $4 }')" = \
  "$(printf '%s\n' .claude/skills/neon .claude/skills/neon-postgres)"
git archive --format=tar --output=candidate.tar HEAD -- . \
  ':(exclude).claude/skills/neon' \
  ':(exclude).claude/skills/neon-postgres'
sha256sum candidate.tar deploy/hb-app-bridge-production.compose.yml \
  deploy/hb-app-bridge-staging.compose.yml \
  deploy/hb-app-bridge-archive.py deploy/hb-app-bridge-livekit.py
tar -tf candidate.tar | wc -l
git rev-parse HEAD HEAD^{tree}
```

An authorized host operator independently installs the reviewed bytes and
fills every placeholder in `hb-app-bridge-permit.example.json`. `permitId` is a
fresh random 256-bit lowercase hexadecimal value. Keep expiry short enough for
one coordinated window. Validate JSON and file ownership without displaying
environment files:

```bash
jq -e . permit.json >/dev/null
sudo install -d -o root -g root -m 0700 \
  /etc/harmonic-beacon/app-bridge \
  /var/lib/harmonic-beacon/app-bridge/inbox \
  /usr/local/libexec/harmonic-beacon
sudo install -o root -g root -m 0755 deploy/hb-app-bridge-root /usr/local/sbin/hb-app-bridge
sudo install -o root -g root -m 0755 deploy/hb-app-bridge-archive.py \
  /usr/local/libexec/harmonic-beacon/hb-app-bridge-archive.py
sudo install -o root -g root -m 0755 deploy/hb-app-bridge-livekit.py \
  /usr/local/libexec/harmonic-beacon/hb-app-bridge-livekit.py
sudo install -o root -g root -m 0644 deploy/hb-app-bridge-production.compose.yml \
  /usr/local/libexec/harmonic-beacon/app-bridge-production.compose.yml
sudo install -o root -g root -m 0644 deploy/hb-app-bridge-staging.compose.yml \
  /usr/local/libexec/harmonic-beacon/app-bridge-staging.compose.yml
sudo install -o root -g root -m 0600 candidate.tar \
  /var/lib/harmonic-beacon/app-bridge/inbox/candidate.tar
sudo install -o root -g root -m 0600 permit.json \
  /etc/harmonic-beacon/app-bridge/permit.json
sudo visudo -cf deploy/hb-app-bridge.sudoers
sudo install -o root -g root -m 0440 deploy/hb-app-bridge.sudoers \
  /etc/sudoers.d/hb-app-bridge
```

The helper copies the archive again into a new root transaction, rechecks its
size and digest, rejects links/special files/traversal/duplicates, and extracts
without overwrite. The Docker build receives an empty inherited environment
apart from fixed `PATH`; no Actions credential or application secret becomes a
build argument. It builds once and records the immutable image ID.

## Stage, apply, rollback

Before staging, independently verify that the candidate has no schema,
dependency-container, shared-service, worker-contract, or Compose transition.
This bridge does not prove that property automatically.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge stage
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge status
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge stage-rollback
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge stage-reapply
```

`stage` recreates only `hb-live-staging-app` on the existing isolated staging
networks. It neither starts nor migrates staging PostgreSQL. The exact image ID
built from the root-owned source is retained for production. Complete the
candidate's browser, Account, continuity, and rollback acceptance against
staging before proceeding. Live staging intentionally has no LiveKit service;
it proves application/identity/readiness and app-image rollback only. It does
not prove audio continuity.

After the successful stage rollback and reapply plus external acceptance, the
operator records a compact, non-secret rehearsal receipt at
`/var/lib/harmonic-beacon/app-bridge/staging-rehearsal.json` (root mode `0600`).
Install a fresh `hb-app-bridge.activation.v1` object only then. It binds the
permit, staged image, production base image, receipt digest, and a short expiry:

```bash
sha256sum /var/lib/harmonic-beacon/app-bridge/staging-rehearsal.json
sudo install -o root -g root -m 0600 activation.json \
  /etc/harmonic-beacon/app-bridge/activation.json
```

`apply` first proves staging still runs that image, compares production's
current image to the permit, and runs both the fixed read-only database query
and the admitted LiveKit room/participant continuity probe. The LiveKit probe
reuses the integrated release rule: only `playlist-bot` in the `beacon` room
may remain; any other participant or room presence fails closed. Any active
session or participant refuses the operation. It then recreates only `beacon-app`,
checks local exact-SHA health and the existing Account/commerce private
boundary, and automatically requests the prior app image if verification
fails. It performs no production migration or other service mutation.

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge apply
```

After apply, verify the public exact SHA/readiness and candidate behavior from
outside the host. The helper deliberately cannot claim those external checks.
Keep the prior immutable image and permit until the acceptance window closes.

`rollback` is allowed only from `applied`, only while production still runs the
candidate image, and restores only the permit-bound prior application image.
It repeats both continuity preflights, then rechecks exact prior provenance,
readiness, and the private boundary:

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge rollback
```

Permit expiry blocks a new `stage` or `apply`, but never blocks `status` or a
bound rollback of an already applied transaction.

If interruption leaves state at `applying`, or a failed automatic restore is
not positively verified, `recover` accepts only the candidate or prior image
CAS endpoint, repeats continuity checks, restores/verifies the prior image, and
records `recovered`. It never labels an ignored or failed restore successful:

```bash
sudo -u beacon-runner sudo -n /usr/local/sbin/hb-app-bridge recover
```

Do not install a second permit over an active transaction. Do not use this
bridge for migrations, worker/shared contracts, dependency or runtime Compose
changes, or during an active event. Those changes require their owning release
path. After acceptance, remove the sudoers fragment or leave it inert without
a valid unexpired permit; preserve the transaction as the deployment receipt.
