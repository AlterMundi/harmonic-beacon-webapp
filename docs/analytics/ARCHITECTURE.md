# Harmonic Beacon analytics architecture

Status: accepted for epic #474. Contract version: `hb.analytics.event.v1`.

## Decision

Harmonic Beacon uses a purpose-built, first-party collector and an Account-authenticated Admin
surface instead of Umami plus Metabase.

Umami v3 is intentionally anonymous and site-local. The product requirement needs a signed
cross-domain handoff, recomputable first/last touch, canonical account links, server-owned
commercial facts and explicit internal/test/synthetic classifications. Adding those beside Umami
would create two browser pipelines and competing session definitions. The collector here keeps a
single strict contract, stores raw facts append-only and remains smaller than the Umami tracker.

Metabase OSS cannot reuse the existing Account/Staff authorization or provide the required
per-person access/export audit without a second identity system or paid SSO. The Admin surface in
Live queries only the analytics mart through a read-only role, reuses Staff `ADMIN` plus explicit
`ANALYTICS_VIEWER` / `ANALYTICS_EXPORTER` grants, and records every detail view and export. It therefore has a narrower
attack surface and clearer ownership than an embedded BI instance.

## Topology

```text
Home / Account / Listen / Live
        |  fail-open browser events
        v
analytics-collector :3300  --->  analytics PostgreSQL on /mnt/beacon-data
        ^                              |
        | HMAC server facts            | incremental SQL transforms
Account / Listener / Live / Authority  v
                                  analytics-worker
                                        |
                read-only source roles -+-- Meta Marketing API (read-only)
                                        |
                                        v
                               Live /ops/analytics
```

The collector and worker are separate containers and pools. Their failure cannot consume an
operational database pool or change a product response. Browser calls use `sendBeacon` or
`fetch(..., keepalive: true)` and never await analytics before navigation.

## Identity and attribution

- `visitor_id`: random first-party UUID stored by the tracker; never authorizes anything.
- `session_id`: per-tab-session UUID renewed after 30 minutes of inactivity.
- `account_subject`: `HMAC-SHA256(account issuer + canonical account id)` generated server-side.
- Cross-domain links receive a short-lived `hb_at` envelope signed by the collector. It contains
  only visitor/session IDs and bounded attribution, never an authentication token or PII.
- `first_touch` is immutable for the visitor. `last_touch` changes only when a new external
  referrer, UTM or click identifier is observed. Both remain reconstructible from raw events.
- Login links the visitor to `account_subject`; logout closes the authenticated association but
  does not rewrite historical facts; account switching creates another versioned link.

## Truth boundaries

Browser events describe navigation and interaction. They cannot create account, verification,
membership, payment, entitlement, listening duration or event attendance facts. Those facts are
emitted by the owning server or ingested read-only from its database. Event IDs and source keys
make all writes idempotent.

Listener duration extends the existing server lease/union authority from #308. Live attendance
uses server timestamps around bounded heartbeats and unions overlapping intervals per person and
event. Browser elapsed values are never accepted.

## Security and data classes

Raw PII, technical identifiers, operational facts and aggregates live in separate schemas/roles.
The public collector rejects password/token/secret/payment/chat/media fields and strips query
strings from page and referrer paths. IP addresses are HMACed with a dedicated rotating key; raw
addresses are not persisted. The collector resolves the trusted Nginx peer address in memory
through the mounted DB-IP MMDB and persists only country/region plus coarse device/browser
fields. The currently installed country-lite database produces country and leaves region as
`unknown`; a future city database can fill the same bounded field without changing the event
contract. Missing or unreadable GeoIP data degrades only this enrichment and is exposed by the
collector health and metrics.

The mart is read-only to the dashboard. Detail and CSV endpoints require an authorized role and
append an audit fact. Provider tokens exist only in the worker environment. The Meta adapter has
no write methods and requests `ads_read` only.

Canonical event signatures are environment-bound. Production emitters use
`ANALYTICS_SERVER_EVENT_SECRET`; staging, development and test use the distinct
`ANALYTICS_NONPRODUCTION_SERVER_EVENT_SECRET`. The collector selects the key from the claimed
environment before accepting the strictly validated event, so either key fails closed if it is
replayed with the other environment. The production key alone authorizes the Admin dashboard.
