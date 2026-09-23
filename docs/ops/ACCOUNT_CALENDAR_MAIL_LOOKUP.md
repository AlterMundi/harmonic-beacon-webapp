# Calendar mail: current mailbox lookup (dormant)

Purpose: confirm the current Account mailbox immediately before a calendar email.
This is not an OAuth client, login, account creation or permission to contact.
PMP remains responsible for calendar eligibility and contact consent.

POST `/api/account/calendar-mail-profile` on the Account host with JSON
`{"sub":"<Account subject>"}`. Response is only `sub,email`; no names,
verification claim, session tokens, evaluations or content. Missing and synthetic
placeholder accounts return404. Responses are private/no-store.

Disabled unless `BEACON_ACCOUNT_CALENDAR_MAIL_ENABLED=1` and a dedicated
`BEACON_ACCOUNT_CALENDAR_MAIL_SERVICE_SECRET` (at least32 characters) is installed
privately. HTTP Basic username is exactly `pmp-calendar-mail`. The credential
does not grant any OAuth scopes or access to the existing admin-profile endpoint.
Do not copy hb-live, Psicopompo OIDC or Gmail credentials.

Myth Bot receives a private0600 JSON `{client_id,client_secret}`, sets
`PMP_MYTH_CALENDAR_MAIL_ACCOUNT_CLIENT_FILE`, the canonical Account issuer and
`PMP_MYTH_CALENDAR_MAIL_ACCOUNT_LOOKUP_URL` to this HTTPS route. No secret is
checked in or included in the fixture. Unavailable lookup or changed mailbox
prevents calendar delivery. Confirm host/TLS in the deployment lane before enabling.

Implementation authorized by Mariano through request
`pmp-calendar-mail-implementation-20260923`. This PR does not deploy, install
credentials, enable flags or send email. Tests use only synthetic fixtures.
Rollback: disable this specific flag; mail transport fails closed. Login, Live,
Listener and existing mail purposes remain unchanged.
