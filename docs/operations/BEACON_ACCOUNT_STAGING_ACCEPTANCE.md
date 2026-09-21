# Beacon Account staging acceptance

Use only a disposable experimental address and a password that is not reused
elsewhere. Never paste a password, action link or token into GitHub, chat, logs
or screenshots.

## Password contract

- Minimum: 8 characters.
- Maximum: 128 characters.
- No composition or complexity rules: digits, letters, spaces and symbols are
  not individually required.
- Passwords still use the versioned scrypt credential format. Email
  verification, rate limits, reauthentication and session revocation remain
  mandatory and independent of password length.

## Staging checklist

1. Start from `https://earlybirds-staging.harmonicbeacon.com` and enter the
   Account flow.
2. Create a credential account with preferred and private real names, disposable email and an
   8–128 character password, repeat it, and exercise the accessible show/hide
   control. Confirm mismatches stay client-side and the response is visible
   beside the submit action without revealing whether an address already
   exists.
3. Confirm the email sender is Harmonic Beacon and the action URL uses exact
   HTTPS host `account-staging.harmonicbeacon.com`.
4. Open the verification link within 15 minutes, then sign in and return to
   Listener staging.
5. Change both profile names, reload and confirm persistence. Single-word and
   international names and identical preferred/real names must work.
6. Sign out of the current device, sign in again and confirm the page remains
   usable throughout.
7. Request password recovery. Confirm the public response remains generic and
   a separate reset email arrives.
8. Complete reset within 15 minutes. Confirm the action token is one-use, the
   old password fails and the repeated new 8–128 character password succeeds.
9. Open a second browser session, choose all-device logout and confirm both
   product sessions converge to signed out.
10. Repeat the visible flow in ES and EN. Record only sanitized status and
    timestamps; never record credentials or action URLs.

This checklist does not authorize payments, Provider activation, production
Account, Live, events or audio changes.

## #567 Live profile acceptance (authorized private fixtures only)

- Start from a private Live staging fixture with a valid central session and an
  incomplete profile. Complete both names and verify return to the same event
  without another password prompt. Repeat with email/password and available
  Google identity; mocks do not prove external Google behavior.
- Confirm Listener still accepts the same central session without a new profile
  gate. Do not interrupt an already active Live participation for missing names.
- As ADMIN inspect the private identity projection; as other Staff and attendee
  confirm real name and email do not appear in public responses, chat or media.
- Exercise logout, alternate account, multiple tabs, stale revision, denied
  backchannel credentials and missing/unverified email. End the fixture normally.
- Use separate local databases for the Account/Listener and Live migration
  histories. Never combine their migration ledgers to obtain passing tests.
