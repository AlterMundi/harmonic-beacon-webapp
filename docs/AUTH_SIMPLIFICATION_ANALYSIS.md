# Analysis — Simplifying Login (moving off mandatory-MFA Zitadel)

**Status:** Decision analysis for review · 2026-07-25 · **reconciled against `main` 2026-07-28**
**Audience:** External reviewer + their agents. Self-contained; grounded in the repo's real auth code.
**Repo:** `harmonic-beacon-webapp` — Auth.js v5 (NextAuth) + Zitadel OIDC.

> **🔬 Peer-review note (2026-07-28).** From
> [`docs/reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md`](./reviews/EXTERNAL_REVIEW_SOL_2026-07-28.md):
> - **❌ Error corrected:** this doc said providers/admins are promoted via `/admin/users`. That route actually
>   **returns 409 and instructs admins to change roles in Zitadel** — roles are **Zitadel-authoritative**. So a
>   migration off Zitadel must *also build a role-management path that doesn't exist today* (not just re-map
>   claims). Fixed in §6.
> - **Migration effort is understated:** `zitadelId` is looked up across provider-sessions, invites, meditations,
>   favorites, reports, audit, export, deletion, and token issuance, and the schema field is **required + unique**.
>   Inventory *every* call site; use a stable internal id + staged dual-mapping.
> - **Magic-link ≠ admin MFA.** "Email possession" is not equivalent MFA for ADMIN/PROVIDER — keep strong
>   second-factor for privileged accounts regardless of the listener login choice.
> - **Sequence, not simultaneity:** keep Zitadel for the first paid event (relax listener MFA if possible);
>   Auth.js is the *destination*, not a launch dependency. Do NOT combine an identity migration with the first sale.

> **🔄 Reconciliation note (2026-07-28).** Deltas since this was drafted against `release`:
> - **The PII-in-logs issue is already FIXED and guarded.** `auth-config.ts` no longer logs email — it logs
>   role *names* only (**:60**) and pseudonymous `sub=…/role=…` (**:95**); error paths use `redactErrorDetail`
>   (**:130**). A source-scanning test `src/lib/__tests__/no-pii-in-logs.test.ts` fails CI if any `console.*`
>   references `.email`/`.name`/`.picture`/`.image`/`.avatarUrl`. So the old "lines 57/89 log PII" claim is
>   **stale** — treat this as an invariant to *preserve*, not a fix to do.
> - **`next-auth` is now pinned exactly** (`5.0.0-beta.30`, `package.json:29`), and a commit made **Zitadel
>   authoritative for roles**. The single-Zitadel-provider + two-tier role mapping (claim → session `USER` → DB
>   `LISTENER`) is unchanged.
> - **NEW migration-critical dependency:** data-rights endpoints now exist — `GET`/`DELETE /api/users/me` and
>   `GET /api/users/me/export` — and all resolve the caller via `prisma.user.findUnique({ where: { zitadelId:
>   session.user.id } })`, while account **deletion writes `deleted-{id}` into `zitadelId`** as a tombstone. **Any
>   auth migration MUST preserve the session-subject → `User.zitadelId` mapping (or rename that column in the same
>   change), or export/delete break.** This is now the single biggest migration constraint (see §6).
> - **New auth-gated routes** in `middleware.ts`: `/api/users/*` and `/api/reports/*` (auth required; per-user
>   authz enforced in-handler). Still provider-agnostic on role. `USER`↔`LISTENER` naming split still load-bearing.

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
- **PII logging: already fixed (2026-07).** `auth-config.ts` logs only role names (**:60**) and pseudonymous
  `sub/role` (**:95**); a `no-pii-in-logs` test enforces it. Any replacement auth code must keep this invariant
  (don't `console.*` a `.email`/`.name`/`.picture`), or CI fails.

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
- **Roles need a new management path (corrected).** `User.role` exists in the DB, but today it's **written from
  Zitadel claims on each login, and `/admin/users` refuses to change it (409 → "change it in Zitadel")** — roles
  are Zitadel-authoritative. So migrating off Zitadel means *also building* an in-app role-assignment path
  (default `LISTENER` on signup; an admin action to grant PROVIDER/ADMIN) that does **not** exist yet. This is
  extra scope the original draft missed, not a freebie.

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
3. **Role model — build the missing path.** Move role assignment out of the Zitadel-claim logic: default
   `LISTENER` on user creation; and **add** an admin role-grant action (the current `/admin/users` route 409s and
   defers to Zitadel, so this is net-new — not "the existing admin UI"). Update the `jwt`/`session` callbacks to read `role` from the DB
   user (they already write/read a DB user — simplify to read `User.role`).
4. **User data migration — now the biggest risk, because live data-rights endpoints depend on `zitadelId`.**
   Existing users are keyed by `zitadelId` (unique, required) and `email` (unique). **`GET`/`DELETE
   /api/users/me` and `GET /api/users/me/export` all look up the caller by `zitadelId: session.user.id`, and
   account deletion writes `deleted-{id}` tombstones into `zitadelId`.** So the migration must either keep
   populating `User.zitadelId` from the new IdP's subject, or **rename that column to a provider-neutral
   `authSubject` and update those three routes + the deletion tombstone logic in the same change.** Plan:
   - Repurpose `zitadelId` → a neutral subject column (or keep the name but feed it the new subject).
   - On first post-migration login, **match the existing `User` by email** (Google/magic-link returns the same
     email) and link the new account, preserving `role`, favorites, sessions, authored content, etc. The Prisma
     adapter's `Account` linking handles OAuth; for magic-link, email match is direct.
   - Re-point the data-rights routes + deletion tombstone to the new subject column; keep them green (they have
     tests). Communicate to existing users that they'll "sign in with Google or email link" now.
5. **Cleanup.** Remove Zitadel env vars (`AUTH_ZITADEL_*`), update `.env.example` and the deploy env docs
   (`deploy/README.md` references the Zitadel OIDC app), decommission the self-hosted Zitadel service (this also
   *removes an entire self-hosted component* from the infra — see the infra analysis; a nice side win).
6. **Preserve the PII-log invariant** (already fixed) and the `redactError`/`redactErrorDetail` usage in the
   auth error path — the `no-pii-in-logs` test will catch regressions.
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
- `src/app/api/admin/users/[id]/route.ts` — **not** a role-promotion path today (returns 409, defers to Zitadel); a migration must add real in-app role granting here.
- `deploy/README.md` / `.env.example` — Zitadel references to remove.
