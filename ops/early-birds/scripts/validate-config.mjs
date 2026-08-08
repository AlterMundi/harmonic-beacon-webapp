import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'earlybirds-ops-'));
const secret = async (name, contents) => {
  const file = path.join(temporary, name);
  await fs.writeFile(file, contents, { mode: 0o600 });
  return file;
};

try {
  const botToken = await secret('telegram_bot_token', 'not-a-real-token');
  const chatId = await secret('telegram_chat_id', '-1000000000000');
  const signingSecret = await secret('beacon_stream_signing_secret', 'not-a-real-32-character-or-longer-secret');
  const environment = path.join(temporary, 'preview.env');
  await fs.writeFile(environment, [
    'BEACON_STREAM_ARTIFACTS_HOST_PATH=.',
    'BEACON_STREAM_MEDIA_ROOT=/media/artifacts',
    'BEACON_STREAM_ARTIFACT_ID=approved-artifact-id',
    'BEACON_STREAM_PUBLIC_ORIGIN=https://stream.example.invalid',
    'BEACON_STREAM_SIGNING_SECRET=not-a-real-32-character-or-longer-secret',
    `TELEGRAM_BOT_TOKEN_FILE=${botToken}`,
    `TELEGRAM_CHAT_ID_FILE=${chatId}`,
    `BEACON_STREAM_SIGNING_SECRET_FILE=${signingSecret}`,
    '',
  ].join('\n'), { mode: 0o600 });
  const generatedAlertmanager = path.join(temporary, 'alertmanager.yml');
  const template = await fs.readFile(path.join(root, 'alertmanager/alertmanager.yml.tmpl'), 'utf8');
  await fs.writeFile(generatedAlertmanager, template.replaceAll('__TELEGRAM_CHAT_ID__', '-1000000000000'));
  const run = (args) => execFileSync('docker', args, { cwd: root, stdio: 'inherit' });
  run(['compose', '--env-file', environment, 'config', '--quiet']);
  run(['run', '--rm', '--entrypoint=promtool', '-v', `${path.join(root, 'prometheus')}:/etc/prometheus:ro`, 'prom/prometheus:v3.4.2', 'check', 'config', '/etc/prometheus/prometheus.yml']);
  run(['run', '--rm', '--entrypoint=promtool', '-v', `${path.join(root, 'prometheus/alerts.yml')}:/rules.yml:ro`, 'prom/prometheus:v3.4.2', 'check', 'rules', '/rules.yml']);
  run(['run', '--rm', '--entrypoint=amtool', '-v', `${generatedAlertmanager}:/config/alertmanager.yml:ro`, 'prom/alertmanager:v0.28.1', 'check-config', '/config/alertmanager.yml']);
  console.log('EarlyBirds observability configuration is valid.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
