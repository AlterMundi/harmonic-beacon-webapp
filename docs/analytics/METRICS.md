# Analytics metric dictionary

All default dashboard queries use `environment=production` and `traffic_class=real`. Internal,
test, staging and synthetic rows are visible only when explicitly selected. Money is kept in
provider minor units and grouped by currency; the dashboard never invents an exchange rate.

| Metric | Definition | Authority |
|---|---|---|
| Visitor | Distinct first-party UUID observed by the browser tracker | `ingest.raw_events` |
| Session | Per-tab browser session, renewed after 30 minutes idle | `ingest.raw_events` |
| Account created / verified | Durable Account timestamps | Listener source / signed Account event |
| Listener time | Union of server-observed #308 intervals by account | `mart.listening_intervals_unioned` |
| Event attendance | Union of bounded server heartbeat intervals by event/person | `mart.live_presence_intervals_unioned` |
| Current subscriber | Latest canonical membership with paid-through in the future and no terminal state | Authority / Listener projection |
| Confirmed revenue | Processed `PAYMENT_SUCCEEDED` less processed refunds | Authority provider event ledger |
| MRR | Current recurring membership amount, separately per currency | `mart.current_memberships` |
| Churn | Current membership entering CANCELLED, EXPIRED, REFUNDED or REVOKED in range | Membership authority |
| Campaign delivering | Recent non-zero spend or impressions, independent of configured ACTIVE | Meta insights |

Pre-instrumentation Listener leases are not reliable elapsed-time records because one device lease
was reused across playback episodes. The backfill retains only a bounded last-heartbeat sample as
`traffic_class=unknown`; it is excluded from default real metrics. Canonical duration begins with
the durable #308 interval table.

Refunds and provider-confirmed disputes/reversals subtract their canonical amount from net revenue;
an abandoned or pending checkout contributes nothing. `0` means the query ran and found no qualifying facts. `unknown` means a fact is absent. `stale`
means its source watermark exceeded the freshness contract. `error` means the latest sync failed.
Clicks, return URLs, `APPROVAL_PENDING`, and abandoned provider pages never count as payments.

First touch is the visitor's earliest stored campaign/referrer/landing. Last touch changes on a
later explicit UTM/click ID or external referrer. A signed 15-minute handoff carries only opaque
visitor/session IDs and attribution between Harmonic Beacon domains. An authenticated same-origin
endpoint emits the canonical account link; the account subject is never returned to JavaScript.
