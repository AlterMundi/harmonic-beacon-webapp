# `hb.analytics.event.v1`

All times are UTC instants. Producers create UUIDv4 `event_id` values and retry the same ID after
an ambiguous response. Unknown top-level fields are rejected. Event names use domain/action form,
for example `page.viewed`, `account.created`, `listener.playback_started`,
`live.presence_started`, `membership.activated` and `payment.confirmed`.

Browser producers may emit page, CTA, form-state, playback-control and visible-error events only.
The account, membership, payment, authorization and duration families are accepted as canonical
facts only from authenticated server producers or deterministic backfills.

Prohibited anywhere in `properties`: password, passphrase, token, secret, authorization header,
signed URL, payment instrument/number, raw email, audio/video/chat contents and arbitrary form
values. Provider identifiers remain in the owning operational system; analytics uses opaque
source keys or HMAC subjects.
