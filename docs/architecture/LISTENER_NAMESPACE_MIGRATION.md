# EarlyBird to Listener namespace migration

Status: phases 1, 2A and the invitation-cookie phase 2B are integrated and
deployed on the isolated Listener at `20406da`. The Listener session-cookie
bridge (PR #249, head `b6fbac3`) is integrated via `f665f58` but NOT deployed;
its deploy, the session-cookie observation window and the dual-write support
window have not started. This migration is deliberately additive.
`EarlyBird` is an offer and cohort name; `Listener` is the durable product and
technical namespace.

## Invariants

- Existing `/early-birds` bookmarks, invitation links, sessions and clients keep
  working throughout the migration.
- A rollout never requires clearing cookies or local storage.
- New and legacy endpoints execute the same authorization and state-transition
  code. Aliases must not become a second implementation.
- Database and cross-repository contract changes are forward-only and are
  coordinated with `proyecciones-mito` before either side deploys them.
- No namespace phase changes codecs, media files, playback, gain, stream leases,
  payments, live-event routes or operator behavior.
- A compatibility alias is removed only after its usage has remained zero for a
  full support window and the removal has its own rollback plan.

## Inventory at `16a15d1`

The initial scan found 168 files containing EarlyBird naming: 82 under `src`, 18
under preview operations, 14 documentation files, 14 contract files, 10 scripts,
8 tools, 6 Prisma files, 5 services and 4 end-to-end files.

| Surface | Current identifiers | Migration constraint |
| --- | --- | --- |
| Public pages | `/early-birds`, `/early-birds/redeem` | Preserve both URLs while `/listener` becomes canonical. |
| Browser APIs | `/api/early-birds/*` | Add aliases first; move clients only after aliases ship. Stream and drop-in paths are audio-sensitive and stay unchanged in phase 1. |
| Authentication | `/api/early-birds/auth`, `hb_earlybird`, `hb_earlybird_session` | BetterAuth base paths and cookie prefixes cannot be renamed with a simple redirect. Requires a tested dual-session bridge. |
| Invitation cookie | `__Host-hb_early_bird_invitation` | Phase 2 emits canonical `__Host-hb_listener_invitation` first, reads canonical then legacy, and dual-writes/dual-clears during the rollback window so existing invitations and rollback images survive. |
| Browser storage | `hb_earlybird_device_id`, `hb_earlybird_drop_progress_*` | Dual-read legacy/canonical and canonical-write later. This is inside the player boundary and is not touched in phase 1. `hb_listener_playback_mode` is already canonical. |
| Environment | 34 explicit `EARLY_BIRDS_*` names plus language-specific drop-in keys | Add `BEACON_LISTENER_*`-first/legacy-fallback readers in bounded groups; never rename deployment configuration before the binary accepts both. |
| PostgreSQL | `early_bird_users`, identities, sessions, verifications, magic-link throttles, memberships, free schedules, welcome accesses and stream leases | Treat physical names as private persistence details during application cutover. Do not perform table renames with a web namespace rollout. |
| Cross-repo contracts | `early-bird-authority.v1`, `early-bird-membership.command.v1`, internal EarlyBird membership/invitation paths | Versioned public wire identifiers. Preserve byte-for-byte until both repositories agree on a new contract version. |
| Metrics/ops | Preview container, network, volume, nginx and script names use `earlybirds`; Listener presence is already canonical | Operational resource renames require side-by-side resources or a maintenance window. Labels should keep a stable legacy alias until dashboards and alerts move. |

## Phase 1: additive public routing

Implemented in this branch:

- `/listener` and `/listener/redeem` render the same server components and locale
  layout as their legacy counterparts.
- Canonical non-media API aliases exist for access state, free-window selection,
  free invitation redemption and welcome access.
- Invitation query tokens are scrubbed on both URL families. Only the canonical
  `listen.harmonicbeacon.com` host places one in the existing HttpOnly cookie;
  staging first redirects the bearer once to that host and cannot mint a
  staging-scoped cookie that would be lost during OAuth.
- `/early-birds` and every legacy API remain unchanged. Current clients continue
  using them, making rollback equivalent to removing the new aliases.

Phase 1 intentionally does not redirect `/early-birds`. Preview nginx currently
rewrites `/` internally to that route, and redirecting it before nginx and client
callbacks move would create unnecessary hops and could expose deployment
internals.

## Phase 2A: non-media browser and edge cutover

1. Deploy phase 1 and record requests by route family without user identifiers.
2. Change non-media fetches and navigation to `LISTENER_NAMESPACE.canonical`.
3. Make redemption and login callback responses return `/listener` while still
   accepting `/early-birds` callback URLs.
4. Update nginx to serve `/listener` at `/`; keep exact legacy locations proxied.
5. Add browser tests that start with a legacy invitation cookie, enter on the
   canonical URL, refresh and finish redemption without signing in again.

The phase 2A candidate changes only account-local access-state, Free-window,
welcome-access and invitation redemption. Better Auth continues to use its
legacy base path and cookies. The public `listen` edge exposes only the exact
canonical and compatibility invitation pages and POSTs; synthetic entry remains
staging only. Staging invitation pages and magic verification redirect through
exact unlogged locations to `listen`, while both staging redeem POST aliases
fail closed. Every non-Listener application host scrubs an invitation query but
never mints its cookie. Stream, heartbeat, manifest, drop-in and player storage
paths remain on their accepted legacy URLs.

Roll out the edge and application as a compatibility handoff, never as one
blind replacement:

1. install the additive exact nginx locations while `/` still rewrites to
   `/early-birds`, run `nginx -t`, reload and confirm legacy smoke;
2. deploy the application image containing both route families;
3. smoke `/listener` and every canonical non-media API directly;
4. change the internal `/` rewrite to `/listener`, run `nginx -t`, reload and
   verify that the browser-visible URL remains `/`;
5. retain legacy routes for the full measured support window.

Rollback reverses that order: restore the `/early-birds` root rewrite first,
then restore the previous image. The additive exact locations may remain dark;
no database, cookie, environment or media rollback is required.

Stream, heartbeat, manifest, drop-in and player storage paths are a separate
audio-reviewed slice. Their aliasing must not modify response bytes, timing,
cache headers, lease semantics or the playback controller.

## Phase 3: authentication and cookies

First introduce canonical invitation-cookie helpers that read canonical then
legacy, write both during the overlap, and clear both on redemption. After at
least one deployed support window, stop writing the legacy cookie but continue
reading it for another window.

The overlap is not retired by date alone. Keep dual-write for at least seven
consecutive days after every Listener instance runs the compatibility image,
one real Google invitation completes, rollback passes and no eligible rollback
image depends on legacy-only state. Then keep canonical-write/dual-read for a
second seven-day observation window with zero legacy-only/conflict observations
(record presence only, never cookie values). A legacy-only or conflict
observation resets that window. Remove the legacy read only afterward, and keep
dual-clear for one additional release. The invitation TTL remains 30 minutes;
the longer windows protect rollback and in-flight identity rather than extend
the bearer lifetime.

BetterAuth requires a separate design checkpoint. The canonical auth base path
must accept sessions issued with the legacy cookie prefix. The migration must be
proved with Google, Apple and magic-link callbacks, CSRF/origin checks, refresh,
logout and two concurrent devices before clients change their callback URL. Do
not run two independent auth stores or silently create a second account for the
same identity.

### Listener session-cookie bridge

The first step of that checkpoint ships as a strict wrapper around the single
Better Auth instance (`src/lib/listener/session-cookie-bridge.ts`). Better Auth
stays the sole session authority on the legacy base path; its signed cookie
value is opaque and its HMAC does not cover the cookie name, so the value is
portable verbatim under a second name. The bridge never parses, decodes,
re-signs or logs the value, and it never touches OAuth state, PKCE or any other
non-session cookie.

Outbound, every legacy session `Set-Cookie` Better Auth emits (mint, rotation,
clear) is mirrored onto the canonical name byte-identically, so sign-in,
refresh and sign-out always move both cookies together with one scope.
Ambiguous output (repeated same-name mutations, mismatched pairs, canonical
mutations without a legacy counterpart) is an internal failure: the response
is replaced by a generic 500 carrying no `Set-Cookie` at all.

Inbound, exactly three states may reach Better Auth:

1. no session cookie;
2. exactly one legacy-only session cookie (the rollback window);
3. exactly one canonical plus one legacy cookie with byte-identical values.

Everything else terminates with a generic 400/401 BEFORE Better Auth can mint,
rotate or clear anything: canonical-only (401), duplicate same-name cookies,
conflicting pairs, malformed percent encoding or control characters, oversized
values, and oversized Cookie headers (all 400). The generic body carries no
token or cookie detail and rejected values are never echoed.

Every rejection also expires BOTH exact session cookie names with `Max-Age=0`
and the scope Better Auth actually resolved (`Path=/`, `HttpOnly`,
`SameSite=Lax`, `Secure` when the resolved names carry the `__Secure-` prefix;
the scope is derived from `getCookies(auth.options)` and no `Domain` is ever
invented). This dual-clear is what keeps a deploy → rollback to `20406` →
redeploy sequence recoverable: the rollback image's sign-out clears only the
legacy name, so a stale canonical cookie would otherwise 401 forever, and an
old re-login can leave a stale canonical A plus a fresh legacy B that conflicts
with 400 — while every auth mutation that could repair the jar stops before
Better Auth. Expiring both names logs the client out but lets the next clean
sign-in mint a fresh dual pair. Direct `getSession` paths apply the same
inbound policy, fail closed to `null`, and cannot set response cookies.

Canonical-only acceptance is deliberately deferred until every rollback image
in the support window emits and accepts the canonical name; accepting it now
would let a rollback image silently strand the session it cannot read. The
401-plus-dual-clear state flips to accepted only after the dual-write bridge
has been the oldest supported rollback image for a full support window.

Browser-state matrix for the bridge image:

| Browser jar on request | Bridge response | Client outcome |
| --- | --- | --- |
| No session cookie | Forwarded | Sign-in/OAuth mints the exact dual pair. |
| Legacy only | Forwarded | Session valid; rotation and sign-out stay dual. Rollback-safe. |
| Canonical + legacy, identical | Forwarded | Session valid; both cookies move together. |
| Canonical only | 401 + dual expiry | Logged out; next clean sign-in recovers with a fresh dual pair. |
| Canonical A + legacy B (conflict) | 400 + dual expiry | Logged out; next clean sign-in recovers. |
| Duplicate of either name | 400 + dual expiry | Logged out; never silently selected first-wins. |
| Malformed, oversized value or header | 400 + dual expiry | Logged out; no downgrade to an adjacent valid cookie. |

Rollback of the bridge itself removes only the wrapper: the legacy-only path
is byte-identical to `20406`, no database, environment or cookie migration is
required, and canonical cookies left behind are expired by the dual-clear on
the next rejected request or sit harmlessly unread.

### Session-cookie compatibility observability

The bridge ships with an aggregate-only observation slice
(`src/lib/listener/session-cookie-observability.ts`) that sizes the
rollback-compatible support window. Both session resolvers — the auth-handler
bridge wrapper and `currentEarlyBirdSession` — inspect every inbound Cookie
header through the same pure `inspectListenerSessionCookie(header, names)`,
which returns `{ state, resolution }`; the enforced resolution is
byte-identical to the pre-observability bridge, and recording is fail-soft
inside try/catch so an observer failure can never change an auth outcome.

Metric contract (fixed, no external labels ever accepted):

- `beacon_listener_session_cookie_observations_total{state="..."}` — counter
  with exactly one label, `state`, over a closed allowlist of nine states;
- `beacon_listener_session_cookie_observer_process_start_time_seconds` —
  unlabeled gauge with the Unix epoch seconds at which this observer process
  created its registry.

Categories and classification precedence (first match wins):

1. `none` — no relevant session cookie (or no Cookie header at all);
2. `oversized_header` — the whole Cookie header exceeds 8192 characters;
3. `duplicate_name` — either relevant name appears more than once;
4. `oversized_value` — a relevant value exceeds 512 characters;
5. `malformed_value` — a relevant value is empty, off the wire charset or
   carries a bad percent escape;
6. `canonical_only` — a well-formed canonical cookie without its legacy
   counterpart (rejected 401 during this phase);
7. `conflicting_pair` — canonical and legacy values differ (rejected 400);
8. `legacy_only` — exactly one legacy cookie (forwarded; the rollback window);
9. `dual_identical` — a byte-identical canonical/legacy pair (forwarded).

Counters measure resolver INVOCATIONS, not unique users, browsers or
sessions: one navigation may invoke a resolver several times and one session
is observed on every request, so multiple observations per navigation are
expected. Recording is limited to the exact canonical Listener Host so
staging and synthetic rehearsals cannot contaminate the support-window
series. Even on that host these are raw cookie-shape observations before
cryptographic session verification: a public client can inflate them, so
they are conservative migration safety signals and must never automatically
permit or block a cutover without the correlated provider and rollback
evidence required above. The registry is per process/replica, resets on process restart and
saturates at `Number.MAX_SAFE_INTEGER`; the start-time gauge separates
epochs. A current zero therefore cannot prove seven quiet days: snapshots
must be archived externally per epoch, and any restart or gap without an
archived snapshot invalidates window continuity.

Privacy: only aggregate counts and the process-start epoch are stored or
rendered. No cookie, header, user, session, account, IP or user-agent value
ever reaches the registry or the exposition.

Loopback runbook: the exposition is served GET-only by
`/api/internal/v1/listener/session-cookie-observations`, which answers 404 on
any request Host other than the canonical Listener host (the request Host
header, never a forwarded one) and `Cache-Control: private, no-store`. The
public Listener nginx templates deliberately do not expose or proxy this
path; read it from the host with:

```sh
curl -fsS -H 'Host: listen.harmonicbeacon.com' \
  http://127.0.0.1:13000/api/internal/v1/listener/session-cookie-observations
```

This source slice neither connects Prometheus nor starts or certifies the
support window; scraping, alerting and window bookkeeping are private ops
wiring reserved for a later, separately authorized slice.

The accepted #210 policy remains in force: physical `early_bird_*` tables,
applied migrations and v1 cross-repository wire identifiers are historical
compatibility surfaces and must not be renamed, and the
canonical-only/basePath/prefix cutover stays gated by a deployed support
window, real Google and rollback acceptance, and the remaining callbacks.

## Phase 4: environment and operations

Introduce a typed resolver for each bounded environment group:

1. `BEACON_LISTENER_*` preferred, `EARLY_BIRDS_*` fallback;
2. fail readiness when both are set to different values for security-sensitive
   keys or origins;
3. emit only the selected key name, never its value, in validation output;
4. update staging configuration and validate; then update production separately;
5. remove fallback only after all rollback images use canonical names.

The first bounded slice covers identity and non-media access controls only:
public enablement, Free For All, auth base/trusted origins/secret, Google and
Apple credential pairs, the magic-link delivery trio, and synthetic staging
entry. Credential bundles must be complete within one generation and a dual
configuration must agree after normalization. Conflicts fail closed and error
messages contain variable names only. The deployed preview compose continues
to emit the legacy keys for the first support window, so its existing rollback
image remains valid. Authority, service credentials, stream, drop-ins and
device identifiers are explicitly deferred to separate reviewed slices.
The auth singleton reads configuration once; every env transition therefore
requires a Listener process restart and cannot be treated as a hot switch. The
readiness endpoint validates this bounded configuration before reporting green;
it reports only a generic public failure while the server diagnostic contains
variable names and never their values. Processes without Listener configuration
remain unaffected.

Operational resource names can remain legacy until replacements are created
side-by-side. Docker volumes and PostgreSQL identities must never be renamed as a
cosmetic cleanup. Dashboards should query canonical and legacy metric labels
during the overlap.

## Phase 5: persistence and wire contracts

Rename Prisma model symbols first while retaining `@@map("early_bird_...")` so
application terminology becomes canonical without moving data. Physical table
names are not a public product surface and should remain stable unless there is
a measured operational benefit.

If physical renames are eventually approved, use a dedicated forward-only
migration after every deployed binary targets the mapped Listener models. The
rollback is a roll-forward compatibility migration, not a down migration. Take a
verified backup, rehearse on a restored database, check locks and query plans,
and never combine the operation with an application or contract release.

Wire schema versions, idempotency-key prefixes and internal endpoint paths remain
unchanged in this project until `proyecciones-mito` and Beacon publish matching
v2 fixtures and validators. The safe sequence is accept v1+v2, emit v1, switch
emission to v2, observe, then retire v1 in a later release.

## Verification and rollback

Each phase must prove both namespaces, legacy session continuity, invalid-token
scrubbing, same-origin mutation behavior and absence of authorization drift.
Route-family counters must contain no account, email, invitation or session
material.

Phase 1 rollback removes only canonical pages/APIs and the two canonical
middleware matchers. It performs no database, cookie, environment, media or
contract rollback.
