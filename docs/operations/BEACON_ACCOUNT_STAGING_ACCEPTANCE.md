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
2. Create a credential account with a display name, disposable email and an
   8–128 character password, repeat it, and exercise the accessible show/hide
   control. Confirm mismatches stay client-side and the response is visible
   beside the submit action without revealing whether an address already
   exists.
3. Confirm the email sender is Harmonic Beacon and the action URL uses exact
   HTTPS host `account-staging.harmonicbeacon.com`.
4. Open the verification link within 15 minutes, then sign in and return to
   Listener staging.
5. Change the Beacon display name, reload and confirm persistence.
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
