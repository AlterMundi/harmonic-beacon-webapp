import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMediaCompose } from '../validate-media-compose.mjs';

test('resolved media profile isolates database, credentials, ports and rollback images', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hb-staging-compose-'));
  try {
    const file = join(directory, 'fixture.env');
    const fixture = {
      POSTGRES_PASSWORD: 'synthetic-unused-password',
      BEACON_IMAGE_TAG: '0'.repeat(40), BEACON_GIT_SHA: '0'.repeat(40),
      BEACON_BUILD_TIME: '2026-09-27T00:00:00Z', BEACON_DATABASE_SCHEMA_VERSION: 'synthetic',
      LIVEKIT_PUBLIC_URL: 'wss://live-staging.harmonicbeacon.com/rtc',
      LIVEKIT_PUBLIC_URL_ALLOWLIST: 'wss://live-staging.harmonicbeacon.com/rtc',
      LIVE_STAGING_MEDIA_API_KEY: 'staging-key', LIVE_STAGING_MEDIA_API_SECRET: 'a'.repeat(32),
      LIVE_STAGING_TAPESTRY_SECRET: 'b'.repeat(32), LIVE_STAGING_ENV_FILE: file,
      LIVE_STAGING_LIVEKIT_IMAGE: `livekit/livekit-server@sha256:${'1'.repeat(64)}`,
      LIVE_STAGING_TAPESTRY_IMAGE: `sha256:${'2'.repeat(64)}`,
      LIVE_STAGING_PLAYLIST_IMAGE: `sha256:${'3'.repeat(64)}`,
    };
    writeFileSync(file, Object.entries(fixture).map(([k, v]) => `${k}=${v}`).join('\n'));
    const config = JSON.parse(execFileSync('docker', ['compose', '--env-file', file,
      '-f', 'deploy/live-staging.compose.yml', '-f', 'deploy/live-staging-media.compose.yml',
      'config', '--format', 'json'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } }));
    assert.equal(validateMediaCompose(config).status, 'ok');
    assert.deepEqual(config.services.tapestry.tmpfs, ['/tmp:size=32m,mode=1777']);
    const mutations = [
      c => { c.networks.media.name = 'beacon_default'; },
      c => { c.networks.media.internal = false; },
      c => { c.services.tapestry.networks.database = null; },
      c => { c.services['playlist-bot'].environment.DATABASE_URL = 'forbidden'; },
      c => { c.services.livekit.image = 'livekit/livekit-server:latest'; },
      c => { c.services.livekit.ports[0].host_ip = '0.0.0.0'; },
      c => { c.services.app.environment.DATABASE_URL = 'postgresql://beacon_staging:password@postgres:5432/beacon'; },
      c => { c.services['playlist-bot'].volumes[0].source = '/mnt/beacon-data/records'; },
      c => { c.services.app.environment.TAPESTRY_INTERNAL_SECRET = 'mismatch'; },
      c => { c.services.tapestry.privileged = true; },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(config);
      mutate(bad);
      assert.throws(() => validateMediaCompose(bad));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
