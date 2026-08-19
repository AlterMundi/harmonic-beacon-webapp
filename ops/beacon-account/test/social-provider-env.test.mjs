import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildSocialProviderActivation } from '../../../scripts/beacon-account/social-provider-env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const staging = fs.readFileSync(path.join(ROOT, 'account.staging.env.example'), 'utf8');
const production = fs.readFileSync(path.join(ROOT, 'account.production.env.example'), 'utf8');

function jwt(payload = {}, header = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256', kid: 'KEY1234567', ...header })}.${encode({
    iss: 'TEAM123456',
    sub: 'com.harmonicbeacon.account.staging',
    aud: 'https://appleid.apple.com',
    iat: 2_000_000_000,
    exp: 2_000_086_400,
    ...payload,
  })}.${Buffer.alloc(64, 1).toString('base64url')}`;
}

test('prepares an exact Google activation without changing unrelated Account values', () => {
  const bundle = [
    'BEACON_ACCOUNT_GOOGLE_CLIENT_ID=staging-client.apps.googleusercontent.com',
    'BEACON_ACCOUNT_GOOGLE_CLIENT_SECRET=google_secret_1234567890',
    '',
  ].join('\n');
  const result = buildSocialProviderActivation({
    accountContents: staging,
    bundleContents: bundle,
    environment: 'staging',
    provider: 'google',
  });
  assert.match(result, /^BEACON_ACCOUNT_GOOGLE_ENABLED=1$/m);
  assert.match(result, /^BEACON_ACCOUNT_GOOGLE_CLIENT_ID=staging-client\.apps\.googleusercontent\.com$/m);
  assert.match(result, /^BEACON_ACCOUNT_GOOGLE_CLIENT_SECRET=google_secret_1234567890$/m);
  assert.match(result, /^BEACON_ACCOUNT_APPLE_ENABLED=0$/m);
  assert.equal(
    result.replace(/^BEACON_ACCOUNT_GOOGLE_(?:ENABLED|CLIENT_ID|CLIENT_SECRET)=.*$/gm, ''),
    staging.replace(/^BEACON_ACCOUNT_GOOGLE_(?:ENABLED|CLIENT_ID|CLIENT_SECRET)=.*$/gm, ''),
  );
});

test('accepts a current bounded Apple JWT and preserves production isolation', () => {
  const secret = jwt();
  const result = buildSocialProviderActivation({
    accountContents: production,
    bundleContents: `BEACON_ACCOUNT_APPLE_CLIENT_ID=com.harmonicbeacon.account.staging\nBEACON_ACCOUNT_APPLE_CLIENT_SECRET=${secret}\n`,
    environment: 'production',
    provider: 'apple',
    nowSeconds: 2_000_000_100,
  });
  assert.match(result, /^BEACON_ACCOUNT_APPLE_ENABLED=1$/m);
  assert.match(result, /^BEACON_ACCOUNT_GOOGLE_ENABLED=0$/m);
});

test('rejects issuer mismatch, extra keys, enabled targets and invalid provider material', () => {
  const google = 'BEACON_ACCOUNT_GOOGLE_CLIENT_ID=x.apps.googleusercontent.com\nBEACON_ACCOUNT_GOOGLE_CLIENT_SECRET=google_secret_1234567890\n';
  const base = { accountContents: staging, environment: 'staging', provider: 'google' };
  assert.throws(() => buildSocialProviderActivation({ ...base, environment: 'production', bundleContents: google }), /issuer mismatch/);
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: `${google}UNEXPECTED=1\n` }), /only the exact/);
  assert.throws(() => buildSocialProviderActivation({
    ...base,
    accountContents: staging.replace('BEACON_ACCOUNT_GOOGLE_ENABLED=0', 'BEACON_ACCOUNT_GOOGLE_ENABLED=1'),
    bundleContents: google,
  }), /fully disabled/);
  assert.throws(() => buildSocialProviderActivation({
    ...base,
    bundleContents: 'BEACON_ACCOUNT_GOOGLE_CLIENT_ID=not-google\nBEACON_ACCOUNT_GOOGLE_CLIENT_SECRET=google_secret_1234567890\n',
  }), /client ID/);
});

test('rejects raw, expired, overlong, wrong-subject and noncanonical Apple secrets', () => {
  const make = (secret) => `BEACON_ACCOUNT_APPLE_CLIENT_ID=com.harmonicbeacon.account.staging\nBEACON_ACCOUNT_APPLE_CLIENT_SECRET=${secret}\n`;
  const base = {
    accountContents: staging,
    environment: 'staging',
    provider: 'apple',
    nowSeconds: 2_000_000_100,
  };
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: make('-----BEGIN PRIVATE KEY-----') }), /invalid/);
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: make(jwt({ exp: 2_000_000_099 })) }), /claims/);
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: make(jwt({ exp: 2_020_000_000 })) }), /claims/);
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: make(jwt({ sub: 'wrong' })) }), /claims/);
  assert.throws(() => buildSocialProviderActivation({ ...base, bundleContents: make(`${jwt()}=`) }), /invalid/);
});
