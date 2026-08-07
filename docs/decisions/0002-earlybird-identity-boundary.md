# EarlyBird identity is separate from event and staff identity

*Accepted 2026-08-06 for the EarlyBirds milestone.*

## Decision

EarlyBirds uses an exact stable Better Auth release with configured Google and
Apple providers plus an optional one-use email magic-link fallback through the
existing private mail authority.
It owns additive `EarlyBirdAccount`, provider identity and session data, a
separate `hb_earlybird_session` cookie and namespaced routes. Cross-provider
account linking and Facebook are disabled.

The email fallback was added on 2026-08-07. Its random token is stored only as
a verifier, expires after ten minutes and is consumed once. It never silently
authenticates a Listener whose address is already owned by a social or
supervised identity; explicit account linking remains outside this milestone.

An EarlyBird session can request a current membership projection and signed
media lease. It can never create a staff principal, an event ticket principal,
a LiveKit token or an event capability. Provider subject is the external key;
verified email is contact evidence and never an authorization key.

## Security invariants

- Authorization Code, PKCE, state and nonce are mandatory.
- Provider tokens are not retained without a new reviewed requirement.
- Two active device leases are allowed; a third evicts the oldest lease.
- Logout, account disable and membership revoke invalidate future media leases.
- The product stores no minor profile or minor-specific data; an adult owns the
  account and payment.
- A dependency install must pass the repository's ordinary clean CI install;
  no hidden local package-manager flag is an accepted runtime dependency.

## Rollback

Disable the EarlyBird feature flag and its OAuth callbacks. Additive identity
rows remain inert. Event and staff sessions continue unchanged.
