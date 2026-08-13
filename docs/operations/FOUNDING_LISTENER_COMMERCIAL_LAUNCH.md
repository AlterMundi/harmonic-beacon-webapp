# Founding Listener commercial launch

Status: technically implemented behind fail-closed flags; real sales remain OFF until the supervised
provider cutover. This runbook is Listener-only. It does not deploy, restart or reconfigure event,
LiveKit, Ticket Tailor, playlist-bot, tapestry, event audio or `live.harmonicbeacon.com`.

## Product contract

- Founding Listener is USD 5/month, recurring, with no trial or setup fee.
- PayPal charges USD 5. Mercado Pago charges the canonical BCRA-derived ARS amount displayed by
  its checkout.
- Founder status and price exist only while service is uninterrupted. Cancellation retains access
  through the paid boundary. A real lapse, refund, reversal, dispute, chargeback, fraud or admin
  termination ends Founder continuity.
- Browser redirects, Free, invitations and Free For All never grant membership or emit Purchase.

Public terms and privacy are published at `/listener/terms` and `/listener/privacy`. They are a
truthful launch baseline, not a substitute for counsel review. Human owner: Nico/AlterMundi.

## Verified pre-release evidence — 2026-08-12

- Mercado Pago TEST completed checkout, canonical activation, pause, reactivation and a fresh
  reconciliation using synthetic buyer/card data.
- PayPal Sandbox completed a fresh USD 5 activation, pending cancellation, reversal before the
  boundary and a full refund. The refund terminalized continuity, removed the Founder profile and
  returned the account to Free.
- Private paid-lifecycle metrics and Telegram warning/critical/recovery rules are deployed. A
  database backup was restored into an isolated rehearsal database and verified.
- Production provider and new-sales flags remain OFF. No real payment was attempted.

Passwordless email delivery is deployed in the dedicated Listener-only sidecar at exact backend
SHA `456ece2b38e203a2d12c54864115e03ebaa1a89c`. The API, worker and PostgreSQL queue have no host
ports, use separate storage and did not restart or modify any event service. A controlled message
reached Gmail with terminal delivery state `SENT`; the real-browser callback, isolated email-only
Free entry and logout check passed. The other remaining gates are human/external:
final legal/copy acceptance, one
supervised low-value Live lifecycle per enabled provider and explicit approval to open public
checkout. Production fonts are now hermetic under #327/#329.

Google OAuth rotation #328 is complete. The persistent Listener and disposable staging workbench
both use the replacement client and root-only secret. Canonical login, logout and re-login passed;
the staging callback passed without `authError`. The previous client was revoked only after those
checks and is recoverable in Google Cloud for 30 days for administrative recovery. Never restore
the exposed secret from an environment backup.

The exact public Listener image is
`0a475717d45d32cec38afdb8fc35fb772a994017`. Health and readiness attest that SHA. The same exact
image runs the no-port withdrawal operator sidecar and the staging-only Live workbench. The previous
contract-compatible Listener image `4ac408f4bc43cab85f058fc3d39aa2a2b4b4207a` remains available as
an application-only rollback target; the operator and current database must remain running so legal
requests already received can still be processed. The weekly-quota database policy itself is
forward-only.

The public no-login `BOTÓN DE ARREPENTIMIENTO` and `BOTÓN DE BAJA DE SERVICIO` are deployed with an
immediate opaque receipt, bounded durable queue and no automatic provider action. Root-only timers
export and prune through the pinned operator sidecar. Prometheus loads warning/critical/freshness
rules at 20h/24h; the runtime smoke accepted and resolved one synthetic request of each kind, then
returned the open queue and alerts to zero without exporting PII.

The exact isolated payment-authority image is
`b1038ddb579817e39add567c5b7b055e2f716095`. It includes the reviewed Mercado Pago adverse-event
hardening from backend PR #80. API and worker are healthy, Alembic is at head `7b4c1e9a2d60`, and
the exact public webhook routes fail closed while Live is disabled. Productive PayPal and Mercado
Pago credentials are installed only in the root-owned runtime store. Read-only preflights verified
the PayPal Live catalog/webhook and Mercado Pago productive merchant/webhook configuration with
new sales forced OFF. On 2026-08-13, a supervised PayPal Live approval intent was created for the
USD 5 offer; it is awaiting approval by a buyer account different from the merchant, and created
no subscription or charge. New sales were immediately returned to OFF while PayPal Live lifecycle
ingestion remains ON. The former authority image
`8e10f16fe3471a097021f7f1ee41eb8f88f4f154` and protected pre-deploy backup
`/var/backups/harmonic-beacon/earlybirds-authority-pre-b1038ddb579817e39add567c5b7b055e2f716095.sql.gz`
are retained only as pre-Live forensic/disaster-recovery artifacts; they are no longer routine
rollback targets.

## Independent switches

Listener app, all default OFF:

```text
BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=0
BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED=0
```

Canonical authority, all default OFF until provider configuration is validated:

```text
PMP_MYTH_EARLY_BIRDS_PAID_CHECKOUT_ENABLED=false
PMP_MYTH_EARLY_BIRDS_PAYPAL_LIVE_ENABLED=false
PMP_MYTH_EARLY_BIRDS_MERCADO_PAGO_LIVE_ENABLED=false
```

The authority's new-sales switch may be turned off without disabling signed webhooks,
reconciliation, expiry or cancellation for existing members. Never respond to an incident by
deleting bindings, events, jobs or projections.

## Public boundaries

- Browser checkout: exact same-origin `POST /api/listener/checkout`.
- Browser membership action: exact same-origin `POST /api/listener/membership/action` with
  canonical `cancel|reactivate`.
- PayPal Live webhook: `POST /v1/webhooks/listener/paypal`.
- Mercado Pago Live webhook: `POST /v1/webhooks/listener/mercado-pago`.
- Every other authority route stays loopback/private. Event vhosts expose none of these routes.
- The browser supplies only provider plus a random attempt ID for checkout, and only a random
  attempt ID plus canonical action for membership management. Account, email, current provider and provider subscription ID are
  server-derived. Provider IDs never enter the browser response.

For reversible cancellation before the service boundary, PayPal uses suspend/activate and Mercado
Pago uses pause/reactivate. A terminal provider cancellation, lapse or adverse event is never
converted back into a reversible action.

## Preflight and cutover

1. Back up the Listener database and record current Listener and authority image SHAs.
2. Install root-only provider secrets; verify ownership/mode without printing values.
3. Keep every Live provider and Listener checkout flag OFF. Temporarily set
   `PMP_MYTH_EARLY_BIRDS_PAID_CHECKOUT_ENABLED=false` so the read-only preflight cannot coexist
   with Sandbox/TEST new sales, then run inside the exact authority container:
   `pmp-myth-listener-live-preflight --provider paypal`,
   `pmp-myth-listener-live-preflight --provider mercado_pago`, or `--provider all`.
   The command performs only provider reads and emits no IDs, secrets or PII. Require
   `status=verified` and `new_sales=disabled`; on any failure, keep all Live flags OFF.
4. Validate private readiness, exact signed-webhook negative cases and reconciliation. The
   preflight does not replace webhook signature or lifecycle tests.
5. Install the reviewed Listener nginx template and verify exact routes plus final 404. Do not
   reload nginx unless `nginx -t` is green.
6. Enable the matching Listener checkout flag only after the authority reports that Live provider
   ready and the public copy/terms have human approval.
7. Execute one supervised real USD 5 membership with an agreed account. Confirm provider event,
   canonical projection, profile badge, unlimited access, renewal boundary and no raw PII in logs.
8. Request cancellation in the profile. Confirm provider cancellation, pending-end projection and
   access through paid-through. Use a separate controlled account to rehearse failure/refund.
9. Expand availability only after webhook/reconciliation lag and alerts remain healthy.

## Incident and rollback

- Checkout/provider incident: turn off both app checkout flags and the authority new-sales flag.
  Existing lifecycle workers and webhooks stay running.
- Live authority floor: after the first Live checkout attempt, provider binding or event,
  `b1038ddb579817e39add567c5b7b055e2f716095` is the minimum supported authority binary. Do not run
  `8e10f16fe3471a097021f7f1ee41eb8f88f4f154` against the current database and do not routinely
  restore the pre-`b1038` database backup. The older binary predates required Mercado Pago
  adverse-event hardening and a database restore could discard canonical checkout/lifecycle
  evidence.
- Authority regression after Live cutover: keep the current database, turn new sales OFF, retain
  the affected provider's Live lifecycle flag so signed webhooks, reconciliation, cancellation and
  existing access continue, then deploy a repaired `b1038`-compatible-or-newer image and reconcile
  from the provider. Recovery is roll-forward. A pre-cutover database restore is reserved for an
  explicitly commanded disaster recovery with both providers frozen and a complete provider-led
  reconciliation plan; it is not an ordinary rollback.
- Listener regression: roll back only the Listener image while keeping a contract-compatible
  authority. `4ac408f` remains the bounded contract-compatible application rollback for the current
  authority. Preserve the `0a475717` withdrawal operator and database so already-received legal
  requests remain processable; hide new legal submissions with their feature switch if necessary.
  If compatibility is uncertain, keep Listener disabled and roll forward.
- Provider-specific incident: disable only that app checkout flag. Do not route a pending checkout
  to the other provider or manufacture membership.
- Webhook/reconciliation lag: stop new sales, keep ingestion active, reconcile from provider APIs,
  and do not infer access from return URLs.
- Refund/dispute: follow the canonical provider event. Support records the provider operation and
  opaque account in the private ledger; no card/bank data enters GitHub or application logs.

## Human release gates still required

- Counsel/merchant review of public terms, privacy, refund and tax/invoicing obligations.
- One supervised real purchase and cancellation per provider.
- Explicit approval to turn on real sales. The checked-in defaults remain OFF.

The concise current-state handoff is `docs/operations/LISTENER_LAUNCH_NOW.md`.

Supervised real-provider acceptance must use the separate, one-account staging workbench described
in `LISTENER_PRIVATE_LIVE_WORKBENCH.md`. It leaves this public checkout surface OFF and preserves the
normal staging Sandbox/TEST route.
