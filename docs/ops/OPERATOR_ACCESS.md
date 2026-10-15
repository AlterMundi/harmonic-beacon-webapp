# Non-browser Live operator access

A human may authorize a dedicated machine administrator for Live. This is
separate from human Beacon Account sign-in and grants no authority over
Account, Listen, DNS, real payments or other independently owned services.
Machine ADMIN operations use the normal `/api/ops` and legacy `/api/admin`
policies and audit actor. Media joining/publication remains the ordinary room
entitlement flow; this credential is not an attendee or facilitator identity.

## Credential and authority

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
- `request`: supply `method`, an `/api/ops/...` or `/api/admin/...` `apiPath`, and
  optional JSON `body`. The helper reads its own credential file. API response
  bodies stay in the root-private result directory; stdout reports HTTP status
  only. Query and display only the fields relevant to the human's task.
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
