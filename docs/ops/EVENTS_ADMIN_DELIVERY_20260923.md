# Events delivery and administration

Owner authorization: publish the prepared September 23 events first, then
complete event administration without per-event code changes. Preserve Account,
current participants, payment contracts and active media sessions.

## Sequence

1. Base on the actual Live release, port PR580 without reverting Account, and
   qualify the exact candidate. Keep September23 10:00/18:00 ART unchanged.
2. Use the existing reviewed migration bridge v2, not the held legacy deploy.
   Verify installed bytes, prior transaction, exact image/schema inventory,
   mounted backups and absence of active sessions. Preserve the prior receipt
   and images before starting another candidate. Rehearse restore, migration,
   old binaries and candidate on the isolated database; apply only after proof.
3. Verify public listing, authentication and waiting-room admission without
   sending mail, exercising payments or manufacturing human attendance.
4. Implement staff-authorized event CRUD/publication in the existing ops panel.
   Store publication and admission settings in PostgreSQL; eliminate per-event
   source allowlists. Preserve Account identity checks and historical sessions.
   Archive/cancel instead of deleting records with participants or entitlements.
5. Test denied/authorized writes, validation, time zones, duplicate submissions,
   publication/access consistency and existing paid/free entry; qualify and
   deploy the exact candidate with recovery evidence.
6. Document one supported operator path and Saira's product-role access;
   distinguish Linux access from Account/staff authorization. Verify the panel
   through an isolated synthetic operator before human acceptance.

## Current evidence and limits

Contrary to the initial diagnosis, `deploy/MIGRATION_BRIDGE.md` and its helper
exist in release. Mona reports the v2 helper installed, with a prior applied
transaction and fence absent. This is not yet proof that it is reusable with
the next candidate. The held legacy workflow stays held; OCI activation is
not inferred or manufactured. A supported complete migration delivery path
does not require enabling every alternative delivery mechanism.

No restart during an active session. No alteration of participant identities,
prior acceptance, payments or credits. No dates changed without direction.
