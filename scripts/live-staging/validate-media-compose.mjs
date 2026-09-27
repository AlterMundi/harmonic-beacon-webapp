#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const exactImage = /^(?:[a-z0-9./_-]+@)?sha256:[a-f0-9]{64}$/;
const sameKeys = (object, keys) => JSON.stringify(Object.keys(object ?? {}).sort()) === JSON.stringify([...keys].sort());
const requireCondition = (condition, label) => { if (!condition) throw new Error(label); };

/** Validate resolved Compose without returning or logging environment values. */
export function validateMediaCompose(config) {
  requireCondition(config.name === 'hb-live-staging', 'unexpected project');
  requireCondition(sameKeys(config.services, ['app', 'postgres', 'migrate', 'livekit', 'tapestry', 'playlist-bot']), 'unexpected service set');
  requireCondition(sameKeys(config.networks, ['database', 'app_egress', 'media', 'media_egress']), 'unexpected network set');
  for (const [key, network] of Object.entries(config.networks)) {
    requireCondition(network.name === `hb_live_staging_${key}` && !network.external, 'unexpected network boundary');
    requireCondition(Boolean(network.internal) === ['database', 'media'].includes(key), 'unexpected network egress');
  }
  const networks = {
    app: ['database', 'app_egress', 'media'], postgres: ['database'], migrate: ['database'],
    livekit: ['media', 'media_egress'], tapestry: ['media'], 'playlist-bot': ['media'],
  };
  const mounts = {
    postgres: [['/mnt/beacon-data/live-staging/postgres', '/var/lib/postgresql/data', false]],
    livekit: [['/etc/harmonic-beacon/live-staging-media/livekit.yaml', '/etc/livekit.yaml', true]],
    'playlist-bot': [['/mnt/beacon-data/live-staging/media-records', '/data/beacon-records', true]],
  };
  for (const [name, service] of Object.entries(config.services)) {
    requireCondition(sameKeys(service.networks, networks[name]), 'unexpected service network');
    requireCondition(!service.privileged && !service.network_mode && !service.pid && !service.devices && !service.cap_add, 'unexpected elevated service capability');
    requireCondition(!service.container_name || service.container_name === `hb-live-staging-${name}`, 'unexpected container name');
    requireCondition(JSON.stringify((service.volumes ?? []).map(v => [v.source, v.target, Boolean(v.read_only)])) === JSON.stringify(mounts[name] ?? []), 'unexpected mount boundary');
    for (const mount of service.volumes ?? []) requireCondition(mount.type === 'bind', 'unexpected mount type');
    if (['livekit', 'tapestry', 'playlist-bot'].includes(name)) {
      requireCondition(exactImage.test(service.image), 'media image must be immutable');
      requireCondition(!service.build && !service.env_file, 'unexpected media build or environment file');
      requireCondition(!Object.keys(service.environment ?? {}).some(k => /DATABASE|ACCOUNT|SMTP|MAIL|COOKIE|TICKET/.test(k)), 'unexpected media credentials');
    }
    if (!['app', 'livekit'].includes(name)) requireCondition(!service.ports?.length, 'unexpected published port');
  }
  const ports = service => (service.ports ?? []).map(p => `${p.host_ip ?? '*'}:${p.published}:${p.target}/${p.protocol}`).sort();
  requireCondition(JSON.stringify(ports(config.services.app)) === JSON.stringify(['127.0.0.1:3200:3000/tcp']), 'unexpected app port');
  requireCondition(JSON.stringify(ports(config.services.livekit)) === JSON.stringify(['*:43881:43881/tcp', '*:43882:43882/udp', '127.0.0.1:43880:7880/tcp'].sort()), 'unexpected media ports');
  const app = config.services.app.environment;
  const profile = readFileSync(new URL('../../deploy/runtime-public-config/live-staging-media.json', import.meta.url));
  requireCondition(app.BEACON_CONFIG_PROFILE_SHA256 === `sha256:${createHash('sha256').update(profile).digest('hex')}`, 'unexpected media profile digest');
  requireCondition(app.BEACON_PUBLIC_ORIGIN === 'https://live-staging.harmonicbeacon.com' && app.PROMO_INVITATIONS_ENABLED === 'false', 'unexpected public profile');
  const bot = config.services['playlist-bot'].environment;
  requireCondition(app.LIVEKIT_INTERNAL_URL === 'http://livekit:7880' && bot.LIVEKIT_URL === 'ws://livekit:7880', 'unexpected internal media target');
  requireCondition(app.LIVEKIT_ROOM_NAME === 'staging-beacon' && bot.LIVEKIT_ROOM_NAME === 'staging-beacon', 'unexpected media room');
  requireCondition(app.LIVEKIT_API_KEY && app.LIVEKIT_API_KEY === bot.LIVEKIT_API_KEY && app.LIVEKIT_API_SECRET?.length >= 32 && app.LIVEKIT_API_SECRET === bot.LIVEKIT_API_SECRET, 'invalid staging media credentials');
  requireCondition(app.TAPESTRY_INTERNAL_URL === 'http://tapestry:3100' && app.TAPESTRY_PUBLIC_ENABLED === 'true', 'unexpected tapestry target');
  requireCondition(app.TAPESTRY_INTERNAL_SECRET?.length >= 32 && app.TAPESTRY_INTERNAL_SECRET === config.services.tapestry.environment.TAPESTRY_INTERNAL_SECRET && app.TAPESTRY_INTERNAL_SECRET !== app.LIVEKIT_API_SECRET, 'invalid staging tapestry credentials');
  requireCondition(bot.BEACON_RECORDS_PATH === '/data/beacon-records' && bot.BEACON_PLAYLIST_FILE === 'rehearsal.wav', 'unexpected recording source');
  requireCondition(app.LIVEKIT_PUBLIC_URL === 'wss://live-staging.harmonicbeacon.com/rtc' && app.LIVEKIT_PUBLIC_URL_ALLOWLIST === app.LIVEKIT_PUBLIC_URL, 'unexpected public media target');
  for (const name of ['app', 'migrate']) {
    const db = new URL(config.services[name].environment.DATABASE_URL);
    requireCondition(db.protocol === 'postgresql:' && db.hostname === 'postgres' && db.pathname === '/beacon_live_staging' && db.username === 'beacon_staging', 'unexpected database target');
  }
  return { status: 'ok', project: config.name, mediaServices: ['livekit', 'tapestry', 'playlist-bot'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('no arguments accepted');
    const input = readFileSync(0, 'utf8');
    if (input.length > 1048576) throw new Error('input too large');
    // Do not expose JSON parse errors: they may contain secret-bearing input.
    let config;
    try { config = JSON.parse(input); } catch { throw new Error('invalid Compose JSON'); }
    process.stdout.write(`${JSON.stringify(validateMediaCompose(config))}\n`);
  } catch {
    process.stderr.write('Staging media Compose validation failed; inspect the configuration privately.\n');
    process.exitCode = 1;
  }
}
