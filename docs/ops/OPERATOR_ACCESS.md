# Non-browser Live operator access

A human may authorize a dedicated machine administrator for Live. This is
separate from human Beacon Account sign-in and grants no authority over
Account, Listen, DNS, real payments or other independently owned services.
Machine ADMIN operations use the existing `/api/ops` routes, their normal
policies and audit actor. Media joining/publication remains the ordinary room
entitlement flow; this credential is not an attendee or facilitator identity.

## Credential and authority

[Full platform delegation](OPERATOR_DELEGATION.md) is separate from this bounded
Staff/API route. Sai/Eko have explicit host/repository operating authority;
CompAII need not provision each release or authorize each recovery.

`operator-credentials.ts` reuses `User` and `WebSession`: a dedicated machine
User with an unusable local-password marker, no StaffAccountBinding, a reserved
local issuer/subject, and a random 256-bit Bearer credential stored only as a
SHA-256 digest in the database. Existing Account validation is unchanged.
Machine credentials cannot authenticate as cookies, and invalid Authorization
never falls back to a human cookie. Current role, expiry, revocation and disabled
user are checked for every API request. Default lifetime is 24 hours; the root
issuer caps it at 30 days. Issuance and revocation have dedicated audit entries;
normal domain mutations retain their existing audited actor. Disabling the
machine user invalidates every credential on its next request.

Only root can provision/revoke through the supported local helper. The human
must authorize that identity and the actual operation. Shell access alone is not
permission. Never create a credential on an existing human account or borrow
someone else's browser session, cookie or password.

## Reviewed execution artifact

Use a clean exact source checkout, focused auth/lifecycle/custody tests and owner
review. Build one CommonJS operator artifact, with local source bundled and npm
packages external, using the existing esbuild dependency:

```bash
node_modules/.bin/esbuild scripts/beacon-operator.ts --bundle --platform=node \
  --target=node22 --format=cjs --packages=external --outfile=beacon-operator.cjs
sha256sum beacon-operator.cjs
```

Install the reviewed `deploy/hb-operator-root.py` as
`/usr/local/sbin/hb-operator` and the bundle as
`/usr/local/libexec/harmonic-beacon/operator/beacon-operator.cjs`, root-owned and
not writable by group/others. The root-only `manifest.json` alongside the bundle
has exactly `bundleSha256`, `sourceSha` (the CLI source revision), and
`compatibleRuntimeShas` (explicitly reviewed application revisions).

The source revision and runtime revision are separate evidence. Before admitting
an older runtime for bootstrap, verify that the CLI's lifecycle, termination,
permission, presence and database module closure is identical to that runtime,
and that its npm dependency closure is compatible. Do not claim the new CLI is
already present in the old application image. Preserve the installed bundle,
manifest and helper with the operation receipt.

The helper independently resolves `beacon-app` or `hb-live-staging-app`, its
running image ID and baked runtime revision; the request cannot select its own
container, image, network or environment. A fresh short-lived container uses
that exact image, a read-only root filesystem, no capabilities, no-new-privileges,
bounded resources, the selected runtime's network namespace and a minimal
allowlist of DB/LiveKit settings. The reviewed CLI/request/credential input mount
is read-only; only a new root-private result directory is writable. Never run
root tsx inside the writable application container: application-owned code could
have been changed there. No additional daemon, listener or background service is
installed. The existing app bridge lock excludes concurrent environment changes.

## Requests and receipts

Create root-owned mode-0700 `/etc/harmonic-beacon/operator/{production,staging}`
and mode-0600 `request.json` inside the selected environment. The JSON always
includes `environment`, `expectedSourceSha` (the currently running app revision)
and `operation`. Call `sudo /usr/local/sbin/hb-operator production` or `staging`.
No secret values go into argv, environment additions, logs or GitHub records.

- `provision`: add the authorized operator `email`, `name` and optional
  `ttlHours`. A new dedicated ADMIN is created, or an existing enabled machine
  ADMIN reused. The helper writes the secret to its root-only `credential` file
  and reports only operator/credential IDs and expiry. It refuses to overwrite an
  existing credential. Preserve/revoke the previous one before issuing another.
- `revoke`: supply the exact credential `sessionId`. Revocation is immediate on
  the next API request. Preserve the private file until its disposition is known.
- `request`: supply `method`, an existing `/api/ops/...` `apiPath`, and
  optional JSON `body`. The helper reads its own credential file. API response
  bodies stay in the root-private result directory; stdout reports HTTP status
  only. The reviewed child shares the exact selected app network namespace and
  sends to fixed loopback port 3000. Public ingress clears Authorization; local
  operation does not require changing that public boundary. Fixed public Host
  and Origin headers preserve the existing same-origin checks for Staff writes. Query and display only the fields relevant to the human's task.
- `close`: a bounded bootstrap for human-authorized closure of exact residual
  events before the new Bearer-capable app is deployed. Supply the dedicated
  operator `email`, up to ten exact `sessionIds`, and a printable non-PII `reason`
  of at most 240 characters. It loads the real enabled unbound machine ADMIN and
  calls `transitionScheduledSession` and `terminateSessionMedia`; it never issues
  SQL updates or opens an unheld event. Only LIVE closure or ENDED termination
  retry is allowed. Incomplete termination fails; retry does not reopen the event.

Read back the lifecycle audit, final status, termination result and LiveKit
room absence. A closed event removes one release blocker; it does not qualify a
release. Private receipts under `/var/lib/harmonic-beacon/operator/` bind CLI
source/digest, actual runtime image/source, environment, operation and run ID.
Credential output is moved into root custody; temporary credential inputs are
removed. Never publish these directories, request bodies or API responses.

## Additional operators

Keep each authorized operator's credential separate. The root helper accepts
`hb-operator ENVIRONMENT PROFILE`, where PROFILE is a lowercase slug. Its fixed
root-only input and credential directory is
`/etc/harmonic-beacon/operator/ENVIRONMENT/operators/PROFILE/`. Omitting PROFILE
retains the original single-operator directory; existing credentials are unchanged.
Provision and revoke through the same reviewed CLI. A dedicated `.invalid`
address may identify a machine account; it is not a mailbox or human login.

For an operator with a Unix SSH account, install `deploy/hb-operator-access.py`
as root-owned `/usr/local/sbin/hb-operator-access` and grant sudo only for its
exact `staging` and/or `production` invocations. A Staff-only appointment does
not grant Docker or general sudo; an explicitly appointed full platform operator
uses the separate delegation policy. Root owns a mode-0600 `access.json` next to the existing
operator configuration, mapping each Unix username to `{uid,operator,environments}`.
The broker verifies sudo's authenticated UID against this policy and never lets
the request select another operator, credential, output path or root operation.
It uses the installed helper and existing lock/read-only execution boundary.

Send a JSON request on stdin with `expectedSourceSha`, `method`, `apiPath`, and
optional `body`. Only existing `/api/ops` and `/api/admin` routes are admitted;
normal application authorization and audit apply. Responses retain the run ID
and HTTP status. JSON responses use `body`; other bounded bytes use `bodyBase64`
and `responseEncoding=base64`. An empty response has `body=null`. Never repeat a
write because output decoding or transport failed; inspect its original run first.

The receiving `scripts/beacon-staff-api.py` command reads only `sshTarget` from
`~/.config/harmonic-beacon/operator.json`, obtains the current public health SHA,
and invokes that exact broker. Example: `beacon-ops staging GET /api/ops/events`.
Supply JSON on stdin for writes. Tokens stay in root custody on the host.

A credential lasts at most 30 days. Root renewal uses the same operator profile:
revoke the exact previous credential, preserve its private file/receipt, then
issue a replacement. Removing the Unix policy/key prevents further host access;
revoke the machine credential too when withdrawing its application authority.

Staff API access is distinct from image delivery. Repository changes and GitHub
workflows retain each service's existing delivery lane. Private release permits,
exact image admission and recovery remain owned by the existing release helper;
this broker does not issue permits or grant arbitrary host execution. Qualify the
receiving operator with an isolated staging task and recovery before claiming
production delivery competence. Keep machine-specific routes in the receiver's
private binding, not in public documentation or the shared skill.

Before installing receiving tools, inspect both the harness PATH and existing
user installations such as `~/.local/bin`. A command missing from an Incus
non-login shell does not establish that the body lacks it. Reuse and test its
existing authenticated CLI before installing another copy or touching credentials.
Use explicit paths in the receiving binding when shell discovery differs.

### Exact existing-account facilitator role adjustment

The root-only `scripts/live-production/promote-event-manager.ts` remains separate
from delegated Staff API access. It requires an exact enabled canonical Account
issuer/subject, binding and staff user in its private request; it never creates or
rebinds identities. Default expected prior role is OPERATOR. An explicitly
authorized ADMIN-to-FACILITATOR_OP adjustment must additionally set
`previousRole: "ADMIN"` in that root-private request. The deployed policy gives
these two roles the same global staff capabilities, while FACILITATOR_OP alone
receives facilitator treatment on assigned events. No analytics grant changes.
Run the dry-run first and then `--apply` with the existing explicit opt-in.
The exact role transition and audit commit together under locked identity rows;
a mismatched prior role fails closed and replay creates no second audit. Retain
private before/after evidence and the public redacted receipt in the owning issue.
No deployment, restart, event creation or device-consent bypass is needed.

### Exact runtime operator generations

The root broker inspects the selected running app and its immutable image's baked
source before selecting executable bytes. An installed `runtimes/<source SHA40>`
generation must have an exact-source private manifest and verified bundle; malformed
or incomplete generations fail closed. Only an absent generation may use the
preserved legacy bundle's explicit compatibility list. Existing credential profiles,
normal API authorization/audit and the fixed environment boundary remain unchanged.

`hb-live-candidate` compiles the operator from its exact checked-out source through
the newly built immutable image, without production env, network or Docker socket.
The compiler has a90-second inner deadline,512MiB/one CPU/128PID limits and8MiB
file ceiling. Admission rechecks its retained digest and publishes an immutable
root-private generation under the existing app lock before rotating the app permit.
An existing differing generation is never overwritten. Compilation/admission failure
preserves the old permit and executable recovery generations.

Generations are bounded to64SHA namespaces, at most8MiB per bundle, with one fixed
pending publication slot. The ceiling stops admission visibly. Root retirement must
first prove a namespace is absent from every actual container and current/retained
recovery permit; preserve the legacy default and all referenced generations. Archive
and verify required recovery bytes before any deliberate retirement. This is an
explicit maintenance path, never automatic broad deletion. A pending slot after
host interruption requires inspection; a generation published before a later app
permit failure is safe to reuse only with matching verified bytes.
