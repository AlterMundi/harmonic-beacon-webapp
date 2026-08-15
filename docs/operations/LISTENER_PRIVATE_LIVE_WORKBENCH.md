# Private Listener Live checkout workbench

Status: implemented and deployed on the isolated staging runtime; gate OFF when
no supervised rehearsal is active.

This workbench exists only for one supervised real-provider acceptance on
`earlybirds-staging.harmonicbeacon.com`. It does not open checkout on
`listen.harmonicbeacon.com`, does not replace the ordinary staging Sandbox/TEST checkout and does
not touch event, LiveKit, playlist-bot, tapestry or audio services.

## Current dormant state — 2026-08-15

- Exact staging workbench image: `acc90ba35fea52f63ef18337e3a555ef637c552f`.
- Effective workbench gate: `0`; both public Live checkout flags: `0`.
- Authority global new sales: disabled.
- The former abandoned PayPal approval was retired after official provider 404
  evidence without a charge, subscription, Founder state or Purchase. There is
  no outstanding PayPal Live binding.
- Staging and canonical workbench POSTs both return `404`; staging home,
  health/readiness and canonical Listener remain healthy.
- The root-owned account/provider/CSRF configuration is retained at mode `0600`
  so a separately approved rehearsal can be started without copying secrets.
- Recreating this disposable port-13001 container did not restart the
  persistent Listener, event app, LiveKit, event workers or audio origin.

This dormant state is the required baseline before selecting either provider.
Do not turn the gate or authority new sales on merely to test route reachability.

## Boundary

- Exact browser endpoint: `POST /api/listener/checkout/live-workbench` on the staging host only.
- The endpoint is absent from the public Listener nginx vhost. A direct application request with
  the public or event Host returns `404` before authentication or authority access.
- The browser sends only a random attempt UUID and a short-lived session-bound CSRF proof. Account,
  email, provider, price, environment and callbacks are server-derived.
- One root-owned configuration selects exactly one opaque Listener account and one provider.
- Enabling either public Listener Live flag makes the workbench fail readiness and disappear.
- Normal `POST /api/listener/checkout` on staging continues using only PayPal Sandbox or Mercado
  Pago TEST according to its existing independent flags.

## Root-owned configuration

Keep values outside Git, shell history, process arguments and logs. Install the effective runtime
file as `root:root`, mode `0600`. Generate the CSRF secret from at least 32 random bytes; never reuse
an OAuth, authority or provider secret.

```text
BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED=0
BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID=<one opaque Listener account id>
BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER=<paypal or mercado_pago>
BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET=<dedicated random secret, at least 43 characters>

BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=0
BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED=0
```

The provider value is singular; comma-separated lists, `all`, whitespace, partial configuration
and mixed public/workbench activation all fail closed. The provider credentials remain only in the
canonical authority runtime; they are never copied into Listener configuration.

## Supervised acceptance sequence

1. Record exact Listener/authority images, health, readiness and the authority database backup.
   Reconcile pending provider intents for the selected account first; never create a second Live
   attempt while an earlier approval intent remains usable or unresolved.
2. Confirm both public Listener Live flags are `0`. Confirm public
   `POST /api/listener/checkout` still returns `404` while its Live flags are OFF.
3. Select one controlled opaque account and one provider in the root-owned workbench file. Keep the
   workbench gate `0` while validating ownership, mode and configuration names.
4. In the canonical authority, enable only the selected Live provider and its bounded new-sales
   gate. The other Live provider must be OFF. Signed webhook/reconciliation lifecycle stays active
   after new sales is closed.
5. Build the reviewed Listener commit as the exact local image
   `harmonic-beacon/earlybirds-preview-listener:<sha40>` with `BEACON_GIT_SHA=<sha40>`. Install the
   four workbench values in `/etc/harmonic-beacon/listener-live-workbench.env` as `root:root` mode
   `0600`; that fixed file may contain no other variables. Start only the disposable loopback
   workbench on port `13001`:

   ```bash
   LISTENER_UI_PREVIEW_FREE_FOR_ALL=0 \
   LISTENER_UI_PREVIEW_LIVE_WORKBENCH_ENABLED=1 \
   LISTENER_UI_PREVIEW_EXPECTED_SHA=<sha40> \
   scripts/listener-ui-preview.sh start
   ```

   The launcher refuses an absent/mismatched image revision, dev mode, FFA, Sandbox/TEST checkout,
   a non-root or non-`0600` secret file, ambiguous keys and every port except
   `127.0.0.1:13001`. It forces both auth-base aliases to staging and requires `/api/health` plus
   `/api/health/ready` before returning. It never recreates the persistent Listener on `13000`.
   Install the reviewed staging nginx template only after `nginx -t` is green; do not change any
   event vhost.
6. Sign in on the exact staging hostname as the allowlisted Listener account. The private Live card
   appears only for that session. Verify provider, USD 5/approved ARS offer and seller before the
   human confirms payment.
7. As soon as the provider approval URL has been created, turn authority new sales OFF. Keep the
   selected provider lifecycle/webhook/reconciliation flag ON until activation, cancellation and
   any supervised refund/terminal path are canonical and reconciled.
8. Verify canonical Founder projection, profile badge, unlimited access, provider event, metrics,
   alerts and logs without copying approval URLs, provider IDs, PII or secrets into public records.
9. Set the workbench gate back to `0`, recreate only staging Listener, and verify its exact route is
   `404`. Leave both public Listener Live flags OFF until the separate public-sales approval.

## Request checks

The application requires all of the following before contacting the authority:

- exact staging Host and HTTPS forwarded protocol;
- exact same-origin `Origin`;
- browser Fetch Metadata for a same-origin CORS fetch with empty destination;
- JSON content type and a bounded body;
- a valid Listener session for the one allowlisted account;
- a 15-minute HMAC CSRF proof bound to that account, session and server-selected provider;
- a body containing only one valid `attemptId`.

Changing provider/account in the body, replaying a proof in another session, using an expired proof,
using public/event hosts, or enabling a public Live flag all fail before checkout creation.

## Stop and recovery

- First set `BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED=0` and authority new sales OFF.
- Recreate only the isolated staging Listener. Keep provider webhooks, reconciliation and existing
  membership lifecycle running.
- If a Listener application fault remains, stop the staging workbench or roll forward. Do not roll
  back the canonical authority across a provider binding or adverse-event schema boundary.
- Never delete provider bindings, webhook events, jobs or membership projections as rollback.
- Verify normal staging Sandbox/TEST checkout and public Listener `404` independently after closure.
