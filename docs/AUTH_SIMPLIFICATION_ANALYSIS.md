# Analysis — Simplifying Login (moving off mandatory-MFA Zitadel)

**Status:** Decision analysis for review · 2026-07-25
**Audience:** External reviewer + their agents. Self-contained; grounded in the repo's real auth code.
**Repo:** `harmonic-beacon-webapp` — Auth.js v5 (NextAuth) + Zitadel OIDC.

---

## 1. The problem

The current login is **Zitadel OIDC**, and Zitadel is configured such that **multi-factor auth (2FA) is
required as a minimum and cannot be skipped** from the user-facing settings. Our audience is a **consumer
wellness demographic**, much of which is **not familiar with authenticator-app / one-time-code 2FA**. For a
**paid** product where every extra login step is a conversion drop, a mandatory 2FA wall at signup/login is a
serious funnel risk. We want a **simpler, friction-light login**.

This doc (a) sanity-checks whether the MFA requirement is even necessary before we migrate, (b) recommends a
target auth design, and (c) gives a concrete migration path from the current code.

---

## 2. Current auth implementation (grounded)

- **`src/lib/auth-config.ts`** — a single `Zitadel({...})` provider (line 33). Roles are extracted from the
  Zitadel `userinfo` roles claim in the `profile()` callback (`BEAC_ADMIN`→ADMIN, `BEAC_PROVIDER`→PROVIDER, else
  USER, lines 59-63). The `jwt()` callback (lines 76-127) **syncs the user into Postgres** by `zitadelId`/email
  and writes `role` to the `User` table. JWT session strategy, 7-day maxAge (lines 143-146).
- **`src/auth.ts`** — 4-line Auth.js entrypoint exporting `auth`, `handlers`, `signIn`, `signOut`.
- **`middleware.ts`** — gates routes/APIs purely on `session.user.role` (`ADMIN`/`PROVIDER`/`LISTENER`), e.g.
  lines 21-24, 31-34, 52-59. **It does not depend on Zitadel specifically** — only on the role in the session.
- **`prisma/schema.prisma`** — `User` has `zitadelId String @unique` (line 54), `email @unique` (56), and
  `role UserRole @default(LISTENER)` (58). **Crucially, roles already live in our own DB** — Zitadel is only the
  *origin* of the role value, not the store.
- **Known pre-existing issue:** `auth-config.ts` logs email + subject id in plaintext on every JWT sync (lines
  57, 89) — flagged in the earlier project audit; fix during any auth work regardless of direction.

**Implication:** the app is only loosely coupled to Zitadel. The role model, the DB user store, and the
middleware are provider-agnostic. Swapping the *authentication method* is mostly confined to
`auth-config.ts` + a data-migration of how users are keyed. That's a much smaller change than the prior
Supabase→Zitadel migration was.

---

## 3. Step 0 — verify before you migrate (cheap check)

Zitadel's forced-MFA is normally a **Login Policy** setting at the org/instance level ("Force MFA" /
"Multifactors" / second-factor configuration), **not an immutable property**. Before committing to a migration:

- If **self-hosted Zitadel**: an instance admin can edit the **Login Policy** to *not* force MFA (or force it
  only for privileged users). If that toggle solves it, you may keep Zitadel with zero code change.
- If **Zitadel Cloud**: check the org's login/security policy for the same toggle.

**However** — even if MFA can be disabled, the team's broader goal is a *simpler, more consumer-grade login
experience* (social one-tap / magic link, minimal steps). Zitadel's hosted login UI is enterprise-shaped. So
Step 0 may remove the *blocker*, but the *migration* below may still be worth it for UX. Decide explicitly:
**"is the problem only mandatory-MFA (→ toggle it) or the whole login UX (→ migrate)?"**

---

## 4. Recommended target: Auth.js native providers, users in our own Postgres

**Drop the Zitadel provider; use Auth.js's built-in providers directly** — **Google + Apple social login +
Email magic-link** — with the **Prisma adapter** storing users/sessions in the Postgres we already run.

### Why this fits best
- **We already run Auth.js v5** — this is *reconfiguring the provider list*, not adopting a new system. Lowest
  conceptual and migration risk of all options.
- **No forced MFA, full UX control** — we own the login screen; steps are exactly what we choose.
- **Frictionless for a non-technical audience** — "Continue with Google/Apple" is one tap; magic-link is "enter
  email → click the link," no password, no authenticator app.
- **No new vendor, keeps sovereignty** — identities live in *our* Postgres, matching a community-networks org's
  values and removing Zitadel's operational burden entirely.
- **Roles already work** — `User.role` exists; assign `LISTENER` on signup, and providers/admins are promoted
  via the existing admin panel (`/admin/users`, `src/app/api/admin/users/[id]/route.ts`). Roles stop coming
  from external claims and become **DB-native**, which is simpler and something we already half-do.

### Security posture without mandatory MFA (important)
Removing forced 2FA for everyone is fine **if** we compensate sensibly:
- **Passwordless primary (magic-link + social)** means *there is no password to phish or reuse* — arguably safer
  than password+TOTP for this audience. Email-link inherently verifies the address.
- **Step-up MFA only where it matters:** force/optional 2FA for **ADMIN and PROVIDER** accounts (they handle
  content, money, and can host sessions), while **LISTENERS get frictionless login**. This is the key
  recommendation — put the security where the risk is, not on the paying mass. Auth.js supports gating this by
  role.
- Standard hygiene: rate-limit sign-in, short-lived magic links, keep the JWT/session settings, add the PII-log
  scrub.
- **Payments/PII note:** card data never touches our auth — the payment processor (PayPal per the pivot plan)
  handles PCI scope. Auth only needs to *identify* the user, so a light auth method does not increase card-data
  risk.

---

## 5. Options compared

| Option | Login UX | Forced MFA? | Migration effort from current | Vendor / sovereignty | Cost | Verdict |
|--------|----------|-------------|-------------------------------|----------------------|------|---------|
| **Auth.js native (Google/Apple + magic-link) + Prisma adapter** | Excellent, we control it | **No** (optional/role-gated) | **Low** — swap provider in `auth-config.ts`, add Prisma adapter, match users by email | None; self-owned in our Postgres | ~$0 (email-send provider only) | **Recommended** |
| **Keep Zitadel, disable Force-MFA login policy** | Enterprise-ish hosted UI | Configurable off | **Zero code** (config toggle) | Self-hosted (ops burden stays) | $0 | Fastest fix *if* UX is acceptable |
| **Clerk** | Excellent drop-in UI | Optional | Medium (new SDK, re-model, migrate users) | Vendor, no self-host; RBAC needs +$100/mo B2B add-on | Free tier, then paid | Great UX, but vendor lock-in + RBAC cost |
| **WorkOS AuthKit** | Very good hosted UI | Optional | Medium (full migration) | Vendor, no self-host; **RBAC free**, huge free MAU | Free at our scale | Strong if we accept a vendor |
| **Logto (self-host or cloud)** | Good, configurable | Optional | Medium (lateral OSS migration) | Self-hostable | $0 self-host / cheap cloud | Fine but ~lateral to Zitadel |
| **Supabase Auth** | Good | Optional | Medium | Vendor | Free tier | **Avoid — we already migrated away from it** |

The two live contenders are **Auth.js-native** (best fit given we already run Auth.js and value sovereignty) and
**disable-MFA-on-Zitadel** (fastest, if the only real problem is the MFA wall and the hosted UX is tolerable).

---

## 6. Migration plan (Auth.js native)

**Assumes we decide to migrate, not just toggle Zitadel MFA.**

1. **Providers.** In `src/lib/auth-config.ts`, replace the `Zitadel({...})` provider with:
   - `Google({...})`, `Apple({...})` (OAuth apps to register), and
   - `Email`/magic-link (nodemailer or a provider like Resend; needs an SMTP/API key + a `VerificationToken`
     table — the Prisma adapter adds it).
2. **Adapter + session strategy.** Add `@auth/prisma-adapter` pointing at our `prisma` client. Decide session
   strategy: the Prisma adapter is easiest with **database sessions**; if we keep **JWT** (current, `strategy:
   'jwt'`, line 143) we can still use the adapter for user records. Recommend database sessions for magic-link
   simplicity, but confirm middleware still reads `session.user.role` (it does — provider-agnostic).
3. **Role model.** Move role assignment out of the Zitadel claim logic: default `LISTENER` on user creation;
   PROVIDER/ADMIN set via the existing admin UI. Update the `jwt`/`session` callbacks to read `role` from the DB
   user (they already write/read a DB user — simplify to read `User.role`).
4. **User data migration.** Existing users are keyed by `zitadelId` (unique, required — `schema.prisma:54`) and
   `email` (unique). Plan:
   - Make `zitadelId` **nullable** (migration) or repurpose it; new signups won't have one.
   - On first post-migration login, **match the existing `User` by email** (Google/magic-link returns the same
     email) and link the new account, preserving `role`, favorites, sessions, etc. The Prisma adapter's
     `Account` linking handles OAuth; for magic-link, email match is direct.
   - Communicate to existing users that they'll "sign in with Google or email link" now.
5. **Cleanup.** Remove Zitadel env vars (`AUTH_ZITADEL_*`), update `.env.example` and the deploy env docs
   (`deploy/README.md` references the Zitadel OIDC app), decommission the self-hosted Zitadel service (this also
   *removes an entire self-hosted component* from the infra — see the infra analysis; a nice side win).
6. **Fix the PII logging** (`auth-config.ts:57,89`) while rewriting the callbacks.
7. **Tests.** Add/adjust auth tests; verify `middleware.ts` role-gating still passes with the new session shape.

**Effort estimate:** ~2–4 focused days including user-matching migration and testing. The risk is concentrated
in step 4 (user linking) — pilot it against a copy of prod data.

---

## 7. Recommended login UX for the demographic

- Primary buttons: **"Continue with Google"**, **"Continue with Apple"** (one tap; Apple matters for iOS users).
- Secondary: **"Email me a magic link"** (no password, no app).
- Optional: allow setting a password later for those who want it — but don't require it.
- **No 2FA for listeners.** Offer **optional** 2FA in settings, and **require** it only for ADMIN/PROVIDER.
- Localize the whole flow **ES/EN** (the audience is Costa Rica + global).

---

## 8. Open questions for the team

1. Is the blocker **only** mandatory-MFA (→ try the Zitadel login-policy toggle first) or the **whole login
   UX** (→ migrate)? This decides everything.
2. Are we comfortable **owning auth** in our own Postgres (Auth.js native), or do we prefer a managed vendor
   (WorkOS/Clerk) to offload security responsibility now that sessions are paid?
3. Google/Apple developer accounts — do we have them, and an Apple Developer membership ($99/yr) for "Sign in
   with Apple"? (Apple login is effectively required if we ship an iOS presence later.)
4. Email-send provider for magic links (Resend/Postmark/SES) — which, and is it covered by a nonprofit credit?
5. Confirm we can **match existing users by email** at cutover (any users whose Zitadel email differs from their
   real inbox?).
6. Keep **JWT** sessions or switch to **database** sessions with the Prisma adapter?

---

## Appendix — key files
- `src/lib/auth-config.ts` — the only file with real provider logic; where the swap happens. (Also the PII-log fix.)
- `src/auth.ts` — Auth.js entrypoint (unchanged).
- `middleware.ts` — role-gating; provider-agnostic, should not need changes.
- `prisma/schema.prisma` — `User.zitadelId` (make nullable), `User.role` (already the role store), add adapter tables.
- `src/app/api/admin/users/[id]/route.ts` — existing role-promotion path (becomes the way PROVIDER/ADMIN are granted).
- `deploy/README.md` / `.env.example` — Zitadel references to remove.
