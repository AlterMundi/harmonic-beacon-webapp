# EarlyBird Listener

EarlyBird Listener is an isolated identity, membership and listening surface at `/early-birds`.
It does not authorize weekend-event tickets, staff tools, LiveKit rooms, chat, or Annie. The webapp
holds a fail-closed read projection; PMP Myth Bot (`proyecciones-mito`) remains the sole authority
for Free, PayPal and Mercado Pago membership state.

## Identity boundary

Better Auth uses dedicated `early_bird_*` tables and the `hb_earlybird_session` cookie. Public login
offers exactly Google and Apple. Account linking, implicit linking, unlinking and the account cookie
are disabled. The adapter requires nullable OAuth token columns, but Better Auth database hooks scrub
access, refresh and ID tokens, token expiries and scope to `null` before create/update reaches Prisma.
The test suite locks this pre-adapter invariant.

Required OAuth callbacks are:

- `https://<app-host>/api/early-birds/auth/callback/google`
- `https://<app-host>/api/early-birds/auth/callback/apple`

Production therefore needs the final HTTPS app hostname/DNS record before Google and Apple callback
registration. Provider credentials may remain unset during local testing; the corresponding button
is visibly disabled.

## Canonical membership boundary

Byte-exact copies live in `contracts/early-bird-authority/v1` and
`contracts/early-bird-membership/v1`. Verify them with `npm run contract:early-birds:verify`.

- Free redemption authenticates the EarlyBird session first and sends the opaque invitation only to
  `POST /api/internal/v1/early-bird-invitations/redeem` on the authority. Beacon never consumes or
  stores the invitation.
- The authority can push revisions to
  `PUT /api/internal/v1/early-bird-memberships/{account_id}`. Beacon requires rotating Bearer/key-id
  credentials and `Idempotency-Key: early-bird-membership:{account_id}:{membership_revision}`.
- Commands are hashed with SHA-256 over RFC 8785/JCS canonical JSON for exactly the twelve required
  fields. Higher revisions are `APPLIED`, byte-semantic repeats are `REPLAYED`, lower revisions are
  `STALE`, and equal revisions with different payloads conflict.
- `ACTIVE`, time-valid `GRACE`, and time-valid `CANCELLED_PENDING_END` allow access. Every missing,
  expired, revoked, refunded or unavailable state fails closed.

The optional synthetic login creates a clearly marked, source-null local projection only when both
`EARLY_BIRDS_TEST_ACCESS_ENABLED=1` and a separate test secret are configured. It cannot replace a
canonical projection and must never be enabled in production.

## Stream and device leases

An entitled account may hold two active device leases. A third device evicts the oldest lease. The
browser plays a stable same-origin URL under `/api/early-birds/stream/manifest`; the route rechecks
the authenticated account, current membership and non-evicted lease before proxying a short-lived
origin manifest with `private, no-store` behavior.

The origin signature is HMAC-SHA-256 base64url over the exact bytes
`GET\n/v1/hls/{artifactId}/live.m3u8\n{unix_expiry}`. Expiry never exceeds the lease or ten minutes.
The origin manifest must contain individually signed, same-origin segment URLs. Signing material and
signed URLs are never returned in API JSON or logged.

The approved Spanish/English drop-in renders are configured as immutable media URLs. Listener UI
does not encode or alter them. Progress is local to the browser. A drop-in mutes only the live output
while the HLS element, source and lease continue untouched, then restores the still-running Beacon.
The live pause control produces silence and its resume seeks to the current live edge. No AudioContext,
LiveKit, chat or session-event behavior is changed, and the initial gain remains the native 1.0.

## Dependency note

Better Auth is pinned to `1.6.26` and HLS.js to `1.6.17`. Better Auth's optional SvelteKit peer can
otherwise make npm select the Vite-8 Svelte plugin, which conflicts with this repository's Vite 7
test toolchain. The narrow `@sveltejs/vite-plugin-svelte: 6.2.4` override keeps that optional peer on
the Vite-7-compatible line; an ordinary clean `npm ci` succeeds without legacy-peer flags.
