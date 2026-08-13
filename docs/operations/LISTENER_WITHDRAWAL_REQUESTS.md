# Listener consumer-withdrawal requests

This is the bounded operator flow for the public **BOTÓN DE
ARREPENTIMIENTO** and **BOTÓN DE BAJA DE SERVICIO**. It receives and tracks a request; it never calls PayPal,
Mercado Pago or the membership authority and it never cancels or refunds by
itself.

## Runtime boundary

- Apply migration `20260813190000_listener_withdrawal_request` before exposing
  the route.
- Generate a dedicated random value of at least 32 bytes for
  `LISTENER_WITHDRAWAL_SECRET`. Install it only in the isolated Listener env,
  owned by root and mode `0600`. Do not reuse OAuth, auth, payment, mail or event
  secrets.
- Leave `LISTENER_WITHDRAWAL_ENABLED=0` while migrating, installing the secret,
  systemd timers and alerts. The two pages, links and API all behave as absent
  (`404`) unless the flag is exactly `1` **and** the secret is valid. Readiness
  fails when the flag is on without the secret or either additive table.
  Public paid
  checkout stays independently OFF until the complete launch gate is accepted.
- The table contains the minimum contact data needed to find the transaction:
  email, provider and optional approximate date. It
  stores only a digest of the public receipt and HMAC-keyed network/email
  throttles plus one fixed global bucket;
  no raw IP, card data or provider transaction ID is accepted.

Both mechanisms are public without login or registration. Identity/security
verification, when necessary, occurs during operator processing and must remain
reasonable and habitual; it must never become a registration prerequisite.
The receipt code is returned immediately. Operators must process the request
and take the corresponding measures within 24 hours.

Official sources reviewed for this MVP:

- [Disposición 954/2025](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-954-2025-417152/texto), especially arts. 1–5;
- [Disposición 3/2026](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-3-2026-423007/texto), complementary identity/security verification rules.

## Queue procedure (within 24 hours)

Run the CLI only from a root-owned shell with the Listener `DATABASE_URL` in a
root-only environment. Terminal capture/history must be treated as private
because `show` reveals the contact email.

```bash
npx tsx scripts/listener-withdrawal-operator.ts list 50
npx tsx scripts/listener-withdrawal-operator.ts show REQUEST_UUID
npx tsx scripts/listener-withdrawal-operator.ts acknowledge REQUEST_UUID operator-code
```

Then, outside this application:

1. inspect `requestKind`, then correlate the email/provider/date against the canonical provider and
   membership authority;
2. contact the requester when evidence is insufficient;
3. perform the authorized provider cancellation/refund, if applicable, using
   its normal audited procedure;
4. confirm canonical membership convergence;
5. record only the bounded result in this queue:

```bash
npx tsx scripts/listener-withdrawal-operator.ts resolve REQUEST_UUID operator-code CANCELLED
```

Allowed terminal codes are `CANCELLED`, `REFUNDED`,
`CANCELLED_AND_REFUNDED`, `DUPLICATE` and `NOT_APPLICABLE`. The CLI requires an
acknowledged request, uses compare-and-set transitions and is idempotent for an
already-acknowledged row. It intentionally has no public read/status endpoint.

The operational alert should count `RECEIVED` requests older than 20 hours as
warning and any non-resolved request older than 24 hours as critical. Metrics
contain only counts, oldest age and export freshness; never email, receipt,
provider IDs or request IDs.

## Private metrics and maintenance

Create `/etc/harmonic-beacon/listener-withdrawal-ops.env` root-owned, mode
`0600`, containing only `LISTENER_WITHDRAWAL_CONTAINER=earlybirds-preview-listener-1`
(or the reviewed replacement container name). The operator inherits the
container's private `DATABASE_URL`; do not duplicate it on the host. Install
the two wrappers into `/usr/local/libexec/harmonic-beacon/`, root-owned mode
`0755`. Install the four reviewed units from `ops/early-birds/systemd/` into
`/etc/systemd/system/`, then:

```bash
systemd-analyze verify /etc/systemd/system/harmonic-beacon-listener-withdrawal-*.{service,timer}
systemctl daemon-reload
systemctl enable --now harmonic-beacon-listener-withdrawal-metrics.timer
systemctl enable --now harmonic-beacon-listener-withdrawal-prune.timer
systemctl start harmonic-beacon-listener-withdrawal-metrics.service
```

The five-minute job writes
`/var/lib/harmonic-beacon/metrics/listener-withdrawal.prom` atomically for the
already-private node-exporter textfile collector. The daily job prunes only
expired HMAC throttle buckets; request/audit rows are never removed. Alerts
cover queue age at 20/24 hours and missing/stale exports at 10/20 minutes;
Alertmanager's existing `send_resolved: true` emits recovery. Neither endpoint
nor metrics path is routed through nginx.

Before switching on, confirm `node_textfile_scrape_error == 0`, the freshness
metric advances twice, the queue alerts have no pending/firing state, and a
direct public request to `/api/internal/` remains `404`.

## Rollback

Set `LISTENER_WITHDRAWAL_ENABLED=0` to hide both links/routes/API, or deploy the previous Listener image. Keep the
additive tables: dropping them would destroy open consumer requests. The queue
can continue to be processed with this commit's root-only CLI. No event or
payment-provider rollback is involved.
