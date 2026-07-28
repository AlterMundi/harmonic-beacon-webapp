# Pivot Plan — Paid Sessions (Subsistence MVP)

**Status:** Draft · 2026-07-25
**Context:** Private funds (Nicolás) and AlterMundi public funds are running out. Goal is to make the
existing webapp self-sustaining by selling access to scheduled facilitated sessions — specifically the
"proyección de mito con Beacon + cierre psicodramático" long session Juli designed.

**Revenue target:** ~US$500 per session · 2 sessions/week (1 ES, 1 EN) → ~US$1,000/week → ~US$4,000/month
(≈ cost of the band being in Costa Rica).

**Timeline pressure:** Aiming for a first testable version this weekend, publicity + first virtual events
the following week.

---

## 0. Strategy in one paragraph

We are **not** building new product surface — we are **narrowing** the existing one into a paid funnel and
**gating** it. The webapp already has the hard parts: Zitadel auth with roles, a LiveKit session room per
scheduled session, invite codes, participant tracking, per-track egress recording, and a fallback
file-publishing bot (`services/playlist-bot`). The pivot reuses all of it. Three principles from the meeting:

1. **Hide, don't delete.** Every "must stop being available" item is a feature flag, not a `git rm`. All
   code stays so we can re-enable Meditate-as-documentation-gallery, the always-on Beacon, etc. later.
2. **The gate is a Voucher.** Today a listener enters a session room if they're authenticated + the session
   is LIVE + (optionally) they have an invite code. We add one condition: **an active voucher** (bought via
   a plan, or gifted via a coupon). Everything hangs off that one new check.
3. **Session audio comes from a pre-recorded spatialized file**, streamed into the session room — not from
   live Beacon hardware. This is the `playlist-bot` pattern re-pointed at a chosen file + the session room.

---

## 1. Decisions needed before/at kickoff (my recommendation in **bold**)

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | Keep Zitadel or migrate auth? | **Keep Zitadel for the MVP.** | Replacing auth is the single riskiest thing you could do on a weekend deadline, and the repo already survived one painful auth migration (Supabase→Zitadel). Account creation + "add card" layer *on top* of Zitadel; don't couple billing to the auth provider. Revisit only if Zitadel's hosted signup UX is a real conversion blocker. |
| D2 | Payment: automate PayPal now, or issue vouchers manually first? | **Manual-first.** Ship with an admin "issue voucher" action; a buyer pays a PayPal payment link, an admin (you) clicks issue. Automate with PayPal webhooks in iteration 2. | Decouples the Saturday ship from a payment integration. At 2 sessions/week × ~a few hundred buyers this is tractable by hand for the first weeks, and it de-risks the launch. |
| D3 | Session beacon audio source | **Pre-recorded spatialized file → LiveKit session room** via a publisher bot/ingress. | Matches the meeting decision ("archivo espacializado grabado que ya está ahí"), avoids depending on live hardware/an external stream, and reuses `playlist-bot`. |
| D4 | Recorded-session replay: how much beacon to expose? | **Server-mixed, low-fidelity, signed-URL, no raw beacon track.** (See WS4.) | The beacon layer is the IP; it must not be trivially downloadable. |

If any of D1–D3 flips, the affected workstream below changes but the rest hold.

---

## 2. Workstreams

Each is scoped, points at real files, and tagged **[MVP]** (needed this weekend) or **[v2]** (fast-follow).

### WS0 — Feature flags + cleanup **[MVP]** — *~half day*

The "must stop being available for the public" items. All behind flags.

- **Add a feature-flag module** `src/lib/features.ts` reading env vars, e.g.
  `PUBLIC_LIVE=off`, `PUBLIC_MEDITATE=off`, `PUBLIC_PRACTICE=off`, `PROVIDER_UPLOAD=off`.
- **Navigation** — `src/components/BottomNav.tsx`: the base `tabs` array (lines 14–52) hardcodes
  Live / Meditate / Sessions / Profile. Gate Live + Meditate on the flags so listeners see only
  **Sessions / Profile** (+ Studio for providers, Admin for admins). Keep the tab definitions in place.
- **Route guards** — `middleware.ts`:
  - `/live` and `/meditation` are in `protectedPages` (line 9). When their flag is off, redirect
    non-provider/admin users to `/sessions` instead of serving the page. (Providers keep access so they can
    preview.)
  - The Live "auto-play at the home entrance" the meeting wants removed lives on the `/live` page +
    `AudioContext`; hiding the route removes public audio exposure. Also stop `/api/livekit/token`
    (the anonymous beacon-room token, `src/app/api/livekit/token/route.ts`) from minting for non-providers
    when `PUBLIC_LIVE=off` — otherwise the beacon audio is still reachable by anyone who knows the endpoint.
- **Sessions page** — `src/app/sessions/page.tsx`: hide the **Practice** entry; keep **Events**
  (→ becomes "Recorded Sessions", WS4) and **Scheduled**. (Verify exact tab structure in that file.)
- **Studio** — `src/app/provider/upload` + nav to it: hide **Upload Meditation** behind
  `PROVIDER_UPLOAD=off`. Studio itself stays for facilitators.
- **Data cleanup** — write a one-off script `scripts/cleanup-test-data.ts` (mirror `prisma/seed.ts` style)
  to delete test `ScheduledSession`s and scheduled history. Run against prod once, reviewed. Do **not**
  hand-edit prod DB.

### WS1 — Voucher access gate (the core of the pivot) **[MVP]** — *~1–1.5 days*

**New Prisma models** (`prisma/schema.prisma` + a migration). Sketch:

```prisma
enum PlanKind { PER_SESSION  BUNDLE  MONTHLY  PREMIUM  CLOSED_GROUP }
enum VoucherStatus { ACTIVE  CONSUMED  EXPIRED  REVOKED }
enum OrderStatus { PENDING  PAID  REFUNDED  CANCELLED }

model Plan {
  id           String   @id @default(uuid())
  kind         PlanKind
  name         String
  priceCents   Int
  currency     String   @default("USD")
  sessionCount Int      @default(1)   // BUNDLE = N; MONTHLY/PREMIUM = unlimited-in-window
  active       Boolean  @default(true)
  // ...
}

model Voucher {
  id          String        @id @default(uuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  status      VoucherStatus @default(ACTIVE)
  planKind    PlanKind
  sessionsRemaining Int?    // null = unlimited within window
  validFrom   DateTime      @default(now())
  validUntil  DateTime?     // for MONTHLY/PREMIUM windows
  sourceOrderId String?     // paid, or null for gifted/coupon
  code        String?       @unique  // for gift/invite coupons
  // ...
}

model Order {
  id          String      @id @default(uuid())
  userId      String
  planId      String
  status      OrderStatus @default(PENDING)
  provider    String      // "paypal" | "manual"
  providerRef String?     // PayPal order/capture id
  amountCents Int
  createdAt   DateTime    @default(now())
  // ...
}
```

Add the back-relations on `User`.

**The gate itself** — `src/app/api/scheduled-sessions/[id]/token/route.ts`. This one endpoint (it mints the
LiveKit room token, lines 124–129) is the *only* door into a session room. Add a check, for non-providers,
after the LIVE-status check (~line 60): the user must have an **active voucher with sessions remaining**
(or a valid paid invite). On successful join of a *new* participant (the block at lines 112–119), **decrement
`sessionsRemaining`** for PER_SESSION/BUNDLE vouchers (skip for MONTHLY/PREMIUM). Wrap the participant-upsert
+ voucher-decrement in a transaction so a refresh doesn't double-charge (mirror the existing
`existingParticipant` reconnect guard).

**Join UX** — `src/app/join/[code]/page.tsx` + `src/app/api/invites/[code]/route.ts`: keep invite codes as
the *gift/comp* path (an invite can carry a voucher). For paid entry, when a user hits a session without an
active voucher, redirect to a **purchase page** (WS2) rather than the room. The existing `SessionInvite`
model already has `maxUses`/`expiresAt`/`canPublish` — reuse it for coupons; a coupon-invite issues a
Voucher on redemption instead of granting direct entry.

### WS2 — Billing / plans (PayPal) **[MVP: manual] / [v2: automated]** — *MVP ~half day, v2 ~1 day*

**Plan types** (from the audit checklist): Pay-per-session · Bundle (coupon for N sessions) · Monthly ·
Premium · Closed groups (4–5 people). Seed these as `Plan` rows.

- **MVP (manual):** A simple `/pricing` page listing plans, each linking to a PayPal payment link. Admin gets
  an "Issue voucher" action in `/admin/users` (extend `src/app/api/admin/users/[id]/route.ts`) to grant a
  Voucher after confirming payment. Buyer flow: pick plan → pay via PayPal → tell us / we see the payment →
  we issue voucher → they can join. Crude but shippable and fully auditable.
- **v2 (automated):** PayPal Checkout (Smart Buttons) on `/pricing`, a `POST /api/orders` to create an Order,
  and `POST /api/webhooks/paypal` to verify capture and auto-issue the Voucher. Add `paypal` server SDK.
  Store `providerRef` for reconciliation/refunds.
- **Note on the checklist question "¿cómo cobrar con la cuenta de PayPal disponible?"** — PayPal Business +
  payment links works day one with no integration. Google for Nonprofits (the other checklist question) can
  reduce fees / unlock Google Ad Grants for *publicity*, but it's an org-eligibility process, not a payment
  rail — pursue it in parallel, don't block launch on it.

### WS3 — Session audio from a pre-recorded spatialized file **[MVP]** — *~1 day*

Today the beacon layer is live hardware (`beacon01`) publishing to the global `beacon` room, with
`services/playlist-bot` as fallback. For paid sessions we want a **chosen spatialized file published into the
session's own room** when the provider goes live.

- Generalize `services/playlist-bot` (or add a sibling `session-publisher`) to take `{ roomName, filePath }`
  and publish that file as an audio track into the *session* room, not the global beacon room.
- Wire it to the provider "start session / go LIVE" transition
  (`src/app/api/provider/sessions/[id]/route.ts` status → LIVE): on going live, kick the publisher with the
  session's selected file. Add a `beaconFilePath` (or a relation to a stored asset) to `ScheduledSession`.
- Provider "new session" UI (`src/app/provider/sessions/new`) gets a file picker for the spatialized track.
- The facilitator's own voice/Zoom mix continues to publish as the provider track; the crossfader in
  `src/context/AudioContext.tsx` already mixes beacon vs. session — it now mixes *file-beacon* vs. *provider*,
  which is the same shape.

### WS4 — Recorded sessions + anti-piracy **[v2]** — *~1 day*

The checklist's "Events → Recorded Sessions — which channels to listen? how much to replay without the Beacon
being easily pirateable." The recording infra exists (`SessionRecording`, per-track egress, `CompositePlayer`,
`/playback/[id]`, `ffmpeg-mix.ts`).

- **Never serve the raw beacon track.** Playback must be a **server-side ffmpeg mix** (voice + attenuated
  beacon), streamed — reuse `src/lib/ffmpeg-mix.ts` + `stream-file.ts`. No endpoint should return the
  isolated beacon stem.
- **Signed, short-TTL URLs** for playback; gate on voucher/ownership like live sessions. No direct file paths.
- Decide product-side how much of a session is replayable vs. live-only (a teaser vs. full). This is a
  content decision, not just code.

### WS5 — Profile, plans management, settings **[MVP: minimal] / [v2: full]** — *MVP ~half day*

- **Profile** (`src/app/profile/page.tsx`): show voucher balance / active plan, "Manage my plan", "Billing
  info". MVP = read-only status + link to `/pricing`; v2 = full self-serve management.
- **Define "complete user profile"** (checklist item) — minimal for MVP: name, email (from Zitadel), plan
  status. Defer richer fields.
- **Settings** (`src/app/settings`): the checklist says **Language can move out of App Settings** — surface
  the EN/ES toggle at the top level (nav or header) since language now also drives *which weekly session*
  (ES vs EN) a user cares about.

### WS6 — Login / account creation + card capture **[v2]** — *~half day*

- Keep Zitadel (D1). After first login, if the user has no billing profile, prompt to add a payment method /
  choose a plan — but card capture belongs to PayPal, so "add card" = "complete a purchase," not storing PANs
  ourselves (never store card data). The checklist's "Create an Account → add card info" is satisfied by the
  purchase flow, not by us holding card numbers.

---

## 3. Suggested sequencing for the weekend

**Ship-Saturday critical path:** WS0 (flags/cleanup) → WS1 (voucher gate + models) → WS3 (file audio) →
WS2-manual (pricing page + admin issue-voucher) → WS5-minimal (profile shows voucher, pricing link).

That yields a testable loop: *buy plan (PayPal link) → admin issues voucher → user joins the scheduled ES/EN
session → hears the spatialized file + facilitator → session runs.*

**Fast-follow (week 2):** WS2 PayPal automation, WS4 recorded-session hardening, WS6 signup polish, and the
legal/compliance items below.

---

## 4. Risks & flags (read these)

1. **Taking money sharpens the compliance gaps the project's *own* prior audit already found.** The
   `docs/audit/` self-audit (on `main`, dated 2026-06-09, later dropped from `release`) flagged: no LICENSE,
   no privacy/terms pages, PII (email + subject id) logged in plaintext in `src/lib/auth-config.ts`
   (lines 57 & 89), no data export/delete. When you start charging, **Terms of Service + a Privacy Policy +
   a refund/cancellation policy stop being optional** — PayPal and card networks expect them, and buyers will
   ask. Add these to the week-2 list as **required, not nice-to-have**, and scrub the PII logging while you're
   in `auth-config.ts` anyway.
2. **The repo is ~3.5 months stale on `release`** (last commit ~2026-04-12). Before building, re-verify:
   `prisma generate && npm run build`, `npx vitest run` (should be 347/347), and that the deployed
   `beacon.altermundi.net` env still matches. Budget half a day for "does it still run" before feature work.
3. **Voucher double-spend** on reconnect/refresh — handled by the existing `existingParticipant` guard +
   a DB transaction, but test it explicitly (join, refresh mid-session, rejoin next week).
4. **Manual voucher issuance doesn't scale past the first weeks** — fine as a launch crutch, but WS2
   automation should land before volume grows, or you'll drown in manual issuance.
5. **Mobile is out of scope** and should stay so — per the earlier audit, the Flutter PoC is the future path
   but nothing there is release-ready; this pivot is web-only by design.

---

## 5. What explicitly stays untouched (hidden, not removed)

Always-on public Beacon · Meditate library (returns later as a *documentation gallery* of practitioner/
facilitator audio) · Meditation upload · solo Practice · the mobile migration. All behind flags so re-enabling
is a config change, not a rebuild.
