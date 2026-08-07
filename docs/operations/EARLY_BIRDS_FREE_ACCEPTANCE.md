# Founding Listener public acceptance

This sheet records the human release gate for the bounded Founding Listener
public test at `https://listen.harmonicbeacon.com/`. It does not authorize paid
checkout, a worldwide campaign, an app-store release, a merge to `main`, an
event-stack change or an acoustic change.

Do not paste account details, OAuth material, invitation tokens, cookies or
temporary operator values into GitHub or test notes. Record only the tester,
device/browser, result and a non-sensitive symptom.

## Fixed candidate

- Listener application: `575b75aae5609b1813485d955a3e8ea753018084`
- Listener schema: `20260807070000_early_bird_free_schedule`
- Stream origin: `https://stream.harmonicbeacon.com`
- Approved intro languages: Spanish and English
- Ordinary Free access: registered account plus one recurring two-hour daily
  window, changeable again after seven days
- First access: one explicit account-bound 30-minute listen before selecting a
  recurring schedule
- Founding Listener access: canonical active membership projection
- Connections: at most two active devices per account
- Free for All: an independent reversible operator override, temporarily OFF
  for coordinated registered-Free acceptance
- PayPal and Mercado Pago: disabled for this acceptance and expected to fail
  closed
- Apple: absent until Apple Developer Program credentials and 2FA are supplied
- Event application and `live.harmonicbeacon.com`: out of scope and unchanged

Documentation may advance without rebuilding the application. Health must
attest the application SHA above rather than the current branch head.

## Automated preflight

Before a human session, require:

- PR #203 checks green;
- Listener liveness/readiness, PostgreSQL, origin and decoded canary green;
- health attests the exact application SHA and schema above;
- Alertmanager has no unexplained active critical alert;
- Google authorization reaches the exact Listener callback with one-time state
  and PKCE S256;
- missing or foreign browser Origin fails auth mutations closed;
- unconfigured Apple is absent, not a dead public button;
- registered Free selection is server-authoritative and a stream lease cannot
  outlive the active window;
- first-listen activation is explicit, idempotent, single-use and its leases
  and manifests cannot outlive the exact 30-minute server boundary;
- canonical Founder/invitation projection still outranks ordinary Free and
  terminal membership states fail closed;
- anonymous Free for All lease and ES/EN media ranges work while the override
  is ON;
- event production health remains unchanged.

## Human Google and ordinary Free flow

Free for All makes anonymous listening intentionally possible, so ordinary
registered-Free acceptance needs a short coordinated interval with that
override OFF. Restore it immediately after the flow if the public demo should
remain open.

1. Open the Listener in a clean browser profile. With Free for All OFF, choose
   Google and complete the real provider callback with a supervised test
   account.
2. Confirm the callback returns to `listen.harmonicbeacon.com`, creates only a
   Listener identity/session and never exposes provider tokens or requests
   camera/microphone access.
3. With a new account, press **Listen for 30 minutes now** and confirm access
   begins without selecting or locking a recurring schedule. Refresh and a
   second device must retain the original end rather than extending it.
4. With a second new account, choose **Listen free now** without starting the
   first listen. Confirm no first-listen row is consumed and the daily schedule
   is the only active grant.
5. Confirm the two-hour window is shown in the browser's local time together
   with the next window and the date/time when it can be changed again.
6. Begin **With introduction**. The intro may pause and seek. Confirm its
   natural completion hands off to the current Beacon live edge.
7. Stop, choose **Beacon only** and listen again. The Beacon exposes Stop but
   no Pause or Seek; listening again rejoins the current live point.
8. Change the intro selector. Spanish must play the Spanish Amara Sol asset and
   English the English asset. The browser locale chooses the initial UI/intro;
   the selector overrides only the intro.
9. Reload, background/foreground the browser and reconnect the network once.
   The UI must remain truthful, avoid duplicate playback and recover or offer
   one clear retry.
10. Open the same account on a second device; both may listen. A supervised
   third active device must displace only the oldest lease and explain that
   state truthfully.
11. Confirm logout is available both during and outside the Free window. After
    logout, the Listener session endpoint must be anonymous.
12. At the exact first-listen and Free-window boundaries, playback must stop after the bounded
    authorization horizon and a new lease/manifest must fail until the next
    window. This row may be exercised with a synthetic clock in automation and
    one shorter supervised server-side fixture rather than waiting two hours.
13. Leave the waiting page open across a scheduled start, and the player open
    across an end. Both views must update from server authority without a
    manual reload.

Do not change the selected schedule merely to repeat a test: the seven-day lock
is product behavior. Use a separate supervised account for a custom future
time. DST gap/ambiguity, idempotency and cooldown are covered by automated
tests; physical acceptance only confirms local-time comprehension.

The first supervised real-provider pass completed Google callback, logout and
sign-in again on 2026-08-07. A custom window selected one minute ahead became
authorized by the server and entered Listener after reload. The open waiting
page did not refresh itself at the boundary; #216 now has an implementation
that must be confirmed in the next deployed acceptance. The
sanitized server audit confirmed one recent identity/session, exact seven-day
cooldown, scrubbed OAuth tokens and no stored session IP or user-agent.

## Free for All operator flow

1. With the override OFF, verify an anonymous lease and manifest fail closed.
2. Enable only the isolated Listener override and recreate only that app.
3. Verify health, then confirm anonymous playback works without creating an
   account, Free schedule, membership or Purchase.
4. Disable it and verify denial again; re-enable it only if the current public
   demo decision requires it.

Existing signed manifests or already buffered media may drain for the short
signature/manifest horizon. This is expected and must not be described as
instant revocation.

## Physical acceptance matrix

| Date/time | Device / OS | Browser | Locale | Google callback | Free schedule | Intro / handoff | Beacon live edge | 2→3 devices | Reconnect | Logout | Tester / notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _pending_ | Desktop | Chromium | ES/EN | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| _pending_ | Desktop | Firefox | ES/EN | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| _pending_ | Android physical | Chrome | ES/EN | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| _pending_ | iPhone physical | Safari | ES/EN | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |

Run one 60-minute physical listen covering intro, handoff, Stop/restart,
background/foreground and a network transition. Report audible glitches as a
human signal only; do not alter codec, gain, buffers or routing from this sheet.

## Acceptance, external blockers and rollback

Only Nico records the public-test acceptance decision. Failed rows stay failed
or blocked; they are not averaged into a pass.

Apple's exact external blocker is an authenticated Apple Developer Program
Account Holder/Admin with 2FA, a primary App ID with Sign in with Apple, a
Services ID associated with that App ID, the `listen.harmonicbeacon.com` and
staging domains/absolute callback URLs, Team ID, Key ID, the one-time-download
private `.p8` key and a generated client-secret JWT. The Services ID is the
OAuth client ID. It must remain absent until all material exists; the private
key/client secret must be delivered and installed securely, never committed or
pasted into GitHub. A normal Apple Account on an iPhone is sufficient for the
physical login test only after this developer configuration exists.

If the isolated Listener degrades, restore root-only
`/etc/harmonic-beacon/earlybirds-preview.env.pre-575b75a`, select Listener image
`d7ed952`, retain both preview databases and origin media, and run the preview
health smoke. Do not touch the event runtime.
