# Psicopompo Account client

Status: implementation candidate; not registered or activated.

## Confirmed contract

Coordination: `msg_aa4f2c953123`, thread `msg_f38a274d09a8`.
Account owns client registration; PMP owns its backend, sessions and tests.

- Issuer: `https://account.harmonicbeacon.com`.
- Client: `hb-psicopompo`; confidential Authorization Code, PKCE S256,
  `client_secret_basic`, scopes `openid profile email`.
- Exact GET callback, query response:
  `https://psicopompo.altermundi.net/api/auth/beacon/callback`.
- Binding: issuer + subject, never email. Complete profile required.
- Local logout only; no registered logout callback. No refresh/offline access.
- PMP revalidates every 15 minutes, fail-closed; backend token custody.
- Private exchange: `/mnt/m2-1TB/PMP-GPT/.runtime/secrets/beacon-oidc-client.json`,
  root-owned directory 0700 and file 0600, JSON client_id/client_secret.
- No credits, account merges, participant changes or calendar implementation.

## Implementation and rollout

1. Extend the static inventory behind `BEACON_ACCOUNT_PSICOPOMPO_ENABLED=1`;
   default off preserves existing client inventory/readiness. No staging client
   is invented for the production callback.
2. Support a client without logout redirect in provisioning/readiness and skip
   it in central logout notifications. Preserve all existing logout clients.
3. Keep admin-profile access explicitly restricted to Live; requiring a complete
   profile must not grant an unrelated client administrative profile access.
4. Test inventory, callback, profile requirement, logout and admin isolation.
5. Submit an additive PR against `early-birds`, the actual Account code/deploy
   lane; do not merge that lane into Live/main.
6. Register only using the approved Account delivery workflow and exact reviewed
   source, successful CI, configuration contract and backup/restore gates.
   Exchange the newly generated credential privately; do not copy other secrets.
7. Joint readiness precedes activation. Synthetic probes do not replace a human
   login journey. D48 means 48 hours after the actual journey.

Rollback disables the candidate client and flag through the owning delivery
path; it does not remove accounts, sessions of other clients or database schema.

## Verification checkpoint — 2026-09-22

### Session continuation agreed in msg_9b3dde4ea579

OAuth code/access/ID-token TTLs remain 300/900/900 seconds. The initial ID token
is signature/issuer/audience/expiry/nonce validated; its `sid` and `sub` bind the
RP session. `userinfo.sub` must match. Profile fields come from userinfo, not
from name inference or assumptions about the ID token.

Backend-only `POST https://account.harmonicbeacon.com/api/account/session-status`
uses Basic client authentication and exact Content-Type
`application/x-www-form-urlencoded`, body `sid=<opaque>&sub=<opaque>`.
Only activated `hb-psicopompo` receives `expires_at` (integer Unix seconds) on
active responses. Existing Live/Listener response shapes remain unchanged.

Synthetic active fixture:
```json
{"active":true,"iss":"https://account.harmonicbeacon.com","sub":"synthetic-account","sid":"synthetic-session","expires_at":2000000000}
```
Inactive fixture (missing, expired, revoked, wrong subject/environment):
```json
{"active":false}
```

HTTP 401 means client credentials/gate rejected; 415 content type; 400 shape;
429 rate limit; 404 host/authority mismatch. Network/non-200/schema mismatch
must fail closed. Security revision is checked internally, not exposed.

PMP caps its session at min(initial login + 8h, central expires_at), rechecks
at most every 15 minutes and never extends the original 8h bound. OAuth tokens
are not reused after expiry. Central session configuration is 30d with 24h
update age, not a promised fixed absolute lifetime. Snapshot profile data does
not imply continuous synchronization. No global logout is exposed to PMP;
the provider enableEndSession flag stays true to emit signed sid, while the
public route boundary rejects a client without registered logout redirects.

### Earlier local checkpoint

- Base: `early-birds@311d73c45574cbe80f84310dcb423055ddab5610`.
- Account Vitest regression: 98 passed, 11 PostgreSQL cases skipped because no
  isolated test database was configured. TypeScript and changed-file ESLint pass.
- Operational configuration/social-provider tests: 29 passed.
- Full delivery-adapter suite is not locally certified: 39 passed / 19 failed,
  including missing Python jsonschema and an orphaned synthetic FIFO writer
  stopped by exact PID. These results do not authorize delivery; hosted CI and
  the owning protected workflow remain required.
- No secret generated, no Account registration, no production mutation.
- Public callback logging is a PMP deployment prerequisite. Inference has the
  enabled Nginx site `/etc/nginx/sites-available/psicopompo`, forwarding to
  `10.10.20.1:8799`; its callback currently inherits the general access log.
  Peer notified in `msg_519c565b49b0`; proxy changes belong to PMP, not this PR.
- Mona's trusted lifecycle bundle is still pinned to the base SHA above. A new
  reviewed bundle and configuration contract must be installed via its owner
  before an exact-source Account delivery can accept a new release.
