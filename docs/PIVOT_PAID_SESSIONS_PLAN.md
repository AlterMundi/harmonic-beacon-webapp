# Pivot Plan — Paid Sessions (Subsistence MVP)

**Status:** Draft · 2026-07-25 · **reconciled against `main` 2026-07-28**

> **🔄 Reconciliation note (2026-07-28).** The plan stands; current-state deltas: (a) most compliance gaps are
> now closed — see the updated Risks §4.1; (b) **go2rtc was removed**, so the "hide Meditate streaming" work in
> WS0 is largely already done at the infra level (the Meditate *page* + a GET meditations API remain); (c) the
> **voucher / plan / order** models this plan proposes still **do not exist** and have **no naming collision**
> with the new `AuditLog`/`Report` models; (d) the session-room token route (the voucher choke-point in WS1) is
> unchanged. Anti-piracy (WS4) is reinforced: audio still sits on local disk with no signed URLs and deletion
> can't purge it yet.
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
| D2 | How to take payment for the first events? | **External ticketing platform (Luma / Ticket Tailor), not in-app payment.** The platform sells tickets; access is granted through the app's *existing* `SessionInvite` codes or an email allowlist. Build **zero** payment code for launch. (Full in-app Voucher/Plan/PayPal flow is deferred to v2, when you want in-app subscriptions/bundles.) | Fastest possible launch: the platform handles payment, receipts, refunds, and gives you an attendee list. It reuses machinery you already have (`/join/[code]`, `SessionInvite`). Supersedes the earlier "manual PayPal links + admin issues vouchers" idea — same simplicity, less to build. See **WS2**. |
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
    `AudioContext`; hiding the route removes public audio exposure. `/api/livekit/token`
    (`src/app/api/livekit/token/route.ts`) **now already requires auth** (commit `dd17052`) and mints an
    anonymous `listener-<uuid>` subscribe-only token — so tighten it further to not mint for non-providers when
    `PUBLIC_LIVE=off`, otherwise authenticated non-buyers can still reach the beacon audio.
- **Sessions page** — `src/app/sessions/page.tsx`: hide the **Practice** entry; keep **Events**
  (→ becomes "Recorded Sessions", WS4) and **Scheduled**. (Verify exact tab structure in that file.)
- **Studio** — `src/app/provider/upload` + nav to it: hide **Upload Meditation** behind
  `PROVIDER_UPLOAD=off`. Studio itself stays for facilitators.
- **Data cleanup** — write a one-off script `scripts/cleanup-test-data.ts` (mirror `prisma/seed.ts` style)
  to delete test `ScheduledSession`s and scheduled history. Run against prod once, reviewed. Do **not**
  hand-edit prod DB.

### WS1 — Voucher access gate (the core of the pivot) **[MVP]** — *~1–1.5 days*

> **🎟️ Launch shortcut (2026-07-28): the first events don't need the Voucher model at all.** With external
> ticketing (WS2), access for event #1 can run entirely on the **already-built** `SessionInvite` + `/join/[code]`
> + `?invite=CODE` machinery: mint a batch of single-use invite codes for the session, and the ticketing
> platform delivers one per buyer (or gate on an email allowlist). The `Plan`/`Voucher`/`Order` models below are
> the **v2** build — needed only when you want *in-app* plans (monthly, bundles, closed groups) rather than
> per-event tickets sold outside. So for the first events, skip to WS2 and treat this section as the follow-on.

**New Prisma models** (`prisma/schema.prisma` + a migration) — **[v2, for in-app plans]**. Sketch:

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

### WS2 — Payment **[MVP: external ticketing — zero payment code] / [v2: in-app PayPal]** — *MVP ~half day of wiring, v2 ~1–1.5 days*

**Launch decision (D2): sell the first events on an external ticketing platform** (Luma, Ticket Tailor,
Eventbrite). The platform handles payment, receipts, refunds, and gives you an attendee list; the **app never
touches money** for launch. The only work is turning "sold" into "allowed in the session," and that reuses
machinery you already have.

**The key reuse:** the app already has the *redemption* half — `SessionInvite` (`code`, `maxUses`, `expiresAt`,
`canPublish`), the `/join/[code]` page, `GET /api/invites/[code]`, and `?invite=CODE` on the session token
route. So the ticketing platform is just a payment + delivery front-end onto the invite system.

Two ways to wire access (pick per friction tolerance):

- **Option A — code redemption (uses existing invite system).** Generate **single-use** invite codes
  (`maxUses: 1`) for the session; the platform delivers one code per buyer (unique-code field, or you email
  them after export). Buyer enters it at `/join/[code]`. Single-use is the anti-piracy control — a shared code
  gets passed around, a `maxUses:1` code doesn't. Minimal new build: a small "bulk-generate N invite codes for
  this session" action (extend `src/app/api/provider/sessions/[id]/invites`).
- **Option B — email allowlist + magic-link (least friction, recommended for event #1).** Export the paid
  attendees' emails, mark them allowed for the session, and gate on the login email. Buyer just logs in (magic
  link / Google — see the auth analysis) and is admitted; nothing to copy. Tradeoff: tied to the email they
  bought with (keep Option A as the fallback for gift tickets / mismatched emails). New build: a session→allowed
  -emails table + one check in the token route.

**Platform choice — the real decider is payout, not features.** Unique codes / attendee export / API exist on
all of them; what matters for an **Argentine nonprofit charging a global (Costa Rica + worldwide) audience** is
*can it collect money and pay out to the org.* Shortlist:
- **Ticket Tailor** — flat per-ticket fee (no %), strong API + webhooks, and lets you connect **your own PayPal
  or Stripe** (PayPal is reliably available in Argentina — likely the pragmatic winner).
- **Luma** — best event UX, free/low fee, runs on Stripe (verify Stripe payout to the org).
- **Eventbrite** — robust, higher fees; confirm Argentina payout.
- **Zeffy** — free for nonprofits but US/Canada-focused; Argentine eligibility doubtful — verify before relying.
- **⚠️ OPEN DECISION:** which platform can actually pay out to the Argentine org. This is the one thing to
  settle before selling — everything else is equivalent.

**Manual flow for event #1:** create the event (ES + EN) → publish the link → put join instructions in the
confirmation email → after sales, export attendees → bulk-generate invite codes **or** load the email allowlist
→ attendees log in and join.

**Later automation:** platform **webhook** on purchase → create a `SessionInvite` / allowlist entry → email the
join link. (Ticket Tailor + Eventbrite have webhooks; Luma via API/Zapier.) The *payment* stays the platform's
problem.

**v2 — in-app plans (only when you want subscriptions/bundles inside the app):** the `Plan`/`Voucher`/`Order`
models (WS1) + PayPal Checkout + `POST /api/webhooks/paypal`. Note **Google for Nonprofits** can unlock Ad
Grants for *publicity* (huge for filling events) but it's an org-eligibility process, not a payment rail —
pursue in parallel, don't block launch on it.

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

**Ship-Saturday critical path (with external ticketing, D2):** WS0 (flags/cleanup) → WS3 (file audio) →
WS2-launch (set up the ticketing event + wire access via existing `SessionInvite` codes **or** an email
allowlist) → WS5-minimal (profile shows session access). **No payment code, no Voucher model needed for event
#1** — the ticketing platform is the payment system, and the invite/join flow already exists.

That yields a testable loop: *buy ticket on the platform → get an invite code (or your email is on the
allowlist) → log in → join the scheduled ES/EN session → hear the spatialized file + facilitator → session
runs.* The one thing to settle first: **which ticketing platform pays out to the Argentine org** (WS2).

**Fast-follow (week 2+):** in-app plans (WS1 Voucher/Plan/Order + PayPal, only if you want subscriptions/bundles
inside the app), ticketing **webhook** automation, WS4 recorded-session hardening, WS6 signup polish, and the
legal/compliance items below.

---

## 4. Risks & flags (read these)

1. **Compliance for taking money — mostly closed since this was drafted; a short list remains.** `main` has
   since added a `LICENSE`/`NOTICE`, PII-log redaction (the `auth-config.ts` leak is fixed + test-guarded),
   data **export + account deletion**, an **audit log**, a **reports/abuse system**, and an **admin session
   kill-switch** — several of the exact gaps the 2026-06-09 self-audit flagged. **Still required before a public
   paid launch:** Terms of Service + Privacy Policy + a **refund/cancellation policy** (PayPal and buyers expect
   them), and an **object-storage driver so account deletion can actually purge audio** (a known `TODO(storage)`
   gap — reinforces moving audio to R2). The moderation/safety infra now existing is a *tailwind* for charging.
2. **The repo is active, not stale.** `main` advanced ~39 commits since the first draft; the suite is now
   **624 tests, all green** (not 347). Still re-verify `prisma generate && npm run build` and that the deployed
   `beacon.altermundi.net` env matches before feature work — but the "is it abandoned" worry is resolved.
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
