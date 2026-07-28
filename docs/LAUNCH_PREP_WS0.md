# WS0 — Launch-prep changes that need no architectural decision

**Status:** Implementation spec + record · 2026-07-28 · branch `feat/ws0-feature-gating`

The subset of the pivot that can start **now**, independent of the still-open decisions (LiveKit hosting,
auth migration, payment/ticketing platform, Neon/R2). Everything here is reversible flag work, data cleanup,
ops, or paperwork. It is **not** the paid-admission enforcement — that's real code and a launch blocker, tracked
in the pivot plan's WS2, not here.

> Companion docs (on branch `docs/pivot-and-infra-planning`): `PIVOT_PAID_SESSIONS_PLAN.md`,
> `INFRASTRUCTURE_SCALING_ANALYSIS.md`, `PROMOTE_TO_SPEAKER_BUILD.md`, `AUTH_SIMPLIFICATION_ANALYSIS.md`, and the
> external review `reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md`.

---

## Design choice: flags default to SHOWN

Each public surface is **shown by default**, so this branch is behaviour-preserving — merging it changes nothing
until the launch environment sets the flags. Hiding is therefore an explicit, reviewable deploy-config change,
and the existing test suite stays green. The public first-iteration launch sets all four flags to `off`.

`src/lib/features.ts` reads `NEXT_PUBLIC_SHOW_*` (available in client components, middleware, and route
handlers alike). Because `NEXT_PUBLIC_*` is inlined at build time, flipping a flag is a rebuild/redeploy — a
launch posture, not a runtime kill-switch. **Nothing is deleted; re-enabling any surface is a one-line env change.**

Launch `.env` values (documented in `.env.example`):
```
NEXT_PUBLIC_SHOW_LIVE=off        # public beacon / the /live home + play button
NEXT_PUBLIC_SHOW_MEDITATE=off    # /meditation library (returns later as a doc gallery)
NEXT_PUBLIC_SHOW_PRACTICE=off    # solo "Practice" tab on Sessions
NEXT_PUBLIC_SHOW_UPLOAD=off      # provider "Upload Meditation" entry + page
```

---

## Implemented in this branch (Part 1 — screen-by-screen hiding)

| Screen | Change | File(s) | Behaviour when flag off |
|--------|--------|---------|-------------------------|
| **Flag module** | New `features` object | `src/lib/features.ts` | — |
| **Navigation** | Hide **Live** + **Meditate** tabs from listeners; providers/admins keep them (preview, and it preserves the Studio/Admin splice order) | `src/components/BottomNav.tsx` | listener sees **Sessions / Profile** only |
| **Home / Live + Meditate routes** | Redirect listeners off `/live` and `/meditation` → `/sessions`; land post-login on `/sessions` (not `/live`) when Live is hidden | `middleware.ts` | listener can't reach the beacon home; providers still can |
| **Beacon token** | `403` for listeners (providers/admins still mint) so the beacon audio isn't reachable by hitting the endpoint | `src/app/api/livekit/token/route.ts` | listener `GET /api/livekit/token` → 403 |
| **Sessions** | Hide the **Practice** tab + its content; default to **Events** | `src/app/sessions/page.tsx` | Sessions shows only Events (Recorded + Scheduled) |
| **Studio → Upload** | Hide the "Upload" CTA on the dashboard; guard `/provider/upload` (redirect to dashboard) | `src/app/provider/dashboard/page.tsx`, `src/app/provider/upload/page.tsx` | provider can't reach the upload form |
| **Config** | Launch flag values + docs | `.env.example` | — |
| **Tests** | Flag-off coverage | `src/components/__tests__/BottomNav.features.test.tsx`, `middleware.test.ts`, `src/app/api/livekit/token/__tests__/route.test.ts` | — |

**Untouched by design (kept for later):** the `/meditation` page + `GET /api/meditations` (future documentation
gallery), the `/live` page + `AudioContext`, the upload API, the solo-practice code, Admin (already role-gated),
Profile (plan/billing UI is v2, needs the payment decision), Settings (the ES/EN language move is optional
polish — deferred).

### Known cosmetic wart (intentionally not fixed here)
With Live hidden, a listener's `AudioContext` still attempts its beacon connection on mount and gets a `403`,
logging one `console.error`. This is harmless (no beacon audio for listeners is the intent) but noisy.
**Not fixed in WS0 on purpose:** cleanly not-connecting touches `AudioContext`'s beacon/session-crossfade logic,
which the external review flagged as the **two-room** concern and which is entangled with the **WS3** session-
audio rework. It's addressed there, not in this pure-hiding branch.

---

## Not in this branch (still decision-independent, but not "hiding")

- **Data cleanup** — delete test scheduled sessions + history via a reviewed `scripts/cleanup-test-data.ts`.
  ⚠️ prod DB — back up + dry-run first. (~½ day)
- **Ops** — move the CI runner off the prod box; verify a Postgres backup restores. (~½ day)
- **Paperwork (parallel, long lead)** — TechSoup/Wingu + Goodstack validation; Cloudflare Galileo + Google Ad
  Grants; **Payoneer + Ticket Tailor/PayPal** account verification for the *asociación civil*; draft
  privacy/terms/refund policy.

## The launch blocker this is NOT (pivot WS2)

**Paid admission is not enforced today** — the scheduled-session token route admits any authenticated listener
to a `LIVE` session (a unit test asserts it). Making entry require an entitlement, with **reconnect-safe, atomic,
user-bound redemption**, is ~2–3 person-days of real code and must land before a ticket is sold. That is WS2, not
WS0. Hiding the free surfaces (this branch) does not gate the paid ones.

---

## Verifying the hidden state locally
```
NEXT_PUBLIC_SHOW_LIVE=off NEXT_PUBLIC_SHOW_MEDITATE=off \
NEXT_PUBLIC_SHOW_PRACTICE=off NEXT_PUBLIC_SHOW_UPLOAD=off npm run dev
```
Log in as a listener → land on Sessions (Events only), no Live/Meditate tabs, `/live` redirects, beacon token
403s. Log in as a provider → Live/Meditate still visible for preview; Studio has no Upload entry.
