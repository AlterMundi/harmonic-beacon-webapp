# Session contributions — questions and emotions contract (CHAT-01)

> **Status: Draft — pending validation.** Present-tense statements here
> describe code that exists in `main` (or in the pull request that introduces
> this document). What is not built is tagged `[Planned — CHAT-02]` or
> `[Planned — PMP]`, per the convention in
> [docs/README.md](../README.md#describing-what-is-not-built-yet).

*Draft · 2026-08-05 · CHAT-01 (#137), child of CHAT-00 (#127)*

During a live session, each attendee can publish the question they are holding
and the emotion that travels with it, in one plain-text message. Publication
is immediate; moderation happens afterwards. This document is the canonical
contract for that surface.

## 1. Canonical rules

- One text field holds question and emotion together. There is no structured
  emotion taxonomy, no DMs, no threads, no reactions, and no editing after
  publication.
- Closing the composer or leaving without sending creates nothing.
- Every message has a per-message visibility chosen at send time:
  - `NAMED` — the audience and staff see the author's room display name.
  - `ANONYMOUS` — the audience sees an anonymous label localized by the
    client ("Anónimo" / "Anonymous"). Authorized staff still see the real
    author plus an explicit indicator of how the audience sees the message.
- Anonymous means anonymous to the audience. It never means anonymous to
  staff, and it never detaches the message from its internal author.
- The message stays internally correlated with the person for a future
  personal follow-up. That follow-up and any propagation to the PMP are not
  built. `[Planned — PMP]`
- Retention lasts until consent withdrawal. Withdrawal, moderation
  transitions, close/reopen of the feed, report UI, tombstones and the
  post-event procedure belong to CHAT-02. `[Planned — CHAT-02]`

## 2. Data model

`SessionContribution` (table `session_contributions`):

| Column | Meaning |
|---|---|
| `id` | Opaque UUID. The only identifier any client ever sees. |
| `scheduled_session_id` | Owning session; `ON DELETE CASCADE`. |
| `author_participant_id` | Internal author (`SessionParticipant`); `ON DELETE RESTRICT` so a participant with contributions cannot be deleted underneath them. |
| `author_display_name` | Snapshot of the room display name at publish time; the public feed stays stable even if the name changes later. |
| `body` | Normalized plain text (see §4). |
| `visibility` | `NAMED \| ANONYMOUS`. |
| `state` | `VISIBLE \| HIDDEN \| WITHDRAWN`, default `VISIBLE`. The hidden/withdrawn states exist from the first migration so CHAT-02 needs no destructive change; no transition operations ship in CHAT-01. |
| `idempotency_key` | Client-generated opaque key, 1–128 chars. |
| `request_digest` | `CHAR(64)`, sha256 of `visibility + "\n" + normalizedBody`. |

Constraints:

- `UNIQUE (scheduled_session_id, author_participant_id, idempotency_key)` —
  one canonical row per retried submission.
- `INDEX (scheduled_session_id, state, created_at, id)` — the bounded,
  stable feed order.

## 3. Identity contract

The client **never** sends participant ID, author ID, ticket entitlement ID,
LiveKit identity, staff user ID, or anyone else's session identity, and the
server never reads them from the payload. The author is resolved exclusively
from the authenticated `hb_session` web session via the same read-only
`resolveRoomViewer` gate the polling sidecars use, and linked to the
`SessionParticipant` row keyed by `(scheduledSessionId, ticketEntitlementId)`.

An attendee must already have a participant row to publish — joining the room
materializes it. Publishing before joining is rejected with
`participant_not_joined` (409) rather than silently materializing presence,
because a contribution write must not masquerade as a room join.

## 4. Body validation

- NFC normalization, CRLF/CR collapsed to LF, outer whitespace trimmed.
- Empty after normalization → `empty_body` (400).
- Maximum 1000 Unicode **code points** (emoji are not double-charged) →
  `body_too_long` (400). Client-side validation mirrors the same limit.
- Plain text only; markup is stored and rendered as inert text (React escapes
  on render). Unicode is preserved.
- No derived variants of the body are stored or logged. Logs and error
  payloads never contain the body (`no-pii-in-logs.test.ts` sweeps every
  `console.*` call).

## 5. DTOs — separate by audience, built explicitly

**PublicContribution** — what the audience and the author receive:

```json
{ "id", "body", "displayName": "Ana" | null, "visibility", "createdAt" }
```

`displayName` is the room name for `NAMED`, `null` for `ANONYMOUS` (the
client renders the localized anonymous label). The object has exactly those
five fields: no participant ID, author ID, ticket ID, email, session ID or
LiveKit identity — not even null-valued.

**StaffContribution** — what authorized staff receive:

```json
{ "id", "body", "authorDisplayName", "participantIdentity", "visibility",
  "audienceAnonymous": true | false, "state", "createdAt" }
```

`participantIdentity` is the opaque stable room identity staff already
operate in the participants console — never the ticket ID, email or user ID.

## 6. Endpoints

All routes are `force-dynamic` and answer `Cache-Control: no-store`.

### `POST /api/scheduled-sessions/[id]/contributions`

Publishes one contribution. Attendees only (a `BOUND` ticket for this
session, session `LIVE`); staff observe from the ops console and receive 403.

Request: `{ "body": string, "visibility": "NAMED" | "ANONYMOUS", "idempotencyKey": string }`

Responses:

- `201` — created; body is the canonical PublicContribution.
- `200` — idempotent replay; same body, the pre-existing canonical row.
- `400` — `invalid_request` (malformed/non-object JSON), `invalid_body`,
  `empty_body`, `body_too_long`, `invalid_visibility`,
  `invalid_idempotency_key`.
- `401` — unauthenticated. `403` — cross-session, staff, or non-LIVE session.
- `404` — unknown session (nothing else leaks).
- `409` — `idempotency_key_conflict` (same key, different payload),
  `participant_not_joined`.
- `429` — `rate_limited`, with `Retry-After` seconds and
  `retryAfterSeconds` in the body.

### `GET /api/scheduled-sessions/[id]/contributions?cursor&limit`

The bounded public feed for any authorized viewer of the session (attendee or
staff). Only `VISIBLE` rows, ascending `(createdAt, id)` order. `limit`
defaults to 50, max 100 (`invalid_limit` 400 otherwise); `cursor` is the
opaque cursor from a previous page (`invalid_cursor` 400).

Response:

```json
{ "contributions": PublicContribution[], "hasMore": false,
  "nextPageCursor": null, "resumeCursor": "..." }
```

The envelope deliberately separates **draining a backlog** from **polling for
new messages**:

- `hasMore` — the page was truncated; more rows exist right now.
- `nextPageCursor` — where to continue draining; set only when `hasMore`.
- `resumeCursor` — cursor of the **last delivered item**, usable for
  incremental polling even at the tail (`hasMore=false`,
  `nextPageCursor=null`). On a truncated page `nextPageCursor` equals
  `resumeCursor`.
- An empty page (a poll that finds nothing after the client's cursor) returns
  zero items with `hasMore=false` and **both cursors null** — the client keeps
  polling with the cursor it already had, which stays valid.

Suggested client poll: 5 seconds.

### `GET /api/ops/sessions/[id]/contributions?cursor&limit`

The staff reading: `VISIBLE` + `HIDDEN` rows (there is no withdrawal path yet),
same ordering and **the exact same page envelope** as the public feed, for
staff whose `eventStaffPolicy` grants `canOperateEvent` — the assigned
facilitator, facilitator-operators, operators and admins. An unassigned
facilitator receives 403. Response items are `StaffContribution[]`.

## 7. Idempotency

The retry of a successful submission can never duplicate a message. The
creation order is part of the contract:

1. validate and normalize the payload;
2. resolve the participant;
3. look up `(session, participant, idempotencyKey)`;
4. an existing row decides **replay (200)** or **conflict (409)** immediately —
   neither touches the rate-limit budget and neither is ever hidden behind a
   429, even when the participant's window is exhausted;
5. only a genuinely new key enters the per-participant serialized section
   (see §8), where idempotency is **re-checked** (a twin request may have
   created the row while this one queued), the budget is consulted, and a
   slot is reserved before the INSERT;
6. the reservation is kept when a row is created, and released when the
   INSERT fails or a P2002 resolves to replay/conflict.

Guarantees:

- Unique key `(session, participant, idempotencyKey)`; a replay with the same
  `requestDigest` returns the canonical row with 200 and performs no write.
- A key reused with a different payload is rejected 409.
- Concurrent first submissions are decided by the per-participant lock
  in-process and by the unique index across processes; the loser re-reads the
  winner and replays (or conflicts) canonically — proven against real
  PostgreSQL in `session-contributions.integration.test.ts`
  (`CONTRIBUTIONS_INTEGRATION_TEST=1`, run in CI on every PR).
- The client generates one key per composer draft, so double clicks, timeout
  retries, refreshes and reconnects all resolve to one row.

## 8. Rate limiting

Per participant and session (never per IP — attendees can share one network),
a process-local sliding window of **5 submissions per 60 seconds**. Only
accepted submissions spend budget; validation failures, idempotent replays
and conflicts are free. The 429 carries `Retry-After` and a
`retryAfterSeconds` field so the client can back off precisely. The limiter's
log lines carry no body and no PII.

**Atomicity.** Checking the budget and recording the consumption as separate
steps races: N concurrent requests would all see budget before any of them
records. `SubmissionLimiter.withSlot()` therefore serializes the whole
critical section per limiter key — re-check idempotency, prune the window,
decide, **reserve a slot before the INSERT**, then keep the reservation
(created row) or release it (failed INSERT, P2002 replay/conflict). Different
participants never block each other, and idle locks are dropped so the lock
map cannot leak. Six concurrent submissions by one participant create exactly
five rows and one 429 — proven in unit tests and against real PostgreSQL in
CI.

**Limitation (unchanged).** The limiter is process-local and the launch uses
a single app instance. It is **not** safe across multiple replicas: a second
instance would silently multiply the budget. The only inter-process guarantee
is the database's unique idempotency index.

## 9. Authorization matrix (tested)

| Caller | POST create | GET public feed | GET staff feed |
|---|---|---|---|
| Attendee, ticket for this session, LIVE | 201/200 | 200 | 403 |
| Attendee, ticket for another session | 403 | 403 | 403 |
| Attendee, session ENDED / not LIVE | 403 | 403 | 403 |
| Unauthenticated | 401 | 401 | 401 |
| Assigned facilitator | 403 | 200 | 200 |
| Facilitator of another event | 403 | 403 | 403 |
| OPERATOR / ADMIN / FACILITATOR_OP | 403 | 200 | 200 |
| Unknown session | 404 | 404 | 404 |

## 10. What this contract deliberately does not include

- Moderation transitions (hide, restore, withdraw), feed close/reopen, report
  UI, audit entries, tombstones, and the post-event withdrawal procedure.
  `[Planned — CHAT-02]` The `HIDDEN` and `WITHDRAWN` states already exist so
  these arrive without a destructive migration.
- Propagation to the PMP and the personal follow-up reading.
  `[Planned — PMP]`
- Real-time push. Polling is intentional: bounded, recoverable, and proven
  across the room's other sidecars.
