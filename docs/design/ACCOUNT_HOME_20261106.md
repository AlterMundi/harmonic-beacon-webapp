# Account welcome and personal home

Sai selected this direction on 2026-11-06 after supplying signed-out Account,
signed-in Account and signed-out Listen screenshots. This is an implementation
candidate, not evidence of a production deployment.

## Implemented scope

- Use “Bienvenido a Harmonic Beacon” / “Welcome to Harmonic Beacon” on Account
  and the public Listen entry. Keep the sign-in action near the introduction.
- Sai's correction: show Google and email sign-in as entry choices; keep the
  separate “¿No tenés cuenta? Registrate” prompt outside the sign-in card.
  Registration opens its own form with a clear return to sign-in, without tabs.
- Use the preferred name as the signed-in page heading. The pencil reveals a
  small editor; preserve the private real name, profile revision conflicts and
  signed OAuth profile-completion continuation. Keep edits on network failure.
- Show measured Listen hours and the actual membership projection only when the
  Listener identity digest matches the current Account issuer and subject.
  Loading, expired session, unavailable history and unavailable service are
  distinct from a measured zero or a confirmed Free membership.
- Allow this read only from the matching Account/Live environment. Account CSP
  permits only its corresponding Listener origin. No email identity joins,
  token transfers, new scopes, membership mutations or browser storage.
- Provide an entry to PsicopoMPo and a residence invitation for every signed-in
  account. Collapse credential changes and session actions below personal use.

Listen hours are not Live room attendance hours. They are labelled separately
and must not be added together without an overlap-aware source contract.

## Private PsicopoMPo integration still required

Shared sign-in does not itself provide Account with calendar or myth content.
The source examined in PMP-GPT main (`bb52ef5b`, dated 2026-09-10) differs from
the currently public application bundle (`index-Cgg4-Ucm.js`, read 2026-11-06).
The bundle exposes same-origin participant journey/material requests, not an
Account-readable profile export. No private participant record was accessed.

Account OAuth tokens and consent records are not a reliable association index:
the configured scopes omit offline access, JWT access tokens are not persisted,
and the selected clients skip consent. The trial client uses the production
issuer and must not be inferred to belong to Account staging. This candidate
therefore makes no linked-account badge or empty-collection claim.

Before embedding calendar, images or amplification text, resolve the deployed
PMP source and its own authorized owner session. Add a read-only, bounded
subject-based summary/export there, authenticated by the person's existing PMP
session, with exact Account origins, no shared cookies or client secrets, no
account merging, and explicit revoked/unavailable states. The Account consumer
must verify the same issuer+subject digest before rendering any private field.
Images/documents need their existing access control, safe fixed-origin links,
and no persistent browser cache or disclosure to another logged-in identity.
Test another-person cookies, expiry, revocation, cross-environment requests,
oversized/malformed content, no-data and retry before activation.

Sai's calendar meaning is being clarified: upcoming appointments/events versus
an existing personal calendar. Do not invent entries, available slots or dates.

## Verification and delivery

The local browser preview mounts real product components and styles with
synthetic accounts, stub data and a simplified navigation header. It verifies
layout/interactions, not production login, production counters or PMP export.
Chromium desktop/mobile and WebKit mobile cover name edit/save/cancel,
long names, overflow, entry visibility and automated accessibility checks.
Private preview evidence remains outside the repository.

Production Account currently reports `62795b7da19cd7ad129e5b50ab75e5027ec39649`;
Listen reports `54c7a6a489e495b3593a55967f35751fb1ce0fb2`. The current protected
`early-birds` base is `5e6e8c7da4d10a778073e35c76077d0b6e4025cb` and includes
undeployed OAuth-provider/storage changes from PR653. This UI change must not
silently promote that authentication cutover. Exact-source Account/Listen
qualification and a compatible recovery target remain necessary for delivery.
No production operation or Live room change is part of this local checkpoint.
