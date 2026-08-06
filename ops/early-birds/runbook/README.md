# EarlyBirds preview operations

This stack is separate from the event compose project. It observes the
EarlyBirds origin through its private metrics listener and exposes Prometheus,
Alertmanager and node-exporter only on host loopback. Access is through a
ZeroTier/admin tunnel; do not add a public nginx location for metrics or admin.

## Bootstrap and secrets

Create the private Telegram group **Harmonic Beacon · Ops**, create a dedicated
bot, add it to the group, and store each value in a separate root-owned `0600`
file outside Git. `TELEGRAM_BOT_TOKEN_FILE`, `TELEGRAM_CHAT_ID_FILE` and
`BEACON_CANARY_MANIFEST_URL_FILE` point to those files at Compose runtime. The
bot token is consumed by Alertmanager as a Docker secret; the chat ID is
validated as an integer by the short-lived config initializer. No credential,
signed URL, email, account identifier, request path or raw webhook is included
in an alert.

Bring up the bounded preview services only after the stream compose created the
private `earlybirds_stream_observability` network:

```bash
docker compose --project-name earlybirds-observability \
  --env-file /etc/harmonic-beacon/earlybirds-ops.env up -d --build
```

`npm run validate` validates Compose, Prometheus rules/config and Alertmanager
config with generated fake secrets; it never contacts Telegram.

The included canary is HTTP-only: it verifies an HLS manifest and a non-empty
signed segment, then publishes reachability and manifest age. It **does not
decode audio** and is not evidence of decoder/audio quality. After a format is
approved, run the decoder canary from an independent VPS and add its private
target before release.

## Alert behavior and immediate action

Warnings wait five minutes, group by service/alert/environment and repeat every
hour. Critical alerts notify immediately and repeat every 15 minutes. All
receivers set `send_resolved: true`, so recovery messages are mandatory.

| Signal | Warning | Critical | Immediate action |
| --- | --- | --- | --- |
| Origin/canary | manifest age >18s | origin unavailable, canary failed, age >60s | Check private `/readyz`; stop only the EarlyBird origin if it affects host safety. |
| Origin quality | 5xx ≥0.5%, p95 >1s | 5xx ≥2% | Inspect origin logs without copying signed URLs; verify artifact and source state. |
| Host | CPU >50%, memory >70%, disk <30% | CPU >75%, memory >85%, disk <15% | Prepare/move capacity; never reclaim event volumes during an incident. |
| Network | sustained egress >1.5 Gbit/s, expansion >1.8 Gbit/s for 5m, retransmits ≥1% or interface errors | egress >2.25 Gbit/s for 2m or retransmits ≥3% | Activate the prepared Bunny pull distribution, then verify cache/origin error rates. |

The planning envelope is 450 kbit/s per listener: 3,000 committed (~1.35
Gbit/s), 4,000 expansion (~1.8 Gbit/s), and 5,000 critical (~2.25 Gbit/s).
Measured external soak throughput replaces these thresholds before launch. A
Bunny activation is justified by either the 4,000 expansion threshold, the
critical threshold, persistent 5xx/rebuffer evidence, retransmits ≥1%, or a
healthy origin whose direct egress remains the bottleneck. It is not activated
solely from an advertised NIC speed.

## Stop switch and rollback

To stop only the EarlyBird stream origin:

```bash
ops/early-birds/scripts/stop-stream.sh /etc/harmonic-beacon/earlybirds-stream.env
```

It pins `--project-name earlybirds-preview` and the isolated stream compose
file; it cannot target the event stack. Restore with the same env file and
`up -d beacon-stream` only after the canary and `/readyz` recover. The Listener
entry feature flag is owned by the application lane and must be disabled there
for a truthful public unavailable state; this ops slice never changes event
routes or data.
