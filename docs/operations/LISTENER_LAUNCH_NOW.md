# Listener launch — current state

Last reconciled: 2026-08-12

This is the compact operational memory for Founding Listeners. Detailed evidence
and rollback procedures live in `FOUNDING_LISTENER_COMMERCIAL_LAUNCH.md` and
`FOUNDING_LISTENER_RELEASE_CANDIDATE.md`. GitHub issue #315 is the live checklist.

## Exact deployed state

- Public candidate: `https://listen.harmonicbeacon.com/`
- Listener image/SHA: `4ac408f4bc43cab85f058fc3d39aa2a2b4b4207a`
- Previous same-schema Listener rollback image: `fcdde379`
- Canonical payment authority: `b1038ddb579817e39add567c5b7b055e2f716095`
- Previous authority rollback image: `8e10f16fe3471a097021f7f1ee41eb8f88f4f154`
- Listener mail sidecar: `456ece2b38e203a2d12c54864115e03ebaa1a89c`
- Weekly Free: three hours per server-owned seven-day cycle
- Founding Listener: USD 5/month while service remains uninterrupted
- Free For All: OFF
- PayPal Live checkout: OFF
- Mercado Pago Live checkout: OFF
- Authority Live providers: OFF
- Authority Sandbox/TEST new-sales gate: ON only inside isolated staging acceptance; Live metrics remain zero/OFF
- Public sales and real charges: not authorized

The authority now includes the reviewed adverse-event hardening and a read-only
Live-provider preflight. The deployed API/worker are healthy at exact revision
`b1038ddb`; Alembic is at `7b4c1e9a2d60`. Productive credentials are installed
root-only. With new sales forced OFF, PayPal verified its exact Live product,
USD 5 plan and webhook event set; Mercado Pago verified its productive MLA
merchant and webhook configuration. Neither preflight creates checkout,
subscription, binding or payment. The normal runtime deliberately remains on
Sandbox/TEST for acceptance, with both Live provider flags OFF.

PayPal Sandbox has passed activation, pending cancellation, reactivation and
terminal refund. Mercado Pago TEST has passed checkout, activation, pause,
reactivation and reconciliation. Browser redirects never grant membership.

The dedicated magic-link API, worker and PostgreSQL queue are isolated from the
event runtime and have no host ports. A controlled Gmail delivery reached
`SENT`; the human callback/Free/logout check remains.

## Remaining blockers to public sales

1. #217 — open the delivered magic link and prove email-only session → Free → logout.
2. #304 — complete a physical 60-minute listen and record any watchdog recovery.
3. #317 — final mobile/account-menu billing acceptance.
4. #318 — human ES/EN offer/legal/seller/refund/support acceptance.
5. #328 — rotate the exposed Google OAuth client secret in the protected store,
   then prove canonical and staging login/logout/relogin without printing it.
6. With explicit approval, execute one supervised low-scope activation,
   cancellation and refund per provider.
7. Confirm Founder activation, terminal Free fallback, metrics, alerts and the
   absence of PII/secret leakage against those Live transactions.
8. Obtain separate explicit approvals for merge to `main` and public checkout.

## Non-negotiable isolation

Do not deploy, restart or reconfigure event services, Ticket Tailor, LiveKit,
playlist-bot, tapestry, event audio, Proyección del Mito experience or
`live.harmonicbeacon.com`. Do not change approved Listener audio. Do not enable
Live providers, charge real money, merge to `main` or open public checkout
without explicit approval.

## Immediate rollback

- Commerce incident: switch OFF Listener checkout flags and authority new-sales;
  keep webhooks, reconciliation, cancellation and existing access running.
- Authority application regression: restore exact image `8e10f16fe3471a097021f7f1ee41eb8f88f4f154`
  with the protected pre-deploy configuration/database backup at
  `/var/backups/harmonic-beacon/earlybirds-authority-pre-b1038ddb579817e39add567c5b7b055e2f716095.sql.gz`.
- Listener application regression: roll back only the isolated Listener to
  `fcdde379` if contract-compatible; otherwise disable Listener and roll forward.
- Weekly quota is forward-only. Never restore the retired daily-window/welcome
  authority.
- Magic delivery incident: clear the three protected magic-link values and
  recreate only Listener; do not restart the event runtime.

## Public-document truth

The broad Phase 2 patronage/provider-economy documents are future strategy, not
the implementation authority for Founding Listeners. Public and repository copy
must not claim that Harmonic Beacon has no payment or email processing: the
Sandbox/TEST subscription lanes and Gmail magic-link delivery are already real
pre-release processors. Equally, copy must not claim Live billing is active:
productive credentials are installed and verified, but both Live providers,
real charges and public checkout remain OFF.
