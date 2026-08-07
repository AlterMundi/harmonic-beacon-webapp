# EarlyBird to Listener namespace migration

Status: phase 1 is integrated; phase 2A is an undeployed candidate on
`feat/listener-namespace-runtime`. This migration is deliberately additive.
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
| Invitation cookie | `__Host-hb_early_bird_invitation` | Phase 1 continues to read and write it from both URL namespaces, so existing invitations survive. |
| Browser storage | `hb_earlybird_device_id`, `hb_earlybird_drop_progress_*` | Dual-read legacy/canonical and canonical-write later. This is inside the player boundary and is not touched in phase 1. `hb_listener_playback_mode` is already canonical. |
| Environment | 34 explicit `EARLY_BIRDS_*` names plus language-specific drop-in keys | Add `LISTENER_*`-first/legacy-fallback readers in bounded groups; never rename deployment configuration before the binary accepts both. |
| PostgreSQL | `early_bird_users`, identities, sessions, verifications, magic-link throttles, memberships, free schedules, welcome accesses and stream leases | Treat physical names as private persistence details during application cutover. Do not perform table renames with a web namespace rollout. |
| Cross-repo contracts | `early-bird-authority.v1`, `early-bird-membership.command.v1`, internal EarlyBird membership/invitation paths | Versioned public wire identifiers. Preserve byte-for-byte until both repositories agree on a new contract version. |
| Metrics/ops | Preview container, network, volume, nginx and script names use `earlybirds`; Listener presence is already canonical | Operational resource renames require side-by-side resources or a maintenance window. Labels should keep a stable legacy alias until dashboards and alerts move. |

## Phase 1: additive public routing

Implemented in this branch:

- `/listener` and `/listener/redeem` render the same server components and locale
  layout as their legacy counterparts.
- Canonical non-media API aliases exist for access state, free-window selection,
  free invitation redemption and welcome access.
- Invitation query tokens are scrubbed on both URL families and placed in the
  existing HttpOnly cookie. The canonical route therefore accepts old cookies
  without copying sensitive values into JavaScript-visible storage.
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
welcome-access and staging invitation redemption. Better Auth continues to use
its legacy base path and cookies. The public edge continues to exclude
invitation redemption and synthetic entry; the staging edge exposes only the
four exact canonical non-media APIs. Stream, heartbeat, manifest, drop-in and
player storage paths remain on their accepted legacy URLs.

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

BetterAuth requires a separate design checkpoint. The canonical auth base path
must accept sessions issued with the legacy cookie prefix. The migration must be
proved with Google, Apple and magic-link callbacks, CSRF/origin checks, refresh,
logout and two concurrent devices before clients change their callback URL. Do
not run two independent auth stores or silently create a second account for the
same identity.

## Phase 4: environment and operations

Introduce a typed resolver for each bounded environment group:

1. `LISTENER_*` preferred, `EARLY_BIRDS_*` fallback;
2. fail startup when both are set to different values for security-sensitive
   keys or origins;
3. emit only the selected key name, never its value, in validation output;
4. update staging configuration and validate; then update production separately;
5. remove fallback only after all rollback images use canonical names.

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
