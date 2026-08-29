# Analytics data governance

Status: technically applied for epic #474. Legal owner names and notices must remain aligned with
the public legal documents. This file is an operational inventory, not a substitute for counsel.

Harmonic Beacon is operated from Argentina on Argentine infrastructure for an international
audience. Argentina's Ley 25.326 applies to the operator; GDPR/UK GDPR and local storage rules can
also apply when people in those territories are observed. The analytics contract deliberately
excludes health questionnaires, free-form narratives, form values, chat and media content.

## Inventory and responsibility

| Data class | Examples | Purpose | System of record | Operational owner | Default retention | Dashboard access |
|---|---|---|---|---|---|---|
| Anonymous web behavior | visitor/session UUID, page path, CTA outcome | Acquisition and product decisions | `ingest.raw_events` | Product analytics | 180 days | Viewer; export role for CSV |
| Attribution | first/last UTM, referrer, landing | Campaign attribution | `ingest.raw_events`, `mart.acquisition_daily` | Growth/product | Raw 180 days; aggregates retained | Viewer; export role for CSV |
| Advertising click IDs | `fbclid`, `gclid`, similar IDs | Match a visit to a campaign touch | Attribution JSON only | Growth/product | 90 days, then removed | Export role for detail |
| Coarse network/device | HMAC network digest, country/region, browser/OS/class | Fraud control and regional/device analysis | `ingest.raw_events` | Platform operations | Network digest 30 days; coarse fields 180 days | Viewer; export role for CSV |
| Identity links | opaque account HMAC ↔ visitor UUID with validity interval | Cross-domain deduplication and account funnel | `identity_map` | Account/platform | While operationally required; anonymize on applicable request | Privileged maintenance; dashboard sees opaque subjects only |
| Canonical accounts | created/verified/method/last active | Account conversion and activity | Account source → `mart.account_facts` | Account | While account exists plus legal/operational obligations | Viewer; export role for detail |
| Listening/attendance | bounded server intervals, event/person HMAC, role/test flags | Duration, recurrence and event operation | Listener/Live → interval marts | Listener/Live | Longitudinal product need; review annually | Viewer; export role for detail |
| Membership/payment | canonical state, provider, amount in minor units, currency, paid-through | Subscribers, churn and revenue | Authority → commerce marts | Commerce/finance | Financial/legal retention; never inferred from browser | Viewer; export role; finance source remains canonical |
| Campaign aggregates | Meta entity IDs/names/status and Insights aggregates | Delivery, cost and attributed actions | Meta Marketing API → campaign marts | Growth | Provider reporting need; review annually | Viewer; export role |
| Audit | opaque actor, role, resource, filter digest, export row count | Accountability for sensitive reads/exports | `audit.analytics_access` | Security/operations | Minimum required for access investigation; review annually | Privileged maintenance |
| Operational quality | source watermarks, dead letters, quality/storage samples | Freshness, drift, capacity and recovery | `ops` | Platform operations | Quality 180 days; storage samples 400 days | Viewer; export role |

Raw authentication tokens, passwords, signed URLs, payment instruments and audio/video/chat or
free-form form content are prohibited by schema and are not an analytics data class.

## Regional collection and preferences

The tracker requests `/v1/privacy-context` before creating a visitor or session identifier. The
endpoint uses the request address transiently and returns only whether first-party analytics may
start without consent. EEA, UK and Switzerland traffic, and traffic whose country cannot be
determined, fails closed: no analytics identifier is created and no browser event is emitted.
A future approved consent interface can provide a positive choice without changing this default.

Global Privacy Control, `Do Not Track`, the first-party opt-out cookie, and the legacy same-origin
opt-out flag all disable the tracker before identifiers are read or created. The cookie is scoped
to `.harmonicbeacon.com`, so one choice covers Home, Account, Listen and Live. This mechanism is
independent of and does not read, modify, grant or revoke Meta Pixel consent.

The public analytics notice describes purposes, categories, retention and the contact path for
access, correction, export or deletion. The exact controller legal name and any jurisdiction-
specific consent copy remain a legal-document responsibility and must be reviewed before enabling
browser analytics in a consent-required territory.

## Access and data-subject operations

- Live `ADMIN` and explicit `ANALYTICS_VIEWER` roles may view the dashboard.
- `ADMIN` and `ANALYTICS_EXPORTER` may export. Every view/export records actor, role, filter digest
  and exported row count; the audit never stores the result set.
- A correction or access request resolves the person in Account, derives the privileged HMAC
  subject, and exports only matching facts.
- An applicable deletion request removes raw/identity rows and anonymizes non-required product
  facts. Financial facts required by law remain but lose unnecessary visitor links. The operator
  appends a maintenance audit record.
- Secret rotation never rewrites canonical money or durations. Provider and HMAC secrets remain
  server-side and outside the mart/dashboard roles.

## Review and evidence

The worker records projection backlog, unmatched identity links, payments without canonical
membership, invalid intervals, clock skew, table counts and database size. The dashboard exposes
the latest results and storage history. The five-minute monitor fails on current quality errors,
stale/error sources, open dead letters, excessive daily database growth, missing/stale backups,
capacity, inode or mount failures.

Review this inventory, access grants, retention execution, source ownership and the public notice
at least annually and after any contract version, provider, jurisdiction or purpose change.

