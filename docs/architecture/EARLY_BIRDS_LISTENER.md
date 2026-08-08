# EarlyBird Listener

EarlyBird Listener is an isolated identity, membership and listening surface at `/early-birds`.
It does not authorize weekend-event tickets, staff tools, LiveKit rooms, chat, or Annie. The webapp
holds a fail-closed read projection; PMP Myth Bot (`proyecciones-mito`) remains the sole authority
for Free, PayPal and Mercado Pago membership state.

## Identity boundary

Better Auth uses dedicated `early_bird_*` tables and the `hb_earlybird_session` cookie. Public login
offers configured social providers plus an optional passwordless email fallback. Account linking,
implicit linking, unlinking and the account cookie are disabled. The adapter requires nullable OAuth token columns, but Better Auth database hooks scrub
access, refresh and ID tokens, token expiries and scope to `null` before create/update reaches Prisma.
Listener session hooks likewise discard IP address and user-agent values before
Prisma writes them. The test suite locks both pre-adapter invariants.

Required OAuth callbacks are:

- `https://listen.harmonicbeacon.com/api/early-birds/auth/callback/google`
- `https://listen.harmonicbeacon.com/api/early-birds/auth/callback/apple`

The staging callbacks with the same suffixes may be registered for isolated QA,
but the shared preview runtime uses `listen.harmonicbeacon.com` as its canonical
OAuth base URL. Provider credentials may remain unset during local testing; the
corresponding provider is absent from the public UI and auth runtime. Public nginx exposes this dedicated
auth namespace plus only the exact invitation entry/redeem routes. It continues
to block synthetic login and internal membership routes.

Browser-initiated auth mutations require an exact configured Listener
`Origin`. OAuth provider callbacks are the sole exception because Apple uses a
cross-site `form_post`; those callbacks are bound instead by Better Auth's
short-lived, one-use state cookie/database verifier and PKCE code verifier.
Unknown, expired or cookie-mismatched state fails before account or session
creation.

### Passwordless email fallback

The email fallback is an exact Better Auth `1.6.26` magic-link plugin and is
absent unless its private delivery URL, service token and independent HMAC rate
secret are all configured. Tokens are random, stored only as SHA-256
verifiers, expire after ten minutes and are atomically consumed on the first
verification attempt. Success, replay, expiry and alteration keep the same
isolated session boundary and fixed `/early-birds` callback allowlist.

Requests use a generic response regardless of account existence, throttling or
mail-provider uncertainty. Durable 15-minute buckets allow three requests per
normalized address and ten per Origin/network-address pair; only HMAC keys are
stored, never raw network addresses, and stale buckets are discarded after 24
hours. Better Auth additionally bounds the route
to three requests per minute per process/network source. A magic link may
create an email-only Listener, but both delivery and session creation reject an
address already owned by a Google, Apple or supervised credential identity.
Email equality therefore never silently adds a new way to authenticate an
existing account.

Mail crosses one versioned private boundary:
`POST /api/internal/v1/listener-magic-links/deliver`. The Listener sends the
recipient, locale, expiring URL and an opaque idempotency key under a dedicated
Bearer credential. The existing mail authority renders and sends the message;
its Gmail OAuth grant is never copied or mounted into the Listener. Until that
endpoint exists and the three Listener values are installed, the control and
auth plugin stay hidden and fail closed.

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

### Public invitation handoff

An invitation link is accepted only on `listen.harmonicbeacon.com` or the
isolated staging host. Staging carries the bearer in one unlogged,
no-store/no-referrer redirect to the canonical
`https://listen.harmonicbeacon.com/listener/redeem` page; it never mints an
invitation cookie. Middleware on `listen` immediately removes the signed bearer
query, dual-writes the canonical `__Host-hb_listener_invitation` and legacy
`__Host-hb_early_bird_invitation` cookies with the same 30-minute value, and
redirects to the clean URL. Both are host-only, Secure, HttpOnly, SameSite=Lax
and Path=/; neither the event host nor a forwarded-host header can mint them.
Readers require unambiguous same-name cookies, prefer the canonical generation
and accept legacy-only state only when canonical state is absent. Conflicting or
malformed overlap fails closed. Success and terminal rejection clear both;
transient 503 and pre-redemption authentication retain both for a safe retry.

Google and configured magic-link callbacks return to the exact
`/listener/redeem` allowlist. The cookie therefore survives an identity round
trip in the same browser without entering JavaScript, OAuth state or email.
Opening a magic link in another browser or device intentionally does not carry
the invitation; a future cross-device flow needs an authority-mediated claim
contract and must not place the invitation bearer in mail.

The browser redeem POST is exposed only at the canonical and compatibility
aliases on `listen`. It requires the exact Listener Host and same Origin, and
nginx bounds each address to 30 requests per minute with a 20-request burst so
a shared household/NAT cannot lock out independent one-use redemptions. Both
POST aliases fail closed with an unlogged 404 on staging. All
responses and exact edge locations are no-store and no-referrer. The exact
magic-link verification URL is excluded from HTTP and HTTPS access logs and
staging redirects it once to the canonical host, because its query carries the
one-use authentication token.

## Ordinary Free listening window

Registration does not fabricate a commerce membership. A signed-in account
without current canonical membership and without a previously selected Free
schedule may explicitly start one 30-minute first listen. Registration, OAuth
callback, page view, Free for All and canonical membership never create or
consume it. Its durable one-row marker is account-bound and cannot be reset by
retry, refresh or a second device; leases and manifests are capped at the exact
server-side end.

The same account may instead select one recurring local
wall-clock start and listen for two real hours each day. The first selection is
either **Listen free now**, derived from server time in the validated browser
IANA zone, or an explicit local time. The selection is account-bound and may be
changed again at or after `selected_at + 7 days`.

`early_bird_free_schedules` is a separate access layer from
`early_bird_membership_projections`. It stores only account ID, canonical IANA
zone, local start minute, selection/cooldown instants, idempotency request ID and
revision. It never writes provider, offer, price, Purchase or membership state.

Authorization resolves in this order:

1. a time-valid canonical membership grants its canonical boundary or anytime
   access;
2. otherwise the current recurring Free window grants access until its exact
   end;
3. otherwise an already-started first listen grants access until its exact
   30-minute end;
4. otherwise access fails closed.

Starting the first listen requires a same-origin authenticated idempotent POST.
It is available only before a recurring schedule exists. Selecting the schedule
first does not create or consume the first-listen row. The operational Free for
All override rejects first-listen activation, so public access never spends an
account's welcome session.

The server resolves wall-clock dates with `Intl` timezone data. A fall-back
ambiguity uses the first occurrence; a spring-forward nonexistent minute moves
to the first real local minute after it. Window duration is always 120 real
minutes. Stream leases, signed manifests and segment signatures are capped at
the resulting boundary. Changing an unlocked schedule evicts existing leases
so every device must reauthorize. Browser time is presentation/input only and
never authorizes a request.

The operator `EARLY_BIRDS_FREE_FOR_ALL=1` override remains route-level,
anonymous and independent. It creates neither a Free schedule nor membership.

The optional synthetic-login API creates a clearly marked, source-null local projection only when
both `EARLY_BIRDS_TEST_ACCESS_ENABLED=1` and a separate 32+ character secret are configured. Every
POST must present that secret as a Bearer token; absent/wrong credentials receive the same hidden
404. The route is not exposed by the UI or client bundle, cannot replace a canonical projection,
and must never be enabled on the customer-production hostname.

### Human-operated staging entry

An optional bilingual team form can expose that API on a dedicated staging hostname without putting
the Bearer code into HTML, JavaScript, `NEXT_PUBLIC_*`, storage, cookies or logs. A tester types a
name, an `@e2e.invalid` account and the separately shared temporary code. The component keeps the
code only in memory, sends it once as `Authorization: Bearer ...`, clears the field immediately and
sends only name/email in the JSON body.

The form and API fail closed unless every condition below is true:

- the runtime is a production build (`NODE_ENV=production`) served through HTTPS;
- `EARLY_BIRDS_ENABLED=1` and `EARLY_BIRDS_TEST_ACCESS_ENABLED=1`;
- `EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=1`;
- the request's exact `Host` is listed in `EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS`.

The host list accepts comma-separated `host` or `host:port` values only—no schemes, paths or
wildcards. The trusted staging reverse proxy must replace `X-Forwarded-Proto` with exactly `https`.
Missing, malformed, HTTP or non-allowlisted requests receive a non-descriptive 404 from the
synthetic-login endpoint and never reach Better Auth. Direct public Better Auth email sign-up/sign-in
routes are also hidden; only the authenticated staging endpoint can invoke that adapter internally.

This creates only an isolated EarlyBird account, Better Auth session and synthetic EarlyBird
membership projection. It grants no weekend-event principal, ticket, staff role, LiveKit capability,
chat capability or other event authorization. Keep both staging gates at `0` outside a supervised
test window and rotate the temporary code after the window.

## Stream and device leases

An entitled account may hold two active device leases. A third device evicts the oldest lease. The
browser plays a stable same-origin URL under `/api/early-birds/stream/manifest`; the route rechecks
the authenticated account, current membership and non-evicted lease before proxying a short-lived
origin manifest with `private, no-store` behavior.

The origin signature is HMAC-SHA-256 base64url over the exact bytes
`GET\n/v1/hls/{artifactId}/live.m3u8\n{unix_expiry}`. Expiry never exceeds the lease or ten minutes.
The origin manifest must contain individually signed, same-origin segment URLs. Signing material and
signed URLs are never returned in API JSON or logged.

Reviewed intro artifacts are configured as immutable, server-selected private files. Listener UI does not
encode or alter them and their progress is local to the browser. Before either intro can be selected, the
HLS source and lease are prepared without autoplay. One click then starts the intro and the already-attached
Beacon element together, keeping the shared timeline muted underneath. Pausing the intro produces silence;
its natural end reveals the still-running Beacon with a three-second element-volume fade where the browser
supports writable volume. iOS does not, so it receives a non-overlapping native unmute rather than a false
fade claim. Pause and Seek exist only for an active introduction; the Beacon is a live-edge source with
Stop, and a later Listen obtains the current edge rather than resuming stale media. No AudioContext,
LiveKit, chat or session-event behavior is changed, and the initial gain remains native 1.0.

## Dependency note

Better Auth is pinned to `1.6.26` and HLS.js to `1.6.17`. Better Auth's optional SvelteKit peer can
otherwise make npm select the Vite-8 Svelte plugin, which conflicts with this repository's Vite 7
test toolchain. The narrow `@sveltejs/vite-plugin-svelte: 6.2.4` override keeps that optional peer on
the Vite-7-compatible line; an ordinary clean `npm ci` succeeds without legacy-peer flags.
