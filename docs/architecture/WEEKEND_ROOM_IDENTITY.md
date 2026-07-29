# Weekend room identity and connection behavior

Each authorized principal has one stable, opaque stage identity per scheduled
event. The identity is an HMAC of the event ID and the database ticket or staff
ID; it never contains an email address or ticket code. Refresh and reconnect
therefore retain both the same floor identity and the current database-backed
publish grant.

LiveKit permits one connection per participant identity. If the same attendee
opens the event on a second device, the new stage connection replaces the old
connection instead of creating a second floor participant. The event-scoped bed
identity follows the same replacement rule and is always subscribe-only.

The room intentionally uses two LiveKit connections:

- the scheduled event stage for facilitator/participant voice and video;
- the configured `beacon` room for the playlist/live Beacon bed.

Only the paid event room mounts the bed audio provider. Its crossfader changes
the bed element gain and stage voice element gain independently.
