# Event administration

The staff surface is `/ops/events/manage`, linked from `/ops/events` for
`ADMIN` and `FACILITATOR_OP`. Staff authorization is resolved from the current
Beacon Account binding on every API request; server SSH access is unrelated.

Create starts hidden. The form controls title, description, language, date,
explicit time zone, facilitator, complimentary entry and publication.
Supported time zones: Argentina, Costa Rica, UTC. Saving converts the selected
wall time to UTC; the stored zone is used when reopening the form.

Publication is not room lifecycle: it makes a scheduled event discoverable;
opening a room remains the existing lifecycle operation. Editing is restricted
to SCHEDULED events. Duplicating generates a new ID, requires a new date and
does not copy participants, grants, contributions or publication. Cancellation
uses the existing lifecycle/termination endpoint and retains history; no hard
delete is exposed.

Free admission is governed by the database's `publicAccess` and `isPublished`,
not an ID list compiled into the application. The free admission transaction
locks and rechecks the event before granting access, serializing with editor
and lifecycle updates. Hiding prevents new complimentary admission and removes
the listing; already-issued tickets remain valid. This is not access revocation.

Existing events default to published in the additive migration. Existing paid
flows retain their fallback checkout URLs. A per-event HTTPS Ticket Tailor URL
can be stored, but does not automatically configure commerce mappings or create
a Ticket Tailor event. Full paid-event provisioning remains separate; never
claim that adding a checkout link alone proves payment/access integration.

Creates accept a stable client UUID and serialize retries; updates require the
last `updatedAt` and reject stale edits. Changing admission type/facilitator is
blocked after tickets are issued. Mutations produce audit entries without
participant content. API writes require same-origin requests and a current
staff principal; data responses are private/no-store.

The owner-authorized initial OPERATOR → FACILITATOR_OP promotion uses
`scripts/live-production/promote-event-manager.ts`: root-only fixed private
request, exact existing staff ID/binding/subject, dry-run by default and explicit
`--apply`. It rejects disabled or mismatched bindings, preserves identity, locks
the row, records an audit entry and is idempotent. It creates no Account and
does not grant roles by a matching display name or email.

## Acceptance

Focused tests cover role denial, input validation, duplicate creation, stale
updates, publication, hidden/paid admission, browser-form conversion and copy.
`scripts/event-editor-postgres-test.ts` is explicitly restricted to loopback
database `beacon_event_test`. After applying migrations to a disposable database,
it checks populated seed/replay, concurrent creation, one audit record,
publication without LIVE transition and absence of tickets/participants.
Its fixture is synthetic and the disposable database is removed after testing.

Before delivery: hosted selected checks, isolated restored-database rehearsal,
prior-binary recovery and production continuity preflight. After delivery:
verify staff login, create/duplicate/edit/hide/publish in an isolated fixture,
then authenticated waiting-room admission. No live payments as smoke tests.
