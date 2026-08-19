#!/usr/bin/env node

import { lstat, readFile } from 'node:fs/promises';
import process from 'node:process';

import { parseEnvironment } from './sync-secret.mjs';

const ISSUER = 'https://account.harmonicbeacon.com';
const CLIENT_ID = 'hb-listener';
const BUNDLE = '/run/listener-account-production.env';

function fail(message) {
  throw new Error(message);
}

async function jsonResponse(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => fail(`${url} did not return JSON`));
  return { response, body };
}

export async function productionAccountPreflight({ bundlePath = BUNDLE } = {}) {
  const metadata = await lstat(bundlePath);
  if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o777) !== 0o600) {
    fail('Listener production Account bundle must be a root:root mode-0600 regular file');
  }
  const bundle = parseEnvironment(await readFile(bundlePath, 'utf8'));
  const keys = [...bundle.keys()].sort();
  const expectedKeys = [
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
  ].sort();
  if (keys.join('\n') !== expectedKeys.join('\n')) fail('Listener production Account bundle key inventory mismatch');
  const clientSecret = bundle.get('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET') ?? '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(clientSecret)) fail('Listener production Account client secret is invalid');

  const { response: readyResponse, body: ready } = await jsonResponse(`${ISSUER}/api/account/health/ready`);
  if (!readyResponse.ok || ready?.status !== 'ok' || ready?.checks?.database !== 'ok' ||
      ready?.checks?.mail !== 'ok' || ready?.checks?.issuer !== 'ok' || ready?.checks?.jwks !== 'ok' ||
      ready?.checks?.clients !== 'ok' || ready?.checks?.providers !== 'ok') {
    fail('Account production readiness is unavailable or incomplete');
  }

  const { response: discoveryResponse, body: discovery } = await jsonResponse(
    `${ISSUER}/.well-known/openid-configuration`,
    { headers: { Accept: 'application/json' } },
  );
  if (!discoveryResponse.ok || discovery.issuer !== ISSUER) fail('Account production discovery mismatch');
  const endpoints = {
    authorization_endpoint: '/api/account/auth/oauth2/authorize',
    token_endpoint: '/api/account/auth/oauth2/token',
    jwks_uri: '/.well-known/jwks.json',
    introspection_endpoint: '/api/account/auth/oauth2/introspect',
    end_session_endpoint: '/api/account/auth/oauth2/end-session',
  };
  for (const [name, path] of Object.entries(endpoints)) {
    if (discovery[name] !== `${ISSUER}${path}`) fail(`Account production discovery ${name} mismatch`);
  }
  if (JSON.stringify(discovery.code_challenge_methods_supported) !== JSON.stringify(['S256']) ||
      JSON.stringify(discovery.token_endpoint_auth_methods_supported) !== JSON.stringify(['client_secret_basic'])) {
    fail('Account production discovery does not expose the frozen RP contract');
  }

  const { response: jwksResponse, body: jwks } = await jsonResponse(`${ISSUER}/.well-known/jwks.json`);
  const keyIds = Array.isArray(jwks.keys) ? jwks.keys.map((key) => key?.kid) : [];
  if (!jwksResponse.ok || !Array.isArray(jwks.keys) || jwks.keys.length < 1 ||
      jwks.keys.some((key) => typeof key?.kid !== 'string' || !key.kid || key.kty !== 'OKP' ||
        key.alg !== 'EdDSA' || key.crv !== 'Ed25519' || !/^[A-Za-z0-9_-]{43}$/.test(key.x ?? '') || key.d ||
        (key.use !== undefined && key.use !== 'sig') ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')))) ||
      new Set(keyIds).size !== keyIds.length) {
    fail('Account production JWKS is unavailable or invalid');
  }

  const basic = Buffer.from(`${CLIENT_ID}:${clientSecret}`, 'utf8').toString('base64');
  const { response: statusResponse, body: status } = await jsonResponse(`${ISSUER}/api/account/session-status`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ sid: 'listener-production-preflight', sub: 'listener-production-preflight' }),
  });
  if (!statusResponse.ok || status.active !== false ||
      !statusResponse.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
    fail('Account production Listener client authentication failed');
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  if (process.getuid?.() !== 0 || process.argv.length !== 2) {
    throw new Error('run as root without arguments');
  }
  productionAccountPreflight()
    .then(() => process.stdout.write('Listener production Account preflight passed without exposing secrets.\n'))
    .catch((error) => {
      process.stderr.write(`Listener production Account preflight failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exitCode = 1;
    });
}
