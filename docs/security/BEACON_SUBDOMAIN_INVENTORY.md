# Harmonic Beacon subdomain and takeover inventory

Status: reviewed snapshot; the Ticket Tailor tenant-claim gate below remains
open and therefore this document does not yet clear Account production.

Last read-only verification: 2026-08-18 UTC. No DNS record, DNSExit setting,
provider configuration or runtime was changed while producing this inventory.

## Why this is an identity boundary

Every sibling origin is treated as potentially compromised. Harmonic Beacon
therefore never uses a cookie with `Domain=.harmonicbeacon.com`; Account and
each relying party use independent host-only sessions. OAuth clients have exact
redirect and front-channel URLs, Account browser mutations require its exact
origin, and the shared navigation receives neither PII nor bearer material.

A dangling DNS record is still important even with that isolation: an attacker
controlling a sibling origin could imitate the brand, target users, or exercise
browser same-site behavior. Every external CNAME must therefore remain claimed
by a known provider account for as long as the DNS record exists.

## Authoritative snapshot

The apex is delegated to `ns1`–`ns4.dnsexit.com`. Random labels below both
`harmonicbeacon.com` and `live.harmonicbeacon.com` returned no A, AAAA or CNAME,
so there is no wildcard DNS fallback.

| Name | DNS target on 2026-08-18 | Owner / serving boundary | State and takeover decision |
| --- | --- | --- | --- |
| `harmonicbeacon.com` | GitHub Pages A records | [`AlterMundi/harmonicbeacon.com`](https://github.com/AlterMundi/harmonicbeacon.com) | Active, HTTPS 200. GitHub Pages API reports the exact apex custom domain. |
| `www.harmonicbeacon.com` | CNAME `altermundi.github.io` | Same canonical site | Active, HTTPS redirects to the apex. The organization and repository remain controlled. |
| `account.harmonicbeacon.com` | no record | Future production Account authority | Reserved but absent. This is not a dangling delegation; production must not create it before the Account rollout gate. |
| `account-staging.harmonicbeacon.com` | Mona A + AAAA | Account staging Nginx/runtime | Active, exact Account readiness HTTPS 200. Authentication-critical. |
| `listen.harmonicbeacon.com` | Mona A + AAAA | Listener production Nginx/runtime | Active, health HTTPS 200. |
| `earlybirds-staging.harmonicbeacon.com` | Mona A | Isolated Listener identity staging | Active, health HTTPS 200. |
| `listen-staging.harmonicbeacon.com` | no record | Historical/reserved name | Absent and not delegated. The canonical Listener staging host is `earlybirds-staging`. |
| `live.harmonicbeacon.com` | Mona A + AAAA | Live production Nginx/runtime | Active, health HTTPS 200. |
| `live-staging.harmonicbeacon.com` | no record | Isolated Live staging; Nginx prepared on Mona | Reserved and intentionally private/loopback. Public SSO acceptance requires a human-managed DNS/TLS cutover. |
| `stream.harmonicbeacon.com` | Mona A | Stream edge | Host is controlled by Mona and currently returns HTTPS 404 at `/`; no external provider delegation. |
| `bot.harmonicbeacon.com` | Mona A | Bot edge | Host is controlled by Mona and currently returns HTTPS 404 at `/`; no external provider delegation. |
| `tickets.harmonicbeacon.com` | CNAME `custom.tickettailor.com` | Ticket Tailor custom domain | DNS resolves, but the public endpoint returns a Cloudflare 403 and does **not** prove tenant ownership. An authenticated human must confirm this exact custom domain is still claimed by the controlled Ticket Tailor tenant before production. Gate open. |
| `proyecciondelmito.harmonicbeacon.com` | CNAME `altermundi.github.io` | [`AlterMundi/proyeccionDelMito`](https://github.com/AlterMundi/proyeccionDelMito) | Active, HTTPS 200. GitHub Pages API reports this exact custom domain. |
| `psicopompo.harmonicbeacon.com` | CNAME `sairaasua.github.io` | [`SairaAsua/psicopompoweb`](https://github.com/SairaAsua/psicopompoweb) | Active, HTTPS 200. GitHub Pages API reports this exact custom domain. |

Repository references to `app`, `contracts` and `status` do not currently have
public A, AAAA or CNAME records. They are not treated as deployed origins.
Certificate Transparency enumeration additionally found only the active or
reserved names listed above; it is an observation aid, not the authority for
DNS ownership. Historical source references to `proyecciones`, `send`,
`_dmarc` and `resend._domainkey` have no current public records and are not
deployed origins.

## Findings

- No wildcard record was observed. No GitHub Pages CNAME is dangling. The
  Ticket Tailor CNAME cannot be declared safe until its authenticated tenant
  claim is confirmed; Account production remains gated on that evidence.
- The two GitHub Pages subdomains have an exact repository/custom-domain claim,
  rather than merely a resolving shared Pages target.
- Ticket Tailor is the only current third-party SaaS CNAME outside GitHub
  Pages. It is an event dependency, never an Account identity authority. Record
  only the tenant/account owner, exact domain, UTC verification time and a
  redacted screenshot or provider export; never copy provider credentials into
  this repository or an issue.
- Direct Mona records do not delegate control to a claimable external tenant.
  Their risk is instead the ordinary Nginx/runtime and server-access boundary.
- `account.harmonicbeacon.com` and `live-staging.harmonicbeacon.com` are absent,
  not dangling. Their eventual creation is a manual infrastructure action;
  automation in this repository must not mutate DNSExit.

## Required lifecycle

Run this inventory read-only before enabling a new Account RP, before every
production identity cutover, quarterly, and whenever a hosting/provider account
is retired.

For an external provider decommission:

1. disable application links and new traffic;
2. remove the DNS record through an authorized human/operator change;
3. wait at least the published DNS TTL and prove A/AAAA/CNAME are absent from
   multiple resolvers;
4. only then release the custom-domain claim or delete the provider project;
5. repeat Certificate Transparency and HTTP checks and record the evidence.

Never delete the provider-side project first while its CNAME remains. Never add
a parent-domain authentication cookie as compensation for SSO availability.

## Reproducible read-only checks

The snapshot was assembled from authoritative DNS queries, HTTPS probes, Mona's
effective Nginx `server_name` inventory, GitHub Pages API custom-domain records,
and public Certificate Transparency data. A reviewer can repeat the DNS portion
without credentials:

```sh
dig +short NS harmonicbeacon.com
dig +short A account-staging.harmonicbeacon.com
dig +short AAAA account-staging.harmonicbeacon.com
dig +short CNAME tickets.harmonicbeacon.com
dig +short A probe-identity-audit.harmonicbeacon.com
dig +short A probe-identity-audit.live.harmonicbeacon.com
```

Do not place cookies, OAuth codes, action tokens, email addresses or provider
secrets in these probes or in the recorded evidence.
