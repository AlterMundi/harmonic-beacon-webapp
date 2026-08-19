# Beacon Account social providers

Google and Apple belong only to the central Beacon Account authority. Listener
and Live are confidential OIDC relying parties; they must not receive provider
client secrets, provider tokens, or direct social callbacks.

Both providers are independently default-off. A disabled provider is absent
from the Account UI. A readiness result of `providers: ok` means that the
configured enabled/disabled state is internally valid; it is not evidence that
a disabled provider has completed human acceptance.

## Fixed security contract

- Staging authority: `https://account-staging.harmonicbeacon.com`.
- Production authority: `https://account.harmonicbeacon.com`.
- Google uses Authorization Code, the Account-owned state cookie, and
  `prompt=select_account` with online access. Account switching must remain
  explicit.
- Apple uses its Services ID as the OAuth client ID and a current ES256
  client-secret JWT. Raw `.p8` material is never installed in the application.
- An Account has exactly one access method: verified email/password, Google,
  or Apple. Matching email never links or merges accounts.
- Provider access, refresh, and ID tokens are not authorization keys for
  Listener, Live, membership, staff, tickets, or events.
- Provider secrets and account identifiers never belong in Git, GitHub, chat,
  screenshots, shell arguments, browser storage, metrics, or logs.

## Google Cloud setup

Create separate **Web application** OAuth clients for staging and production.
Do not reuse the legacy direct-Listener client.

Register exactly one callback on each client:

- staging:
  `https://account-staging.harmonicbeacon.com/api/account/auth/callback/google`
- production:
  `https://account.harmonicbeacon.com/api/account/auth/callback/google`

The Account flow does not require a sibling product origin or callback. If the
Google consent screen remains in Testing, add only the intended human testers.
The application requests the provider's ordinary identity scopes; Google email
is profile data, never membership or linking authority.

Prepare the client ID and secret only in the corresponding root-owned provider
bundle. The activation lifecycle, rather than a manual edit, installs them in
the Account environment:

```text
BEACON_ACCOUNT_GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
BEACON_ACCOUNT_GOOGLE_CLIENT_SECRET=<secret>
```

Use exactly one of these fixed files, owned by `root:root` with mode `0600`:

- `/etc/harmonic-beacon/account-provider-staging-google.env`
- `/etc/harmonic-beacon/account-provider-production-google.env`

Never place staging and production credentials in the same bundle or runtime.

## Apple Developer setup

An Apple Developer Program Account Holder or Admin with 2FA must create or
confirm:

1. a primary App ID with Sign in with Apple enabled;
2. a Services ID for Beacon Account;
3. the exact Account web domain and return URL for the target environment;
4. Team ID, Key ID, and a Sign in with Apple private `.p8` key;
5. an ES256 client-secret JWT with:
   - header `alg=ES256` and `kid=<Key ID>`;
   - `iss=<Team ID>`;
   - `sub=<Services ID>`;
   - `aud=https://appleid.apple.com`;
   - a valid `iat` and an `exp` no more than six months later.

The exact Apple callbacks are:

- staging:
  `https://account-staging.harmonicbeacon.com/api/account/auth/callback/apple`
- production:
  `https://account.harmonicbeacon.com/api/account/auth/callback/apple`

Generate the JWT offline from the protected `.p8`. Put only the Services ID and
generated JWT in the target provider bundle:

```text
BEACON_ACCOUNT_APPLE_CLIENT_ID=<services-id>
BEACON_ACCOUNT_APPLE_CLIENT_SECRET=<current-es256-jwt>
```

Use exactly one of these fixed files, owned by `root:root` with mode `0600`:

- `/etc/harmonic-beacon/account-provider-staging-apple.env`
- `/etc/harmonic-beacon/account-provider-production-apple.env`

The application rejects a raw `.p8`, a malformed JWT, the wrong audience or
subject, and an expired JWT. Apple may provide name and email only on first
consent. Later callbacks without them remain bound by Apple subject and use a
neutral provider-independent Beacon profile; they never trigger email linking.

## Safe staging activation

Do one provider at a time.

1. Confirm the exact reviewed release, clean checkout, exact running image and
   root-owned deployment coordinates.
2. Create the exact two-line provider bundle at the fixed path above. Do not
   pass either value on a command line and do not print the file.
3. Run, for example:

   ```sh
   sudo scripts/beacon-account/activate-social-provider.sh \
     staging google /etc/harmonic-beacon/beacon-account-deploy.env
   ```

   The lifecycle creates and verifies a fresh encrypted database backup,
   stores the prior Account environment in a root-only rollback directory,
   builds a complete candidate environment inside the exact image with no
   network, and validates the complete production/staging pair before any
   cutover. There is no installed-but-disabled intermediate state.
4. The lifecycle atomically replaces only the target Account environment and
   recreates only the target Account app. It does not recreate the mail worker,
   database, Listener, Live, event, stream, or payment services. Any readiness,
   discovery, JWKS, or provider-visibility failure automatically restores the
   previous environment and app.
5. Require Account readiness at the exact candidate SHA with
   `checks.providers=ok`. Confirm the Account page shows only the provider just
   enabled and email/password remains available.
6. Complete supervised human acceptance before enabling the other provider or
   touching production.

The successful command prints a root-only rollback-state path. Manual rollback
uses that exact state and the same deployment coordinates:

```sh
sudo scripts/beacon-account/rollback-social-provider.sh \
  /var/lib/harmonic-beacon/account-social-providers/<exact-state> \
  /etc/harmonic-beacon/beacon-account-deploy.env
```

Rollback restores the complete prior environment and recreates only the
Account app. Disabling a provider hides new sign-in without deleting accounts,
profiles, sessions, or product data. Do not delete provider identities as
rollback.

## Human acceptance

For each provider, use two distinct disposable staging identities and record
only sanitized pass/fail evidence.

- Complete first consent and the exact Account callback.
- Confirm the canonical Beacon display name can be edited and survives reload.
- Enter Listener through Account SSO without another provider prompt.
- Sign out the current device and sign in again.
- Deliberately switch A to B and back to A. The first Listener render, reload,
  back/forward, bfcache restoration, and duplicate tab must never retain the
  previous account's profile, Founder state, or authorization.
- Exercise a delayed callback, back-button callback, replay, and state mismatch.
  They must fail closed without weakening state or creating a redirect loop.
- For Apple, cover private relay, first-consent name/email, and a repeat callback
  where name/email may be absent.
- Confirm no email-based merge, provider-token persistence in product sessions,
  membership mutation, payment call, event capability, or audio change.

## Production promotion and rotation

Production remains off until staging acceptance is complete and the production
Account DNS/TLS edge, backup, migration, static-client inventory, mail path,
Listener/Live RP cutover, and rollback are independently ready. Promote Google
and Apple separately; staging success for one provider does not authorize the
other.

Rotate a Google secret by installing the replacement with the provider still
enabled, recreating only Account, completing readiness and a real sign-in, and
then revoking the old secret in Google Cloud. Rotate an Apple client-secret JWT
before expiry using the same reviewed Team ID, Key ID, Services ID, and
protected `.p8`; verify readiness and a real sign-in before retiring the old
JWT. Key revocation and ordinary JWT rotation are separate operations.
