import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildProductionBundle } from '../../../scripts/listener-account-production/sync-secret.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const client = 'c'.repeat(64);
const state = 's'.repeat(64);
const account = `BEACON_ACCOUNT_BASE_URL=https://account.harmonicbeacon.com\nBEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER=${client}\n`;
const listener = 'EARLY_BIRDS_AUTH_BASE_URL=https://listen.harmonicbeacon.com\nBEACON_LISTENER_ACCOUNT_ENABLED=0\n';

test('builds the exact two-key production bundle and preserves state', () => {
  const bundle = buildProductionBundle({
    accountContents: account,
    listenerContents: listener,
    currentContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`,
  });
  assert.equal(bundle, `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`);
});

test('refuses enabled, staging and unexpected secret states', () => {
  assert.throws(() => buildProductionBundle({
    accountContents: account,
    listenerContents: listener.replace('=0', '=1'),
  }), /must remain disabled/);
  assert.throws(() => buildProductionBundle({
    accountContents: account,
    listenerContents: `${listener}BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING=${state}\n`,
  }), /STAGING must be absent/);
  const rotated = buildProductionBundle({
    accountContents: account,
    listenerContents: listener,
    currentContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${'x'.repeat(64)}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`,
  });
  assert.equal(rotated, `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`);
  assert.throws(() => buildProductionBundle({
    accountContents: account,
    listenerContents: listener,
    currentContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\nEXTRA=value\n`,
  }), /unexpected keys/);
});

test('host wrappers constrain secrets, networking, provenance and arguments', () => {
  const prepare = source('scripts/listener-account-production/prepare.sh');
  const preflight = source('scripts/listener-account-production/preflight.sh');
  assert.match(prepare, /--network none/);
  assert.match(prepare, /--read-only/);
  assert.match(prepare, /--cap-drop ALL/);
  assert.match(prepare, /--security-opt no-new-privileges/);
  assert.match(prepare, /BEACON_GIT_SHA/);
  assert.match(prepare, /root:root:600/);
  assert.doesNotMatch(prepare, /docker inspect .*Config\.Env/);
  assert.match(preflight, /earlybirds_preview_listener_egress/);
  assert.doesNotMatch(preflight, /account\.production\.env|earlybirds-preview\.env/);
});

test('preflight pins the production issuer and frozen OIDC contract', () => {
  const preflight = source('scripts/listener-account-production/preflight.mjs');
  assert.match(preflight, /https:\/\/account\.harmonicbeacon\.com/);
  assert.match(preflight, /hb-listener/);
  assert.match(preflight, /client_secret_basic/);
  assert.match(preflight, /JSON\.stringify\(\['client_secret_basic'\]\)/);
  assert.match(preflight, /S256/);
  assert.match(preflight, /Ed25519/);
  assert.match(preflight, /session-status/);
  assert.match(preflight, /AbortSignal\.timeout\(8_000\)/);
});

test('Docker image contains only the required preparation scripts', () => {
  const dockerfile = source('Dockerfile');
  assert.match(dockerfile, /scripts\/listener-account-production\/sync-secret\.mjs/);
  assert.match(dockerfile, /scripts\/listener-account-production\/preflight\.mjs/);
  assert.match(dockerfile, /ops\/listener-account-production\/validate\.mjs/);
});
