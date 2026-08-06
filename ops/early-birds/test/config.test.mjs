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
  assert.match(compose, /BEACON_STREAM_PUBLIC_ORIGIN/);
  assert.match(compose, /BEACON_STREAM_ARTIFACT_ID/);
  assert.doesNotMatch(compose, /TELEGRAM_BOT_TOKEN:\s*[^$]/);
  assert.match(alertmanager, /bot_token_file: \/run\/secrets\/telegram_bot_token/);
  assert.match(alertmanager, /send_resolved: true/g);
  assert.ok(compose.includes("grep -Eq '^-?[0-9]+$$'"));
  assert.doesNotMatch(compose, /case "\$\$chat_id" in/);
});

test('scrapes node-exporter by the internal Docker DNS name', async () => {
  const prometheus = await read('prometheus/prometheus.yml');
  assert.match(prometheus, /targets: \[node-exporter:9100\]/);
  assert.doesNotMatch(prometheus, /host\.docker\.internal/);
});

test('routes warnings hourly and critical alerts immediately every fifteen minutes', async () => {
  const alertmanager = await read('alertmanager/alertmanager.yml.tmpl');
  assert.match(alertmanager, /group_wait: 5m[\s\S]*repeat_interval: 1h/);
  assert.match(alertmanager, /matchers: \[severity="critical"\][\s\S]*group_wait: 0s[\s\S]*repeat_interval: 15m/);
});
