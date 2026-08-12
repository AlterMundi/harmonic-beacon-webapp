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
- Browser cancel request: exact same-origin `POST /api/listener/membership/cancel`.
- PayPal Live webhook: `POST /v1/webhooks/listener/paypal`.
- Mercado Pago Live webhook: `POST /v1/webhooks/listener/mercado-pago`.
- Every other authority route stays loopback/private. Event vhosts expose none of these routes.
- The browser supplies only provider plus a random attempt ID for checkout, and only a random
  attempt ID for cancellation. Account, email, current provider and provider subscription ID are
  server-derived. Provider IDs never enter the browser response.

## Preflight and cutover

1. Back up the Listener database and record current Listener and authority image SHAs.
2. Install root-only provider secrets; verify ownership/mode without printing values.
3. Keep new-sales flags OFF. Enable one provider lifecycle and validate private readiness,
   catalog/merchant identity, signed-webhook negative cases and reconciliation.
4. Install the reviewed Listener nginx template and verify exact routes plus final 404. Do not
   reload nginx unless `nginx -t` is green.
5. Enable the matching Listener checkout flag only after the authority reports that Live provider
   ready and the public copy/terms have human approval.
6. Execute one supervised real USD 5 membership with an agreed account. Confirm provider event,
   canonical projection, profile badge, unlimited access, renewal boundary and no raw PII in logs.
7. Request cancellation in the profile. Confirm provider cancellation, pending-end projection and
   access through paid-through. Use a separate controlled account to rehearse failure/refund.
8. Expand availability only after webhook/reconciliation lag and alerts remain healthy.

## Incident and rollback

- Checkout/provider incident: turn off both app checkout flags and the authority new-sales flag.
  Existing lifecycle workers and webhooks stay running.
- Listener regression: roll back only the Listener image while keeping a contract-compatible
  authority. If compatibility is uncertain, keep Listener disabled and roll forward.
- Provider-specific incident: disable only that app checkout flag. Do not route a pending checkout
  to the other provider or manufacture membership.
- Webhook/reconciliation lag: stop new sales, keep ingestion active, reconcile from provider APIs,
  and do not infer access from return URLs.
- Refund/dispute: follow the canonical provider event. Support records the provider operation and
  opaque account in the private ledger; no card/bank data enters GitHub or application logs.

## Human release gates still required

- PayPal Live Business account/app/product/plan/webhook and root-only Live secrets.
- Mercado Pago productive merchant credentials/webhook and root-only Live secrets.
- Counsel/merchant review of public terms, privacy, refund and tax/invoicing obligations.
- One supervised real purchase and cancellation per provider.
- Explicit approval to turn on real sales. The checked-in defaults remain OFF.
