# amplification-credit-entries.v1 shared contract

Copy this directory byte-for-byte into the Myth Bot repository. `SHA256SUMS`
covers the schema, both synthetic fixtures, and this README; consumers should
refuse integration when any hash differs.

`GET /api/internal/v1/amplification-credit-entries` authenticates with
`Authorization: Bearer <token>` plus `X-HB-Service-Key-Id`, using Beacon's
current/previous commerce service key rotation. It returns at most 100 entries
in ascending `(entered_at, entry_id)` order. Each `entry_id` is the stable
Beacon `SessionParticipant.id`; reconnect intervals collapse into the
participant's earliest server-observed `LivePresenceInterval.startedAt`.

`next_cursor` is an opaque durable resume position, not a decoded client data
structure. Every non-empty page advances it to the last returned entry. An
empty poll echoes the validated supplied cursor (or returns `null` only when no
cursor was supplied), so the consumer can persist its position and later poll
without replaying the feed. Consumers must commit the entries and cursor in one
database transaction and must not advance the cursor when that transaction
fails.

The full fixture includes one commerce-backed paid ticket and one free ticket.
The free entry deliberately has nullable registration, email, and display name.
All values are synthetic and carry no production identity.
