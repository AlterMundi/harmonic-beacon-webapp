import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildProductionBundle } from '../../../scripts/listener-account-production/sync-secret.mjs';
import { buildProductionActivation } from '../../../scripts/listener-account-production/activate-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const client = 'c'.repeat(64);
const state = 's'.repeat(64);
const account = `BEACON_ACCOUNT_BASE_URL=https://account.harmonicbeacon.com\nBEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER=${client}\n`;
const listener = 'EARLY_BIRDS_AUTH_BASE_URL=https://listen.harmonicbeacon.com\nBEACON_LISTENER_ACCOUNT_ENABLED=0\n';

const activationListener = [
  'EARLYBIRDS_PREVIEW_IMAGE_TAG=old',
  'EARLYBIRDS_PREVIEW_GIT_SHA=old',
  'EARLYBIRDS_PREVIEW_BUILD_TIME=old',
  'EARLYBIRDS_PREVIEW_SCHEMA_VERSION=20260813190000_listener_withdrawal_request',
  'EARLY_BIRDS_AUTH_BASE_URL=https://listen.harmonicbeacon.com',
  'EARLY_BIRDS_TRUSTED_ORIGINS=https://listen.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com',
  'EARLY_BIRDS_GOOGLE_CLIENT_ID=legacy-google',
  'EARLY_BIRDS_GOOGLE_CLIENT_SECRET=legacy-google-secret',
  'EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL=https://legacy.example.invalid',
  'EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN=legacy-mail-token',
  'EARLY_BIRDS_MAGIC_LINK_RATE_SECRET=legacy-rate-secret',
  'BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=1',
  'BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED=1',
  'BEACON_LISTENER_ACCOUNT_ENABLED=0',
  'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=',
  'BEACON_LISTENER_ACCOUNT_STATE_SECRET=',
  '',
].join('\n');

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

test('builds a production-only Listener activation without changing unrelated values', () => {
  const sha = 'a'.repeat(40);
  const activated = buildProductionActivation({
    listenerContents: `${activationListener}UNRELATED=preserved\n`,
    bundleContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`,
    expectedSha: sha,
    buildTime: '2026-08-19T06:00:00Z',
    expectedSchema: '20260818010000_beacon_account_authority',
  });
  assert.match(activated, new RegExp(`EARLYBIRDS_PREVIEW_IMAGE_TAG=${sha}`));
  assert.match(activated, new RegExp(`EARLYBIRDS_PREVIEW_GIT_SHA=${sha}`));
  assert.match(activated, /EARLYBIRDS_PREVIEW_BUILD_TIME=2026-08-19T06:00:00Z/);
  assert.match(activated, /EARLYBIRDS_PREVIEW_SCHEMA_VERSION=20260818010000_beacon_account_authority/);
  assert.match(activated, /BEACON_LISTENER_ACCOUNT_ENABLED=1/);
  assert.match(activated, new RegExp(`BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}`));
  assert.match(activated, new RegExp(`BEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}`));
  assert.match(activated, /EARLY_BIRDS_GOOGLE_CLIENT_ID=\n/);
  assert.match(activated, /EARLY_BIRDS_GOOGLE_CLIENT_SECRET=\n/);
  assert.match(activated, /BEACON_LISTENER_APPLE_ENABLED=0/);
  assert.match(activated, /BEACON_LISTENER_APPLE_CLIENT_ID=\n/);
  assert.match(activated, /BEACON_LISTENER_APPLE_CLIENT_SECRET=\n/);
  assert.match(activated, /EARLY_BIRDS_MAGIC_LINK_DELIVERY_URL=\n/);
  assert.match(activated, /EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN=\n/);
  assert.match(activated, /EARLY_BIRDS_MAGIC_LINK_RATE_SECRET=\n/);
  assert.match(activated, /BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=1/);
  assert.match(activated, /BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED=1/);
  assert.match(activated, /UNRELATED=preserved/);
});

test('activation refuses enabled, cross-environment, ambiguous and invalid input', () => {
  const input = {
    listenerContents: activationListener,
    bundleContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${state}\n`,
    expectedSha: 'a'.repeat(40),
    buildTime: '2026-08-19T06:00:00Z',
    expectedSchema: '20260818010000_beacon_account_authority',
  };
  assert.throws(() => buildProductionActivation({
    ...input,
    listenerContents: activationListener.replace('ENABLED=0', 'ENABLED=1'),
  }), /absent or 0/);
  const withoutFlag = buildProductionActivation({
    ...input,
    listenerContents: activationListener.replace('BEACON_LISTENER_ACCOUNT_ENABLED=0\n', ''),
  });
  assert.match(withoutFlag, /BEACON_LISTENER_ACCOUNT_ENABLED=1/);
  assert.throws(() => buildProductionActivation({
    ...input,
    listenerContents: `${activationListener}BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING=${state}\n`,
  }), /STAGING must be empty/);
  assert.throws(() => buildProductionActivation({
    ...input,
    bundleContents: `${input.bundleContents}EXTRA=value\n`,
  }), /unexpected keys/);
  assert.throws(() => buildProductionActivation({
    ...input,
    bundleContents: `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${client}\nBEACON_LISTENER_ACCOUNT_STATE_SECRET=${client}\n`,
  }), /must differ/);
  assert.throws(() => buildProductionActivation({ ...input, expectedSha: 'latest' }), /sha40/);
  assert.throws(() => buildProductionActivation({ ...input, expectedSchema: 'latest' }), /schema migration/);
});

test('host wrappers constrain secrets, networking, provenance and arguments', () => {
  const prepare = source('scripts/listener-account-production/prepare.sh');
  const preflight = source('scripts/listener-account-production/preflight.sh');
  const activate = source('scripts/listener-account-production/activate.sh');
  const rollback = source('scripts/listener-account-production/rollback.sh');
  const health = source('scripts/listener-account-production/health-smoke.sh');
  assert.match(prepare, /id -u/);
  assert.match(preflight, /id -u/);
  assert.match(prepare, /--network none/);
  assert.match(prepare, /--read-only/);
  assert.match(prepare, /--cap-drop ALL/);
  assert.match(prepare, /--security-opt no-new-privileges/);
  assert.match(prepare, /BEACON_GIT_SHA/);
  assert.match(prepare, /root:root:600/);
  assert.doesNotMatch(prepare, /docker inspect .*Config\.Env/);
  assert.match(preflight, /earlybirds_preview_listener_egress/);
  assert.doesNotMatch(preflight, /account\.production\.env|earlybirds-preview\.env/);
  assert.match(activate, /--network none/);
  assert.match(activate, /--read-only/);
  assert.match(activate, /--cap-drop ALL/);
  assert.match(activate, /--security-opt no-new-privileges/);
  assert.match(activate, /preflight\.sh["']? "?\$expected_sha/);
  assert.ok(
    activate.indexOf('preflight.sh" "$expected_sha"') < activate.indexOf('install -d -o root -g root -m 0700 "$state"'),
    'public Account preflight must precede persistent activation state',
  );
  assert.match(activate, /previous\.env/);
  assert.match(activate, /--no-deps --force-recreate --no-build listener/);
  assert.match(activate, /health-smoke\.sh"[\s\\\n]+"\$expected_sha" 1 "\$expected_schema"/);
  assert.match(activate, /candidate image schema provenance mismatch/);
  assert.match(activate, /previous-schema\.txt/);
  assert.match(activate, /BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED/);
  assert.match(activate, /protected-containers\.before/);
  assert.match(activate, /protected-containers\.after/);
  assert.match(activate, /cmp -s "\$state\/protected-env\.before" "\$state\/protected-env\.after"/);
  assert.ok(
    activate.indexOf('\ncutover_started=1\n') < activate.lastIndexOf('mv -T "$temporary" "$listener_env"'),
    'rollback must become active before replacing the production env',
  );
  assert.ok(
    activate.lastIndexOf('health-smoke.sh"') < activate.lastIndexOf('cutover_started=0'),
    'rollback must stay active through the external acceptance smoke',
  );
  assert.match(activate, /trap 'exit 130' HUP INT TERM/);
  assert.match(activate, /rm -rf "\$state"/);
  assert.doesNotMatch(activate, /require_synthetic_env/);
  assert.doesNotMatch(activate, /cat [^\n]*(?:account|listener).*\.env/);
  assert.match(rollback, /listener-account-production\/activation-/);
  assert.match(rollback, /running Listener does not match this rollback candidate/);
  assert.match(rollback, /--no-deps --force-recreate --no-build listener/);
  assert.match(rollback, /database was not downgraded/);
  assert.match(rollback, /trap '' HUP INT TERM/);
  assert.doesNotMatch(rollback, /require_synthetic_env/);
  assert.match(health, /--connect-timeout 3 --max-time 8/);
  assert.match(health, /--proto '=https'/);
  assert.match(health, /api\/account\/login\/extra/);
  assert.match(health, /EARLY_BIRDS_GOOGLE_CLIENT_SECRET/);
  assert.match(health, /EARLY_BIRDS_MAGIC_LINK_DELIVERY_TOKEN/);
  assert.match(health, /checks\.listenerAccount == "ok"/);
  assert.match(health, /databaseSchemaVersion == \$schema/);
  assert.match(health, /trap 'exit 130' HUP INT TERM/);
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
  assert.match(dockerfile, /scripts\/listener-account-production\/activate-env\.mjs/);
  assert.match(dockerfile, /ops\/listener-account-production\/validate\.mjs/);
});
