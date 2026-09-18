# Genesis admission contract — hosted, inert Slice B seam

This slice does **not** install a host observer/profile/permit, execute recovery,
implement a root verb, produce a measured rehearsal, sign an authorization, or
change the promotion workflow. No Mona configuration is inferred from discovery.
Ordinary `delivery-authorization.v2` and the root dispatcher are unchanged.

## Trust boundary

`node scripts/ci/authorize-genesis.mjs` runs only in the future **hosted,
production-protected** job of `oci-promote.yml@refs/heads/main`. There are no CLI
arguments, path overrides, SQL, shell commands, or caller-selected execution
verbs. The output is canonical, unsigned `candidate/genesis-authorization.json`
(mode 0600, exclusive creation). The owning workflow must sign these exact bytes
using its existing delivery identity. An existing output is never overwritten.

Before invocation that workflow must independently resolve the successful exact
candidate artifact/run/attempt, protected main source/tree and required checks,
and complete protected production approval. This local CLI binds those trusted
job expectations; an environment variable is **not** proof of branch protection,
GitHub run success or approval. It must never be exposed as a signing endpoint to
an untrusted caller. Those resolver/approval/workflow integrations remain work.

The candidate's final manifest and qualification, all four image signatures,
SBOMs and provenance are verified with the existing artifact verifier and cosign
identity/issuer restrictions. Genesis and ordinary admission share existing
release content validation, not parallel PKI or copied validators. Ordinary
admission still rejects genesis as a dispatch target and requires a real base.

Downloads are bounded regular single-link files, copied into private temporary
snapshots before signature verification; parsing and validation use those same
snapshots. Symlinks, special files, substituted directories and extra artifact
evidence entries reject. This is unprivileged hosted staging, **not** the future
root descriptor-admission/ownership/ancestor-policy boundary.

## Inputs

Keep the existing real candidate artifact layout:

- `candidate/release-manifest.json` and its `release-manifest.signature.bundle.json`
- `candidate/qualification-receipt.json` and its signature bundle
- `candidate/evidence/oci-evidence-{app,tapestry,playlist-bot,analytics}/` with the
  existing closed six-file inventory
- `candidate/docker-compose.yml`, `candidate/deploy/oci-images.compose.yml`, and
  `candidate/deploy/runtime-public-config/{production,live-staging}.json`

Add only these inert admission inputs:

- `candidate/genesis/observation.json`: sanitized, **untrusted reported** observation
- `candidate/genesis/rehearsal.json` and `rehearsal.signature.bundle.json`: hosted
  delivery-identity-signed mechanics summary

Required trusted job environment:

- `GITHUB_REPOSITORY`, `GITHUB_REF`, `GITHUB_WORKFLOW_REF`, `GITHUB_EVENT_NAME`,
  `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`
- `SOURCE_SHA`, `SOURCE_TREE`, `CANDIDATE_RUN_ID`, `CANDIDATE_RUN_ATTEMPT`,
  `MANIFEST_SHA256`, `CONFIG_SHA256`
- `TARGET=production`, `ENVIRONMENT=production`,
  `OPERATION=genesis|genesis-recover|genesis-forward-repair`
- `GENESIS_ID`, `PERMIT_SHA256`, `PROFILE_SHA256`, `IMPLEMENTATION_SHA256`,
  `HARNESS_SHA256`, `LEGACY_OBSERVATION_SHA256`, `HOSTED_REHEARSAL_SHA256`

The workflow identity is fixed, repository is
`AlterMundi/harmonic-beacon-webapp`, ref is `refs/heads/main`, event is
`workflow_dispatch`. Initial adoption additionally requires candidate source SHA
to equal `GITHUB_SHA`. No attempt spelling is silently normalized (`01` and `1e0`
reject). Source/tree/run/attempt/config and all commitment expectations are exact.

## Wire contracts

`deploy/schemas/genesis-admission.schema.json` publishes three disjoint, recursively
closed variants. `scripts/ci/genesis-contract.mjs` enforces canonical exact bytes,
a 1 MiB contract limit, correlations and freshness beyond JSON Schema. Manifest
hashes, publication IDs and genesis IDs are lowercase bare 64-hex; other content
commitments use `sha256:`. Git identities are lowercase 40-hex.

### `harmonic-beacon.legacy-observation.v1`

The required plan fields are `schemaVersion`, `host`, `observedAt`,
`implementationSha256`, `profileSha256`, `gateState`, `services`,
`configCommitment`, `boundary`, `reportedAppGitSha`. Host is exactly Mona.
`gateState` contains `genesisId`, `permitSha256`, `ledgerSha256`, `publication`.
Publication is the existing closed `{generation,id,manifestSha256}` shape.
Only the initial form has **both** ledger and publication null; a missing field
is not null. Preliminary discovery with no installed profile/permit rejects.

Services are exactly app, commerce-reconciler, tapestry, playlist-bot, postgres
and livekit. Each has `containerId`, `configuredImage`, `imageId`, `platform`,
`composeProject`, `effectiveConfigSha256`, `sourceIdentity`,
`dependencyResolution`. Source identity is `{kind:"unknown"}`; an app health SHA
is separately reported and does not establish legacy provenance. First-party
dependency resolution is null. Postgres/LiveKit bind allowlisted `indexRef`,
`platformManifestDigest` and `imageId` (equal to the observed Docker ID); the
index must equal G's dependency pin. These reported fields do not prove Docker's
index-to-platform-to-image mapping: root must resolve it independently.

`configCommitment` commits to the private **stable entire runtime projection**,
not just public config: container/image identities, effective env, command,
entrypoint, mounts/modes/bind-file contents, networks/ports, restart/security and
resource settings. Its definition/extraction belongs to the reviewed observer
and fixed profile, which are not implemented here. Timestamps, uptime, heartbeat
counters and transient health are excluded from that preimage. Raw config,
inspect output, secrets and business data never belong in the exported object.
`boundary` separately reports passed readiness/private-boundary and zero live
DB sessions, real LiveKit participants and user audio tracks. Its freshness is
at most 15 minutes with no future timestamps. Root must remeasure these facts
and compare the private projection immediately before effects. **Signing the
report does not turn it into host attestation.**

### `harmonic-beacon.genesis-rehearsal.v1`

Scope is only `hosted-mechanics`, environment `shadow`, fixture kind
`synthetic-six-service`. Exact G source/tree/manifest/candidate run/attempt and
same delivery run/attempt are required, as are reviewed implementation/profile/
harness commitments. Ordered stages are `adopt` (legacy-shaped → genesis),
`recover` (genesis → legacy-shaped), `forward-repair` (legacy-shaped → genesis),
then successful `interrupted-adoption` failure recovery. Each records ordered
start/end times and command/output/runtime **receipt commitments**, not executable
instructions or raw secret-bearing outputs. All stages must succeed, issuance
must be after completion and not in the future; the measurement window is at
most one hour and issuance is at most 24 hours old.

These are authenticated summary commitments. The still-unimplemented measured
producer must capture and retain the actual command/output/runtime records,
validate their results, then sign this summary. This parser neither fabricates
nor executes those records, and does not claim to inspect their preimages. It
cannot establish Mona historical-image equivalence. Test fixtures are synthetic
contract data, never measured qualification receipts.

### `harmonic-beacon.genesis-authorization.v1`

Contains **all** plan §3.3 fields, without additional ambient context. It binds
the complete observation hash, stable private runtime commitment, installed
permit epoch/commitment, profile/implementation and signed rehearsal hash.
`genesis` requires null expected publication/ledger. Recovery and forward repair
require nonnull exact publication/ledger, with publication manifest equal to G
(no successor substitution). Root must compare current or archived publication
and ledger according to its phase; reported absence never proves absence.

Closed verb lists are inert permissions for the future root dispatcher:
`[prepare,apply,status,recover]` for adoption/forward repair and
`[prepare,recover,status]` for committed recovery. They do not execute anything.
Admission is at most 15 minutes, not future-dated, and is checked after expensive
signature verification. Initial adoption and forward repair require fresh G
qualification (existing maximum 24 hours). Committed recovery may authenticate
historical G, just as ordinary rollback authenticates historical prior content;
it still requires a fresh authorization/observation/rehearsal and exact existing
publication/ledger. It never renews G for new adoption or forward repair. No
future qualification is accepted. Durable continuation after authorization expiry
requires the future exact root transaction; this parser has no expiry bypass.

## Remaining integration and evidence limits

Remaining: workflow resolver/check/approval/signing jobs; measured isolated
Docker/PG/LiveKit harness; real observer/private projection; reviewed fixed Mona
profile and root-installed permit; secure root artifact admission; independent
installed commitment/runtime recomputation; durable intent/ledger/tombstone and
exact-retry recovery; Mona-isolated exact-image recovery proof; six-service
transition, initial absence-CAS publication and lane activation.

Local tests use genuine ephemeral Ed25519 signatures at an explicit `cosign`
executable double. They test actual CLI byte, identity and binding rejection but
are **not Fulcio/Rekor/OIDC authentication, hosted runtime evidence, approval,
installation, or deployment proof**. No private key is persisted by production
code, and no new signing infrastructure is added.
