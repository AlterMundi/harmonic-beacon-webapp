# Isolated Fast Forward delivery lane for EarlyBirds

*Accepted 2026-08-06 for the EarlyBirds milestone.*

## Decision

Short feature branches merge into the shared `early-birds` branch. That branch
is never rebased after publication. Current green `main` is merged into it at
controlled checkpoints; final convergence is one reviewed merge into then-current
`main`.

Small slices run changed-file lint, focused tests and a local smoke. Integration
checkpoints run TypeScript, relevant suites, migration/container smoke and one
browser path. Full CI, browser/device audio, auth/commerce adversarial tests,
load/soak and rollback rehearsal run once for a release candidate.

Preview uses its own compose project, database, secrets, cookies, OAuth callback
and bounded stream origin. Event-day safety is binary: if convergence is not
accepted, stop EarlyBirds and run the known-good event release.

## Capacity and operations

The planning budget is 450 kbit/s per listener with 40% network headroom: 3,000
committed, 4,000 expansion and 5,000 critical. Measurements, not the advertised
3 Gbit/s NIC, decide scaling. Bunny CDN is prepared but activated only at the
expansion or origin-quality trigger.

Prometheus, node-exporter, cAdvisor, Alertmanager and an external decoded-audio
canary report to the private `Harmonic Beacon · Ops` Telegram group. Warnings
group and repeat hourly; critical alerts send immediately and repeat every 15
minutes; recovery always notifies. Alerts contain no PII or secrets.
