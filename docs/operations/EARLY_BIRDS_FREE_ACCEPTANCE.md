# EarlyBirds Free acceptance

This sheet records the human release gate for the Free-first EarlyBirds MVP.
It never authorizes paid checkout, an app-store release, production promotion,
or an acoustic choice. Use only the isolated staging hosts and synthetic
`@e2e.invalid` identities.

## Fixed scope

- Listener: `https://earlybirds-staging.harmonicbeacon.com`
- Stream origin: `https://stream.harmonicbeacon.com`
- Membership path: signed one-use Free invitation only
- PayPal and Mercado Pago: disabled and expected to fail closed
- Google Play and Apple App Store: post-MVP
- Event application and `live.harmonicbeacon.com`: out of scope and unchanged

Do not paste the invitation or temporary team code into GitHub, test notes or
chat. Retrieve them directly on `mona` through the protected files documented
in `EARLY_BIRDS_STAGING_PREVIEW.md`. Use a new browser profile and a unique
`@e2e.invalid` address. The supervised invitation is one-use.

## Automated preflight

Record the exact webapp and authority SHAs, then require:

- webapp PR checks green;
- authority PR checks green;
- Listener, origin, both PostgreSQL databases and authority API/worker healthy;
- staging app/origin return HTTP 200;
- `live.harmonicbeacon.com/api/health` remains HTTP 200;
- canonical Free lifecycle smoke passes redeem, replay isolation, two-device
  eviction, revocation projection and post-revocation stream denial;
- paid checkout remains disabled.

## Human browser flow

For each row in the result table:

1. Open the signed invitation in a clean profile.
2. Confirm the page names staging and never displays a paid checkout.
3. Switch ES → EN → ES. Confirm labels change, `lang` follows the selection,
   no text clips and no horizontal scrolling appears.
4. Enter a synthetic display name, unique `@e2e.invalid` address and the
   protected team code. Confirm the code clears after submission and is absent
   from local/session storage.
5. Activate the invitation. Confirm the private Listener shows the chosen name
   and an active `FREE` membership, with no camera or microphone prompt and no
   LiveKit/event controls.
6. Reload and open a second device/profile. Both must retain access. Open a
   third device/profile with the same account only during the supervised
   lifecycle test; the oldest active lease must be displaced truthfully.
7. Exercise pause/resume and background/foreground recovery only with an
   approved staging audio artifact. If staging still uses the non-audio
   fixture, mark acoustic and physical playback rows `BLOCKED — audio approval`
   rather than passing them by appearance.
8. Revoke the disposable invitation through the authority. Existing playback
   must stop at the next bounded authorization check, a heartbeat must deny
   access, and reloading the private home must return to membership-required.

## Result record

| Date/time | Webapp SHA | Authority SHA | Device / OS | Browser | Locale | Free entry | 2→3 device | Revocation | No media permission | Audio | Tester / notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _pending_ | _pending_ | _pending_ | Desktop | Chromium | ES/EN | PENDING | PENDING | PENDING | PENDING | BLOCKED — audio approval | |
| _pending_ | _pending_ | _pending_ | Desktop | Firefox | ES/EN | PENDING | PENDING | PENDING | PENDING | BLOCKED — audio approval | |
| _pending_ | _pending_ | _pending_ | Android physical | Chrome | ES/EN | PENDING | PENDING | PENDING | PENDING | BLOCKED — audio approval | |
| _pending_ | _pending_ | _pending_ | iPhone physical | Safari | ES/EN | PENDING | PENDING | PENDING | PENDING | BLOCKED — audio approval | |

## Acceptance and rollback

Only Nico records the Free human acceptance decision. Failed rows stay failed
or blocked; they are not averaged into a pass. If staging degrades, close the
Listener/team-entry switches and run the isolated rollback from
`EARLY_BIRDS_STAGING_PREVIEW.md`. Retain the preview databases for audit and do
not touch the event runtime.
