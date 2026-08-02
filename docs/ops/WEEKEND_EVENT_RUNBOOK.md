# Weekend Event Runbook

Harmonic Beacon live event — Saturday 2026-08-08 — Session 1: Spanish 8:30 AM Costa Rica (14:30 UTC), Session 2: English 2:00 PM Costa Rica (20:00 UTC).
This is the operator's playbook: who owns each failure, how it is detected, the
first action, when to suspend or issue rainchecks, what attendees are told, and who
decides rainchecks. It assumes the architecture in
`docs/plans/WEEKEND_MVP_ROADMAP.md` and the deploy in `docker-compose.yml`
(postgres, livekit, app, playlist-bot, tapestry on one host, "mona", behind
nginx).

Print this or keep it open next to `/ops/health` during both sessions.

## Event doors and lifecycle

Use the selected event's Spotlight console; routine event status changes no
longer require SQL.

1. At T-10 minutes or later, confirm the selected event's health link names the
   correct title, then press **Open doors**. A repeated press is harmless.
2. Keep the waiting-room page open on a test attendee: it must move into the
   room automatically, without re-entering the ticket.
3. After the session, press **Close event**, review the impact copy, then press
   **End & disconnect everyone**. The server first records `ENDED`, then deletes
   that event's Stage room and removes only that event's listeners from the
   shared Beacon room. The Beacon source and other events stay connected.
   Browsers also move to the closing state on their next three-second status
   check.
4. Admin cancellation and opening outside the -10/+60 minute window require a
   short operational reason. Never put attendee names, emails, ticket codes or
   session tokens in that field.

The response reports separate Stage and Beacon disconnection counts. If either
LiveKit action or its audit is incomplete, use **Disconnect remaining clients**;
the retry is idempotent and cannot reopen the event. If it still fails, do not
edit the database. Record the response code, refresh the event console, and
escalate to the incident commander.

---

## 1. Roles and authority

| Role | Person (seeded staff account) | Owns |
|---|---|---|
| **Incident Commander (IC)** | Admin | Declares incidents, fallback, and abort. Sole raincheck decision owner. Runs all host-level commands. |
| **Spotlight Operator** | Operador 1 | Stage grants, promote/demote/mute, the six-publisher cap, participant abuse response. |
| **Stream/Support Operator** | Operador 2 | Health board, admission support, attendee communication, bot and tapestry watch. |
| **Facilitator** | Julián | The stage: voice, video, session content. Never owns an incident; the IC shields him from operations. |

Rules:

- Every failure has exactly **one owner** — the person named in its playbook
  section. Others assist only when the owner asks.
- The IC is the only person who may declare a suspension or issue rainchecks,
  and the only person who decides rainchecks.
- Post-freeze, nobody deploys code except under the freeze policy in the
  roadmap §Freeze policy. Operational fixes only.

## 2. Health surfaces and what the colors mean

| Surface | Purpose | Behavior |
|---|---|---|
| `GET /api/health` | Liveness: process is up. Stays green even during a DB outage; nginx/docker restart decisions only. | Always 200 if the process serves HTTP. |
| `GET /api/health/ready` | Readiness: can this replica serve traffic? | 503 when Postgres is unreachable or the query hangs past 3 s. |
| `/ops/health` (dashboard) → `GET /api/ops/health` | Operator board: Postgres, LiveKit API, stage room, publisher grants, bed publisher, tapestry. Staff-only. Polls every 10 s; each probe is bounded at 3 s, so any subsystem loss shows non-green within ~15 s (30 s worst case). | **Green** all nominal; **yellow** a cuttable subsystem (tapestry) is failing; **red** a launch-blocking subsystem is failing. |

Red invariants, in priority order:

1. **Publisher grants > 6** — the stage cap broke. Treat as a Sev-1 even if
   audio sounds fine (§5.6).
2. **LiveKit API / stage room / bed publisher** — attendees cannot join, or
   hear silence under the stage (§5.9, §5.3).
3. **PostgreSQL** — entitlement cannot be verified; new logins and token
   issuance fail (§5.8).
4. **Tapestry is never red.** It is yellow and cuttable (§5.11).

Host-level checks (SSH into mona; the app has **no Docker socket**, so all
container inspection happens here):

```sh
docker compose ps
docker compose logs --tail=100 app livekit playlist-bot tapestry postgres
```

## 3. Pre-event checklist

**T-2h** (IC + Stream/Support Operator):

- `/ops/health` fully green on production.
- `docker compose ps` shows all five services healthy; bot heartbeat fresh.
- Backups taken (Postgres dump) per deploy README.
- TURN path re-verified from a restrictive network (join with UDP blocked).
- Raincheck link confirmed live (§5.12) — click it, do not just read it.
- Staff logins work for all four accounts; ticket-support channel open.
- Bed audio audible in a test attendee browser; crossfader moves both ways.

**T-45m**: Julián + both operators join the stage room. Julián publishes at
720p; verify he counts as 1/6 grants on the board. Bot fades out when Julián
publishes, fades in when he stops.

**T-10m**: doors open. Stream/Support Operator watches admission; Spotlight
Operator watches the grants counter; IC watches the whole board.

### One-time event-data stabilization

Before the first event, the IC runs the guarded stabilization command from the
exact release checkout. It corrects the two production schedules and retires
the two rehearsal fixtures without deleting history.

1. Stop all rehearsal activity and verify all four stage rooms are empty.
2. Take and verify a PostgreSQL backup.
3. On `mona`, from the deployment directory, run
   `docker compose exec app npm run event:stabilize` and review every
   current/desired row and count.
4. Run the printed apply command inside the app container (prefix it with
   `docker compose exec app`). It includes the dry-run SHA-256 digest,
   `--apply`, and `--backup-confirmed`.
5. Run the dry-run command again. Confirm production ES is scheduled for
   2026-08-08 14:30 UTC, production EN for 2026-08-08 20:00 UTC, and both test
   events are cancelled.

The command refuses to apply at or after 2026-08-08 14:20 UTC, if a LiveKit
room contains any participant, if the database changed after the dry-run, or if
event IDs, titles, room names, languages, test flags, caps, or expected statuses differ.
It never deletes data or disconnects participants. Never bypass these checks
with ad-hoc SQL; if one fails, investigate the changed state and take a new
backup/dry-run.

Because all four rooms must be empty, apply also clears stale reconciliation
flags on disconnected production participants. It does not revoke their
durable grants or alter their hand state.

Rollback: if verification immediately after apply fails, freeze admission and
restore the just-verified pre-apply PostgreSQL backup before admitting anyone.
The mutation is a single serializable transaction, so there is no partial
database state to unwind. Re-deploying the previous app image alone does not
reverse schedule or entitlement data. Keep the failed command output and the
`event.preflight_stabilization` audit entry for diagnosis; neither contains
attendee identity data.

---

## 4. Message conventions

- Attendee messages go out on the pre-created attendee contact channel
  (WS6-01) in both languages, EN first, ES second.
- Never improvise URLs. The only links attendees ever receive are the event
  URL and the pre-created raincheck URL.
- Every message says: what happened, what we're doing, what the attendee
  should do, when the next update comes. No internals, no blame.

---

## 5. Failure playbooks

### 5.1 Admission: attendee cannot log in (lost code, email mismatch)

- **Owner:** Stream/Support Operator.
- **Detection:** Support message from attendee; repeated failed logins visible in app logs.
- **First action:** Look up the ticket by code last-four + claimed email in the admission surface/CLI. Email match is `trim + lowercase`; retry with the purchase email exactly as Ticket Tailor shows it.
- **Fallback/abort threshold:** Individual admission issues never abort the event. If >10% of attendees report login failure within 15 minutes, escalate to the IC — treat as a systemic entitlement bug (§5.7/§5.8).
- **Attendee message:**
  - EN: "We're confirming your ticket now. Please sign in with the exact email you used at purchase and the code from your ticket email. Reply here if it still fails within 5 minutes."
  - ES: "Estamos confirmando tu entrada. Iniciá sesión con el mismo email que usaste en la compra y el código del correo de tu entrada. Respondé acá si sigue fallando en 5 minutos."
- **Raincheck decision owner:** IC — only if the attendee is never admitted and the event ran. Individual case, post-event.

### 5.2 Code rebind and revoke

- **Owner:** Stream/Support Operator (rebind); Spotlight Operator (revoke when abuse-related, §5.5).
- **Detection:** Attendee request (device switch, shared code); abuse signal from §5.5.
- **First action:** Rebind: revoke the ticket's current web sessions, have the attendee sign in again — the code + email rebinds to the new device. Revoke: mark the ticket revoked; existing cookie dies on the next request because every request re-resolves entitlement against the database.
- **Fallback/abort threshold:** None. Manual operator support is the designed path (roadmap cut-line 4).
- **Attendee message:**
  - EN: "For your security we've reset your sign-in. Please open the event link again and sign in with your code and purchase email on the device you want to use."
  - ES: "Por seguridad restablecimos tu sesión. Abrí de nuevo el enlace del evento e iniciá sesión con tu código y tu email de compra en el dispositivo que quieras usar."
- **Raincheck decision owner:** IC — a wrongly revoked paying attendee gets reinstated first, raincheck only if reinstatement fails.

### 5.3 Playlist bot loss → local bed fallback

- **Owner:** Stream/Support Operator.
- **Detection:** `/ops/health` bed publisher check red ("playlist-bot not in room beacon"); bot container unhealthy in `docker compose ps`.
- **First action:** `docker compose restart playlist-bot` on mona. The bot reconnects and republishes on its own; watch the board turn green.
- **Fallback (rehearsable):** If the bot does not recover within 3 minutes, the Stream/Support Operator opens the **local bed fallback**: a staff browser playing the bed audio files locally, published into the bed room from the operator's machine (the exact browser page and steps are rehearsed on Friday, WS5-03). Bed audio continues while the bot is repaired.
- **Abort threshold:** Never alone. Bed loss degrades the experience (no music under Julián, no crossfade); the stage still works. Abort only per §5.12.
- **Attendee message (only if the gap is audible, >5 min):**
  - EN: "The background music is temporarily offline. The guided session continues normally — keep listening to Julián."
  - ES: "La música de fondo está temporalmente fuera de servicio. La sesión guiada continúa con normalidad — seguí escuchando a Julián."
- **Raincheck decision owner:** IC — no raincheck for a bed gap under 15 minutes; longer gaps are assessed post-event with the attendance ledger.

### 5.4 Provider loss: Julián's connection or device drops

- **Owner:** Incident Commander (Julián concentrates on rejoining).
- **Detection:** Spotlight Operator sees Julián's participant vanish or his video freeze; bed publisher check stays green (bot fades back in).
- **First action:** IC calls Julián on the staff phone channel. Julián rejoins from his backup device/network if the primary does not recover in 2 minutes. The bot's automatic fade-in covers the audio gap.
- **Fallback/abort threshold:** 10 minutes without Julián → IC announces a short intermission (message below). 20 minutes → IC invokes the raincheck (§5.12) so the session continues with voice, or aborts per §6 if the fallback is also impossible.
- **Attendee message:**
  - EN: "Julián's connection dropped — we're getting him back now. The music will continue; please stay in the room. Next update in 5 minutes."
  - ES: "Se cortó la conexión de Julián — estamos trabajando para recuperarlo. La música continúa; por favor quedate en la sala. Próxima actualización en 5 minutos."
- **Raincheck decision owner:** IC — session resumed within 20 minutes: no raincheck. Raincheck delivered: no raincheck (disclosed fallback policy). Otherwise raincheck per §7.

### 5.5 Participant abuse

- **Owner:** Spotlight Operator.
- **Detection:** Julián or an attendee report; a publisher behaving disruptively on stage; suspicious multi-device sign-ins.
- **First action:** Demote/mute the participant immediately via stage control (the grant is revoked; the cap frees). If identity abuse is suspected (stolen/shared code), the ticket is revoked per §5.2.
- **Fallback/abort threshold:** None for individuals. A coordinated attack on admission (many tickets redeeming from one source) → IC suspends new admissions and switches support to manual verification.
- **Attendee message (only if the disruption was audible/visible):**
  - EN: "A participant was removed for disrupting the session. The event continues normally."
  - ES: "Se retiró a un participante por interrumpir la sesión. El evento continúa con normalidad."
- **Raincheck decision owner:** IC — an abuser is never refunded; a wrongly removed attendee is reinstated and, if the session was missed, refunded.

### 5.6 Capacity: attendee cap, publisher cap, host saturation

- **Owner:** Incident Commander.
- **Detection:**
  - Publisher grants red on the board (**> 6 active grants — invariant alarm**). This is Sev-1: the stage cap broke.
  - Attendee count approaching the 150 cap (admission surface count).
  - `docker stats` on mona: sustained CPU saturation or stage egress nearing the 3 Gbps NIC budget.
- **First action:**
  - Grant invariant: Spotlight Operator demotes the most recent grant(s) until the board shows ≤ 6, then IC files it as a rehearsal-blocking bug.
  - Attendee cap: stop issuing/rebinding codes for new arrivals; waitlist via support channel.
  - Host saturation: cut the tapestry first (§5.11), then reduce non-stage load.
- **Fallback/abort threshold:** If stage egress stays saturated after the tapestry cut and attendees report degraded audio, the IC moves the event to audio-only announcement (attendees toggle audio-only) before considering §5.12.
- **Attendee message (saturation only):**
  - EN: "To protect audio quality under heavy load, please switch to audio-only mode using the toggle in the player. The session continues without interruption."
  - ES: "Para cuidar la calidad del audio bajo alta demanda, activá el modo solo-audio en el reproductor. La sesión continúa sin interrupciones."
- **Raincheck decision owner:** IC — no raincheck if the session completed in audio-only; refunds only if paying attendees were turned away (§7).

### 5.7 App outage (Next.js container down or crash-looping)

- **Owner:** Incident Commander.
- **Detection:** `/ops/health` page itself unreachable; nginx 502s; `docker compose ps` shows app restarting. Liveness (`/api/health`) answers when the process is up at all — if even liveness fails, the process is down.
- **First action:** `docker compose logs --tail=200 app`, then `docker compose restart app`. If the current image is broken, roll back to the previous tagged image per the deploy README (target: restored within 10 minutes, no database rollback).
- **Fallback/abort threshold:** App down > 15 minutes during a session → IC invokes the raincheck (§5.12). Attendees already in the LiveKit room keep media until their token needs renewal; tell them not to refresh.
- **Attendee message:**
  - EN: "Our event platform is restarting. If you are already in the room, do not refresh — your audio continues. If you're locked out, hold on; next update in 5 minutes."
  - ES: "La plataforma del evento se está reiniciando. Si ya estás en la sala, no actualices la página — tu audio continúa. Si no podés entrar, esperá; próxima actualización en 5 minutos."
- **Raincheck decision owner:** IC — per §7 thresholds.

### 5.8 Database outage (PostgreSQL)

- **Owner:** Incident Commander.
- **Detection:** `/ops/health` Postgres check red; `/api/health/ready` returns 503 while `/api/health` stays green (the process is alive, the dependency is not).
- **First action:** `docker compose logs --tail=100 postgres`; `docker compose restart postgres`; confirm the data volume mount is intact. Then verify readiness returns 200 and the board goes green.
- **Impact while down:** New logins, token issuance, and grant changes all fail (entitlement cannot be verified). Attendees already in the room keep their LiveKit connection.
- **Fallback/abort threshold:** DB down > 15 minutes during a session → raincheck (§5.12). Data corruption → restore from the T-2h backup before deciding anything else; that decision is the IC's.
- **Attendee message:**
  - EN: "We're experiencing a technical issue with sign-ins. If you're already in the room, stay — you're unaffected. We'll update you in 5 minutes."
  - ES: "Estamos teniendo un problema técnico con los ingresos. Si ya estás en la sala, quedate — no te afecta. Te actualizamos en 5 minutos."
- **Raincheck decision owner:** IC — per §7.

### 5.9 LiveKit outage (SFU down, stage room gone, TURN failure)

- **Owner:** Incident Commander.
- **Detection:** `/ops/health` LiveKit API check red; stage room check red while the session is LIVE; bed publisher check red alongside (all three share the LiveKit dependency).
- **First action:** `docker compose logs --tail=100 livekit`; `docker compose restart livekit`. Everyone (Julián, bot, attendees) reconnects automatically when the SFU returns — LiveKit clients retry.
- **Fallback/abort threshold:** LiveKit down > 10 minutes during a session → IC invokes the raincheck (§5.12). A TURN-only failure (restrictive networks can't connect) is not an abort: affected attendees are support cases (§5.1 channel), pre-verified at T-2h.
- **Attendee message:**
  - EN: "We've lost our streaming server briefly. Stay on the page — it will reconnect by itself. If it doesn't within 5 minutes, we'll post the backup session link here."
  - ES: "Perdimos brevemente el servidor de streaming. Quedate en la página — se reconecta solo. Si no vuelve en 5 minutos, publicaremos acá el enlace de la sesión de respaldo."
- **Raincheck decision owner:** IC — per §7.

### 5.10 Vendor outage (Ticket Tailor, PayPal, DNS/Cloudflare, hosting ISP)

- **Owner:** Incident Commander (Stream/Support Operator executes communications).
- **Detection:** External status pages; attendees reporting the ticket site down; DNS resolution failures from off-site checks; nginx up but unreachable from outside.
- **First action:**
  - Ticket Tailor down: admission continues — codes were already delivered; support verifies purchases against the exported ticket batch, not the live site.
  - PayPal down: irrelevant during the event (no in-app checkout); note it for post-event reconciliation.
  - DNS/Cloudflare: confirm Cloudflare is not caching APIs or sitting in the UDP media path; if DNS is broken, attendees with cached resolution are unaffected — communicate via the fallback contact channel, which lives off the primary domain.
  - ISP/host network down: indistinguishable from total platform failure → §5.12.
- **Fallback/abort threshold:** A vendor outage that blocks >25% of attendees from reaching the platform for > 20 minutes → §5.12.
- **Attendee message:**
  - EN: "One of our service providers is having an outage. Your ticket is valid and this is on our side — we're switching to the backup plan. Update in 10 minutes."
  - ES: "Uno de nuestros proveedores tiene una falla. Tu entrada es válida y el problema es de nuestro lado — estamos pasando al plan de respaldo. Actualización en 10 minutos."
- **Raincheck decision owner:** IC — per §7; vendor downtime is our risk, not the attendee's.

### 5.11 Tapestry failure (yellow — cuttable)

- **Owner:** Stream/Support Operator.
- **Detection:** `/ops/health` tapestry check yellow; composite frames stop updating.
- **First action:** `docker compose restart tapestry`. If it does not recover in 5 minutes, cut it per the roadmap cut-lines: staff-only first, then removed entirely. The paid stage and all audio are unaffected, so this is never an incident.
- **Abort threshold:** Never.
- **Attendee message:** None — attendees are not told about internal feature cuts.
- **Raincheck decision owner:** IC — never refundable.

### 5.12 Total platform failure → raincheck

- **Owner:** Incident Commander (only the IC may invoke this).
- **Detection:** Any combination that leaves attendees without Julián's voice: app + DB + LiveKit loss, host or ISP failure, or §5.4/§5.7/§5.8/§5.9 thresholds exceeded.
- **First action:** IC posts the **pre-created raincheck link** (created in WS6-01, verified at T-2h) to the attendee contact channel and to the event page if it still serves. Never improvise a new URL during the incident.
- **Fallback/abort threshold:** The raincheck *is* the fallback. If Julián cannot join it either within 10 minutes, the IC aborts (§6).
- **Attendee message:**
  - EN: "We're moving the session to our backup meeting room — this was planned in advance and your ticket covers it. Join here: [fallback link]. The session resumes there in 5 minutes."
  - ES: "Pasamos la sesión a nuestra sala de respaldo — estaba prevista y tu entrada la cubre. Ingresá acá: [fallback link]. La sesión retoma ahí en 5 minutos."
- **Raincheck decision owner:** IC — a delivered fallback session is not refunded (disclosed fallback policy). A fallback that never happened is an abort (§6).

---

## 6. Abort criteria and procedure

The IC aborts when, during a session:

- Julián cannot reach attendees by any path (platform + raincheck) for
  **20 consecutive minutes**, or
- a non-cuttable gate (entitlement, publisher cap, both audio sources, TLS/TURN,
  staff control) is red and cannot be restored within the thresholds in §5.

Abort procedure:

1. IC declares the suspension on the staff channel; timestamp it.
2. Stream/Support Operator posts the abort message within 5 minutes:
   - EN: "We're sorry — we have to end today's session early due to a technical failure on our side. Every ticket holder will receive an email within 24 hours about your refund or rescheduling options. Thank you for your patience."
   - ES: "Lo sentimos — debemos terminar la sesión de hoy antes de tiempo por una falla técnica de nuestro lado. Todas las personas con entrada recibirán un correo dentro de las 24 horas con las opciones de reembolso o reprogramación. Gracias por la paciencia."
3. Spotlight Operator ends the LiveKit room gracefully after the message posts.
4. IC opens the incident log (§8) while facts are fresh.

## 7. Refund authority and procedure

- **Sole decision owner: the Incident Commander.** Julián is consulted on
  content delivery (did the session materially happen?); operators supply the
  attendance/incident ledger. Nobody else promises rainchecks to attendees —
  support language is always "the team will email you within 24 hours".
- **Execution:** Human reconciliation via Ticket Tailor/PayPal (no in-app
  refunds exist by design). IC executes or delegates execution to the
  Stream/Support Operator within 24 hours of the decision.
- **Standard outcomes:**
  - Session delivered (incl. raincheck, incl. short bed/tapestry gaps): no raincheck.
  - Aborted session: full refund or rescheduled session, attendee's choice.
  - Individual never admitted through our fault (login, capacity turn-away, wrong revoke): full refund for that ticket.
  - Abuser removed under §5.5: no raincheck.
- Every decision is recorded in the private attendance/refund ledger exported
  after Session 2.

## 8. Incident log

One entry per incident, written by its owner during or right after:

```
[time ART] [owner] [subsystem] detection → first action → outcome
[time ART] resolution or escalation; attendee message sent? (link/copy)
[time ART] raincheck decision (if any) — decided by IC
```

The 30-minute post-event review may change this runbook and content, not
production code, unless the incident was a Sev-1 safety/access fix under the
freeze policy.
