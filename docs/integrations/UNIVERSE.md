# Universe ticketing and payments integration

> **Status: Draft — pending validation.** This document evaluates a possible
> external integration. No Universe account, checkout, API client, webhook,
> payment flow, or entitlement described here exists in `main`.
> **[Planned — unscheduled]**

*Draft · 2026-07-28 · technical integration note, pending validation*

## Decision summary

Universe is a ticketing platform with hosted payment processing, not a general
payment gateway. Harmonic Beacon could delegate payment collection to Universe
when the product being sold is an event ticket: for example, a retreat, an
in-person session, or another capacity-limited event. The buyer would complete
payment inside Universe's hosted or embedded checkout, and Harmonic Beacon would
learn the result through a signed webhook.

Universe is **not recommended as the billing system for the monetization model
currently described in [MONETIZATION.md](../MONETIZATION.md)**:

- recurring Threshold, Resonant, Kindred, and Hearth patronage;
- open-amount, one-time donations;
- application-native entitlements tied to a Harmonic Beacon account; or
- Provider revenue-share payouts.

Those surfaces remain designed around Stripe Billing, Checkout, Connect, and
Tax. Universe should only be adopted if ticketed events become an explicit
product surface. This note does not change the payment-provider decision in
`MONETIZATION.md`.

## What Universe provides

Universe exposes four relevant integration surfaces:

1. A hosted event page and checkout.
2. An embeddable checkout controlled by `embed2.js` and the browser-side `$u`
   API.
3. Account-level webhooks for ticket purchases and ticket state updates.
4. An OAuth 2.0-authenticated GraphQL API for events, orders, attendees,
   discount codes, access keys, and check-in operations.

The public GraphQL API is documented as beta. Its schema may receive breaking
changes, so queries should request only the fields the application uses and the
integration should be covered by contract tests.

## Proposed system boundary

```text
Harmonic Beacon page
        |
        | opens event checkout
        v
Universe hosted/embedded checkout ----> Universe payment processor
        |                                      |
        | confirmation UI                      | settlement / withdrawal
        v                                      v
browser callback (analytics only)          Organizer account

Universe webhook ----> Harmonic Beacon webhook endpoint ----> local ticket state
                              |
                              +----> async processing / entitlement, if applicable

Harmonic Beacon reconciliation job ----> Universe GraphQL API
```

Universe is the source of truth for the purchase and ticket lifecycle. Harmonic
Beacon may keep a projection of that state for product access and reporting, but
must not create a local `paid` state from a browser redirect or callback alone.

## Payment processor choice

Universe offers two processor configurations:

### Universe Payments

This is the default and the closest match to "delegate payments to Universe."
Universe processes the transaction and makes settled funds available in the
organizer's Universe balance for withdrawal. Universe service and processing
fees apply; whether the organizer absorbs or passes applicable fees to the buyer
is configured in Universe.

### Stripe Connect through Universe

Universe still owns the ticket checkout while the organizer's connected Stripe
account processes the payment. This can provide more direct control over payout
timing and reconciliation, but it is not a way to reuse Harmonic Beacon's future
subscription checkout: the transaction still belongs to a Universe ticket
order.

Universe warns that, after an event has sold a ticket through Stripe Connect,
that event cannot switch back to Universe Payments. The processor must therefore
be selected and tested before ticket sales open.

Fees, supported currencies, payout countries, refund behavior, tax treatment,
and settlement timing must be confirmed for the AlterMundi legal entity before
launch. No fee percentage or payout schedule is fixed in this document because
those values depend on processor, account, currency, and location.

## Checkout integration

### Preferred first release: hosted page

Linking to the Universe event page is the lowest-risk first integration. It
keeps checkout entirely on Universe and avoids failures caused by content
security policy, script blockers, or browser embedding behavior.

### Optional embedded checkout

Universe documents the following browser script:

```html
<script src="https://www.universe.com/embed2.js"></script>
```

After it loads, the checkout can be opened with the public event identifier:

```js
window.$u.open("UNIVERSE_EVENT_ID");
```

The API can also apply Universe access keys and discount codes:

```js
window.$u.open("UNIVERSE_EVENT_ID", {
  accessKeys: ["ACCESS_KEY"],
  currentDiscountCode: { code: "DISCOUNT_CODE" },
});
```

In Next.js, the external script should be loaded with `next/script` in a client
component, and the purchase button must remain disabled until `$u` is available.
The event identifier is public configuration; OAuth client secrets, webhook
secrets, and access tokens must never be included in the client bundle.

Universe currently documents that Apple Pay works on Universe.com but not
inside the embedded widget. Payment-method acceptance also varies by currency
and event location. If Apple Pay or the broadest possible payment-method support
is required, use the hosted event page.

## Purchase callbacks and redirects

The embedded checkout dispatches browser events including:

- `unii:opened`;
- `unii:closed`; and
- `unii:ticket:purchased`.

`unii:ticket:purchased` can drive analytics or redirect to a thank-you page.
Universe explicitly does not guarantee delivery of browser callbacks because
scripts and content blockers can interfere with them. A callback must therefore
never grant an entitlement, mark an order as paid, or be the only record of a
purchase.

## Webhook design

Universe currently documents two webhook event types:

- `ticket_purchase`: a ticket was purchased; and
- `ticket_update`: a ticket state changed, including cancellation.

The webhook receiver will be a server-only `POST` route. Its implementation
must:

1. Read and retain the raw request body before JSON parsing.
2. Verify the HMAC hex digest against the configured webhook secret using a
   timing-safe comparison.
3. Reject missing or invalid signatures without mutating local state.
4. Parse and validate the payload only after signature verification.
5. Process deliveries idempotently so retries or repeated state notifications
   cannot duplicate an entitlement or side effect.
6. Persist the external ticket/order identifiers and the latest observed state.
7. Return a success response quickly, moving non-trivial work to an asynchronous
   path.
8. Log identifiers and state transitions without logging buyer PII or the full
   payload.

The official documentation spells the headers `X-Uniiverse-Event` and
`X-Uniiverse-Signature` (with two consecutive `i` characters). The exact header
names and HMAC algorithm must be confirmed with a test delivery before code is
released; the documentation describes an HMAC hex digest but does not identify
the digest algorithm on the webhook guide.

Universe also warns that a webhook can be marked inactive after a failed POST.
The integration therefore needs both monitoring for missing deliveries and a
scheduled reconciliation job. A webhook is the real-time signal; GraphQL is the
recovery path.

## API and OAuth

The GraphQL endpoint is:

```text
POST https://www.universe.com/graphql
Authorization: Bearer <access token>
Content-Type: application/json
```

For an integration owned by Harmonic Beacon and reading only AlterMundi's
Universe account, use the OAuth 2.0 Client Credentials flow. If Harmonic Beacon
ever becomes a multi-organizer platform connecting independent Universe
accounts, use the Authorization Code flow and obtain each organizer's consent.

An OAuth application is created through Universe. Client credentials, access
tokens, refresh tokens, and the webhook secret belong in the server-side secret
store. They must not be committed, exposed through `NEXT_PUBLIC_*`, or written
to logs.

The API can retrieve event orders, attendees, buyer data, ticket rates, order
state, and cost breakdowns. A reconciliation query should be bounded to the
relevant event and a defined time window or cursor; broad attendee exports
should not run in a request/response path.

## Local data and identity mapping

If tickets unlock anything inside Harmonic Beacon, the minimum local projection
will need:

- Universe event ID;
- Universe order ID;
- Universe ticket ID;
- current external ticket/order state;
- last webhook or reconciliation timestamp; and
- the Harmonic Beacon user ID, when a reliable association exists.

The public `embed2.js` documentation does not expose a general-purpose,
server-trusted metadata field for a Harmonic Beacon user ID. Analytics referral
values and browser callbacks are not identity proof. Before gated access is
implemented, the team must choose and test an explicit account-linking method,
such as a verified-email claim flow or a supported Universe checkout field whose
value is present in the signed webhook/API response. Email matching must not be
silently assumed to be sufficient.

Buyer and attendee data is personal data. Store only fields needed for access,
support, reconciliation, and statutory obligations; define retention and
deletion behavior before importing attendee lists. Do not copy full webhook
payloads into application logs.

## Failure modes and controls

| Failure | Required control |
|---|---|
| Browser callback is blocked | Webhook is authoritative; GraphQL reconciles gaps. |
| Webhook is replayed | Idempotency constraint on external identifiers and transition. |
| Webhook signature is invalid | Reject before parsing or changing state. |
| Webhook becomes inactive | Alert, re-enable in Universe, then reconcile via API. |
| API token expires | Server-side refresh/re-authentication and an observable failure state. |
| GraphQL schema changes | Minimal queries, contract tests, and explicit error monitoring. |
| Ticket is cancelled or refunded | `ticket_update` revokes event-specific access according to policy. |
| Local user cannot be correlated | Hold the ticket as unlinked; never grant access by guesswork. |
| Embedded checkout loses a payment method | Fall back to the hosted Universe event URL. |

## Validation plan

Before production use:

1. Confirm the legal entity, supported payout country, settlement currency,
   taxes, refunds, chargebacks, and fee allocation with Universe.
2. Create a non-production event and ticket rate.
3. Test both the hosted checkout and the embedded checkout on supported desktop
   and mobile browsers.
4. Capture representative `ticket_purchase` and `ticket_update` deliveries,
   including cancellation/refund behavior.
5. Confirm signature header spelling, digest algorithm, payload schema, retry
   behavior, and webhook deactivation behavior.
6. Verify OAuth token issuance and a minimal event-order reconciliation query.
7. Exercise duplicate, delayed, missing, invalid-signature, and out-of-order
   webhook deliveries.
8. Document the support procedure for unmatched buyers and webhook outages.
9. Complete a privacy and financial review before importing buyer PII or taking
   a live payment.

## Open decisions

- Which ticketed Harmonic Beacon product, if any, requires Universe?
- Will checkout use Universe Payments or Stripe Connect?
- Is hosted checkout acceptable, or is embedding a product requirement?
- How will an authenticated Harmonic Beacon user be linked to a Universe ticket?
- Which ticket state transitions grant, retain, or revoke application access?
- What buyer/attendee fields must be retained locally, and for how long?
- Who owns daily payment reconciliation and webhook monitoring?

Until these questions are resolved, Universe remains an evaluated integration,
not an approved payment dependency. **[Planned — unscheduled]**

## Official references

- [Universe developer portal](https://developers.universe.com/)
- [API options](https://developers.universe.com/docs/api-options)
- [GraphQL basic usage](https://developers.universe.com/docs/basic-usage-1)
- [Available API data](https://developers.universe.com/docs/what-data-is-available)
- [Client Credentials flow](https://developers.universe.com/docs/client-credentials-flow)
- [Authorization Code flow](https://developers.universe.com/docs/authorizing-with-oauth)
- [`embed2.js` integration](https://developers.universe.com/docs/embed2js)
- [Webhook guide](https://support.universe.com/hc/en-us/articles/360002563972-Sending-Universe-data-to-your-app-using-webhooks)
- [Widget callbacks](https://support.universe.com/hc/en-us/articles/360002563872-Direct-your-buyers-to-specific-pages-using-widget-callbacks)
- [Payment processing preferences](https://support.universe.com/hc/en-us/articles/360002387731-Payment-processing-preferences)
- [Supported payment methods](https://support.universe.com/hc/en-us/articles/360004232691-Which-payment-methods-does-Universe-support)

