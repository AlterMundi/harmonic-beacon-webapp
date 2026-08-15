import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

test('keeps all metrics and Alertmanager listeners off public interfaces', async () => {
  const compose = await read('docker-compose.yml');
  assert.match(compose, /127\.0\.0\.1:9090:9090/);
  assert.match(compose, /127\.0\.0\.1:9093:9093/);
  assert.doesNotMatch(compose, /network_mode: host/);
  assert.match(compose, /--path\.procfs=\/host\/proc/);
  assert.match(compose, /--path\.sysfs=\/host\/sys/);
  assert.match(compose, /networks: \[observability\]/);
  assert.match(compose, /networks: \[observability, ops_edge\]/g);
  assert.match(compose, /networks: \[observability, ops_edge, authority_private\]/);
  assert.match(compose, /ops_edge:\s+name: earlybirds_observability_edge/);
  assert.match(compose, /authority_private:\s+external: true\s+name: earlybirds_authority_private/);
  assert.doesNotMatch(compose, /--web\.enable-lifecycle=false/);
  // Alertmanager may bind inside its private Docker network, but host-published
  // admin/metrics ports must remain loopback-only.
  assert.doesNotMatch(compose, /ports:\s*\[0\.0\.0\.0:909[0-3]/);
});

test('references Telegram and canary credentials as mounted secret files only', async () => {
  const compose = await read('docker-compose.yml');
  const alertmanager = await read('alertmanager/alertmanager.yml.tmpl');
  assert.match(compose, /TELEGRAM_BOT_TOKEN_FILE/);
  assert.match(compose, /TELEGRAM_CHAT_ID_FILE/);
  assert.match(compose, /BEACON_STREAM_SIGNING_SECRET_FILE/);
  assert.match(compose, /alertmanager-secret-init:[\s\S]*network_mode: none/);
  assert.match(compose, /chown 65534:65534 \/runtime-secrets\/telegram_bot_token/);
  assert.match(compose, /chmod 0400 \/runtime-secrets\/telegram_bot_token/);
  assert.match(compose, /alertmanager-secret-init: \{ condition: service_completed_successfully \}/);
  assert.match(compose, /canary-secret-init:[\s\S]*network_mode: none/);
  assert.match(compose, /chown 1000:1000 \/runtime\/signing_secret/);
  assert.match(compose, /canary-secret-init: \{ condition: service_completed_successfully \}/);
  assert.match(compose, /BEACON_STREAM_SIGNING_SECRET_FILE: \/runtime\/signing_secret/);
  assert.match(compose, /BEACON_STREAM_PUBLIC_ORIGIN/);
  assert.match(compose, /BEACON_STREAM_ARTIFACT_ID/);
  assert.doesNotMatch(compose, /TELEGRAM_BOT_TOKEN:\s*[^$]/);
  assert.match(alertmanager, /bot_token_file: \/runtime-secrets\/telegram_bot_token/g);
  assert.match(alertmanager, /send_resolved: true/g);
  assert.ok(compose.includes("grep -Eq '^-?[0-9]+$$'"));
  assert.doesNotMatch(compose, /case "\$\$chat_id" in/);
});

test('scrapes node-exporter by the internal Docker DNS name', async () => {
  const prometheus = await read('prometheus/prometheus.yml');
  const compose = await read('docker-compose.yml');
  assert.match(prometheus, /targets: \[node-exporter:9100\]/);
  assert.match(compose, /--collector\.textfile\.directory=\/host\/var\/lib\/harmonic-beacon\/metrics/);
  assert.match(prometheus, /job_name: listener-authority[\s\S]*targets: \[pmp-myth-api:8765\]/);
  assert.doesNotMatch(prometheus, /host\.docker\.internal/);
});

test('alerts on the private consumer request age metric without PII', async () => {
  const alerts = await read('prometheus/alerts.yml');
  assert.match(alerts, /ListenerConsumerRequestQueueWarning[\s\S]*> 72000/);
  assert.match(alerts, /ListenerConsumerRequestQueueCritical[\s\S]*> 86400/);
  assert.match(alerts, /ListenerConsumerRequestMetricsStale[\s\S]*> 600/);
  assert.match(alerts, /ListenerConsumerRequestMetricsMissing[\s\S]*absent_over_time/);
  assert.doesNotMatch(
    alerts.slice(alerts.indexOf('listener-consumer-requests'), alerts.indexOf('listener-paid-authority')),
    /email|receipt|provider_id|request_id/,
  );
});

test('schedules an atomic private metric export and out-of-band throttle pruning', async () => {
  const exporter = await fs.readFile(path.join(root, '../../scripts/listener-withdrawal-export-metrics.sh'), 'utf8');
  const metricService = await read('systemd/harmonic-beacon-listener-withdrawal-metrics.service');
  const metricTimer = await read('systemd/harmonic-beacon-listener-withdrawal-metrics.timer');
  const pruneService = await read('systemd/harmonic-beacon-listener-withdrawal-prune.service');
  const pruneTimer = await read('systemd/harmonic-beacon-listener-withdrawal-prune.timer');
  const prune = await fs.readFile(path.join(root, '../../scripts/listener-withdrawal-prune-throttles.sh'), 'utf8');
  assert.match(exporter, /mktemp[\s\S]*listener-withdrawal-operator\.ts metrics[\s\S]*metrics_export_unixtime[\s\S]*mv -f/);
  assert.match(exporter, /docker exec --user root/);
  assert.match(exporter, /earlybirds-preview-withdrawal-operator-1/);
  assert.doesNotMatch(exporter, /earlybirds-preview-listener-1/);
  assert.match(exporter, /State\.Health[\s\S]*true healthy/);
  assert.match(metricService, /EnvironmentFile=\/etc\/harmonic-beacon\/listener-withdrawal-ops\.env/);
  assert.match(metricTimer, /OnUnitActiveSec=5m/);
  assert.match(pruneService, /\/usr\/local\/libexec\/harmonic-beacon\/listener-withdrawal-prune-throttles\.sh/);
  assert.match(prune, /prune-throttles 48/);
  assert.match(prune, /earlybirds-preview-withdrawal-operator-1/);
  assert.match(prune, /State\.Health[\s\S]*true healthy/);
  assert.match(pruneTimer, /OnCalendar=daily/);
  assert.doesNotMatch(exporter, /curl|https?:\/\//);
  const dockerfile = await fs.readFile(path.join(root, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /listener-withdrawal-operator\.ts/);
  assert.match(dockerfile, /consumer-withdrawal\.ts/);
});

test('alerts on paid authority failures without account or provider identifiers', async () => {
  const alerts = await read('prometheus/alerts.yml');
  assert.match(alerts, /ListenerAuthorityUnreachable/);
  assert.match(alerts, /ListenerPaidQueueDelayed/);
  assert.match(alerts, /ListenerPaidQueueCritical/);
  assert.match(alerts, /ListenerPaidJobFailed/);
  assert.match(alerts, /ListenerProjectionFailed/);
  assert.match(alerts, /ListenerWebhookSignatureFailuresCritical/);
  assert.match(alerts, /ListenerCheckoutProviderErrors/);
  assert.doesNotMatch(alerts, /account_id|email|subscription_id|approval_url/);
});

test('alerts on unavailable payment providers only while their sales lane is enabled', async () => {
  const alerts = await read('prometheus/alerts.yml');
  const sandboxRule = alerts.slice(
    alerts.indexOf('- alert: ListenerSandboxProviderUnavailable'),
    alerts.indexOf('- alert: ListenerLiveProviderUnavailableDuringSales'),
  );
  assert.match(sandboxRule, /pmp_listener_new_sales_enabled\{environment=~"sandbox\|test"\} == 1/);
  assert.match(sandboxRule, /pmp_listener_provider_ready\{environment=~"sandbox\|test"\} == 0/);
  assert.match(sandboxRule, /on\(provider, environment\)/);
});

test('routes warnings hourly and critical alerts immediately every fifteen minutes', async () => {
  const alertmanager = await read('alertmanager/alertmanager.yml.tmpl');
  assert.match(alertmanager, /group_wait: 5m[\s\S]*repeat_interval: 1h/);
  assert.match(alertmanager, /matchers: \[severity="critical"\][\s\S]*group_wait: 0s[\s\S]*repeat_interval: 15m/);
});

test('disk alerts report their measured free-space percentage', async () => {
  const alerts = await read('prometheus/alerts.yml');
  assert.match(alerts, /EarlyBirdsDiskPrepare[\s\S]*\{\{ \$value \| humanizePercentage \}\} free \(warning below 30%\)/);
  assert.match(alerts, /EarlyBirdsDiskCritical[\s\S]*\{\{ \$value \| humanizePercentage \}\} free \(critical below 15%\)/);
});
