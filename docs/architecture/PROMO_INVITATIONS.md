# Controlled promotional invitations

Status: implemented behind `PROMO_INVITATIONS_ENABLED=false` by default.

## Boundary

A promotion campaign is a staff-created, session-scoped way to mint a normal
`TicketEntitlement` with tier `COMP`. It is not an authentication bypass and it
does not change the private Ticket Tailor commerce contract. After redemption,
the existing `WebSession`, room-entitlement, LiveKit token, revocation and
participant paths are authoritative; promotion provenance is the one-to-one
`PromoRedemption` relation.

The raw human code exists only in the staff member's browser while the campaign
is created and in the invited person's possession. Beacon persists an HMAC
digest domain-separated from ticket credentials. API responses, audit metadata
and logs never contain the raw code or the redeemer email.

## Threat model and invariants

| Threat | Control |
| --- | --- |
| Brute force / enumeration | Same generic rejection and shared 20-failures-per-10-minute auth budget as tickets; outer Nginx/Cloudflare limit remains required. No response distinguishes unknown, disabled, expired, exhausted or wrong-email codes. |
| Replay by the same person | Idempotent by campaign plus normalized-email HMAC. It creates a fresh `WebSession` for the same entitlement, never another seat. |
| Shared code | Every distinct email consumes one bounded redemption and one event seat. Capacity can be 1; short campaigns expire within seven days. |
| Last-slot race | Redemption locks the event row used by paid/import/comp issuance and then the campaign row before counting or incrementing. Concurrent contenders cannot exceed either cap. |
| Cross-session use | The campaign selects the session server-side. The public request cannot provide or override a session id. |
| Disabled/expired campaign | New redemptions fail generically. Existing entitlements continue normally unless staff explicitly chooses derived revocation. |
| Derived revocation | The disable API requires an explicit boolean. With revocation selected it atomically revokes entitlements and web sessions, closes durable participant grants, then removes both stage and bed LiveKit identities. A 202 response exposes cleanup failure only to staff and the action is retryable. |
| Feature exposure | Public redemption is impossible unless the exact server flag is `true`. Campaigns can be prepared while it is false. Production templates remain false. |

Campaign codes are 6–15 uppercase letters/digits with optional internal hyphens.
This is intentionally lower entropy than a ticket credential, so small capacity,
short expiry and rate limiting are non-negotiable. Use a high-entropy normal
ticket or comp code when a publicly shareable link is acceptable.

## Rollout

1. Deploy the additive migration with the flag still false.
2. In Admission support, create a session-scoped campaign with the smallest
   useful capacity and expiry.
3. Rehearse create → redeem → refresh → fresh-browser replay → disable with
   derived revocation. Confirm stage and bed identities disappear.
4. Set `PROMO_INVITATIONS_ENABLED=true` and redeploy only when the campaign is
   ready to distribute.
5. The immediate kill switch is setting the flag false. This stops new public
   redemption without invalidating paid or already-redeemed access.

Rollback the application before rolling back the additive tables. Existing
promo-derived `TicketEntitlement` rows remain valid ordinary COMP access even if
the UI and redemption code are removed. Never drop the tables while such rows
still need provenance or campaign-level revocation.
