# Listener launch — current state

Last reconciled: 2026-08-15

This is the compact operational memory for Founding Listeners. Detailed evidence
and rollback procedures live in `FOUNDING_LISTENER_COMMERCIAL_LAUNCH.md` and
`FOUNDING_LISTENER_RELEASE_CANDIDATE.md`. GitHub issue #315 is the live checklist.

## Exact deployed state

- Public candidate: `https://listen.harmonicbeacon.com/`
- Listener image/SHA: `acc90ba35fea52f63ef18337e3a555ef637c552f`
- Previous contract-compatible Listener application image: `0a475717d45d32cec38afdb8fc35fb772a994017`
- Withdrawal operator sidecar image/SHA: `0a475717d45d32cec38afdb8fc35fb772a994017`
- Canonical payment authority: `4e5b208e902969285c8f68067f7fd13b7e2eb68d`
- Minimum authority after any new Live checkout attempt: `4e5b208e902969285c8f68067f7fd13b7e2eb68d`
- Listener mail sidecar: `456ece2b38e203a2d12c54864115e03ebaa1a89c`
- Weekly Free: three hours per server-owned seven-day cycle
- Founding Listener: USD 5/month while service remains uninterrupted
- Free For All: OFF
- PayPal Live checkout: OFF
- Mercado Pago Live checkout: OFF
- Private staging Live workbench: OFF; staging and canonical workbench routes return 404
- PayPal Live lifecycle/read-only reconciliation: ready with new sales OFF and no outstanding intent
- Mercado Pago Live provider: OFF
- Mercado Pago TEST lifecycle: ready; global new sales OFF
- Public consumer withdrawal/service cancellation: ON; no login, immediate opaque receipt
- Public sales: OFF; only the explicitly supervised Live lifecycle is authorized

The authority now includes the reviewed adverse-event hardening, typed recovery
for missing PayPal approvals and a read-only Live-provider preflight. The
deployed API/worker are healthy at exact revision `4e5b208`; Alembic is at
`7b4c1e9a2d60`. Productive credentials are installed
root-only. With new sales forced OFF, PayPal verified its exact Live product,
USD 5 plan and webhook event set; Mercado Pago verified its productive MLA
merchant and webhook configuration. Neither preflight creates checkout,
subscription, binding or payment. The one abandoned PayPal Live approval later
returned canonical provider 404 and was retired with the bounded application
operator: no charge, provider subscription, Founder continuity or Purchase was
created, the old approval cannot replay and no outstanding PayPal binding
remains. Global new sales and both public Listener checkout flags are OFF.
PayPal Live lifecycle ingestion remains ready so signed webhooks,
reconciliation and cancellation stay available. Mercado Pago remains on TEST
with Live OFF.

PayPal Sandbox has passed activation, pending cancellation, reactivation and
terminal refund. Mercado Pago TEST has passed checkout, activation, pause,
reactivation and reconciliation. Browser redirects never grant membership.

The dedicated magic-link API, worker and PostgreSQL queue are isolated from the
event runtime and have no host ports. A controlled Gmail delivery reached
`SENT`; the real-browser email-only callback, Free entry and logout passed.

Google OAuth rotation #328 is complete. Canonical login → logout → re-login and
the staging callback passed on the replacement client. The previous client was
revoked after acceptance; its secret must never be restored from an old env
backup. Only Listener and the disposable staging workbench were recreated.

## Remaining blockers to public sales

1. #304 — complete a physical 60-minute listen and record any watchdog recovery.
2. #317 — final mobile/account-menu billing acceptance.
3. #318 — record human ES/EN offer/legal/seller/refund/support and invoicing
   acceptance. The public no-login withdrawal and service-cancellation paths,
   dedicated secret, migration, private operator, metrics and 20h/24h alerts
   are deployed and smoke-tested.
4. With a new explicit approval, create a fresh PayPal checkout for a
   non-merchant buyer and execute supervised activation, cancellation and
   refund evidence. Execute the corresponding supervised Mercado Pago Live
   lifecycle separately.
5. Confirm Founder activation, terminal Free fallback, metrics, alerts and the
   absence of PII/secret leakage against those Live transactions.
6. Obtain separate explicit approvals for merge to `main` and public checkout.

## Non-negotiable isolation

Do not deploy, restart or reconfigure event services, Ticket Tailor, LiveKit,
playlist-bot, tapestry, event audio, Proyección del Mito experience or
`live.harmonicbeacon.com`. Do not change approved Listener audio. Do not enable
Live providers, charge real money, merge to `main` or open public checkout
without explicit approval.

## Immediate rollback

- Commerce incident: switch OFF Listener checkout flags and authority new-sales;
  keep webhooks, reconciliation, cancellation and existing access running.
- Authority application regression after any new Live checkout attempt: keep the current database,
  keep the affected provider's Live lifecycle flag ON, keep new sales OFF and roll forward with
  `4e5b208` or a newer contract-compatible authority. Never deploy `b1038ddb` or `8e10f16` after a
  new approval has been created: `b1038ddb` predates safe provider-404 retirement and `8e10f16`
  predates adverse-webhook hardening. Never use a protected pre-cutover backup as a routine rollback: it can lose
  canonical checkout/lifecycle evidence and exists only for explicitly commanded disaster
  recovery followed by complete provider reconciliation.
- Listener application regression: roll back only the isolated Listener to
  `0a475717` if contract-compatible; keep the `0a475717` withdrawal operator and
  current database running so already-received legal requests remain processable.
  Set `LISTENER_WITHDRAWAL_ENABLED=0` to hide the public request routes during
  application recovery, then roll forward.
- Weekly quota is forward-only. Never restore the retired daily-window/welcome
  authority.
- Magic delivery incident: clear the three protected magic-link values and
  recreate only Listener; do not restart the event runtime.
- Google OAuth incident: keep the replacement client and roll forward with a
  new secret. The revoked client remains provider-restorable for 30 days only
  for controlled recovery; never restore its exposed secret from backups.

## Public-document truth

The broad Phase 2 patronage/provider-economy documents are future strategy, not
the implementation authority for Founding Listeners. Public and repository copy
must not claim that Harmonic Beacon has no payment or email processing: the
Sandbox/TEST subscription lanes and Gmail magic-link delivery are already real
pre-release processors. Equally, copy must not claim public Live billing is
active: productive credentials are installed and verified, PayPal Live
lifecycle/reconciliation is ready with no outstanding intent, and authority new
sales, real charges and both public checkout flags remain OFF.
