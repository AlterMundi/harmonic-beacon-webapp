#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const ACCOUNT_ENV = '/run/account-production.env';
const LISTENER_ENV = '/run/listener-production.env';
const CURRENT_BUNDLE = '/run/work/current.env';
const CANDIDATE_BUNDLE = '/run/work/candidate.env';

function fail(message) {
  throw new Error(message);
}

export function parseEnvironment(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) fail('invalid environment file');
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || values.has(key)) {
      fail('invalid or duplicate environment key');
    }
    values.set(key, value);
  }
  return values;
}

function exact(values, key, expected, label) {
  if (values.get(key) !== expected) fail(`${label} ${key} mismatch`);
}

function secret(values, key, label) {
  const value = values.get(key) ?? '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) fail(`${label} ${key} is invalid`);
  return value;
}

export function buildProductionBundle({ accountContents, listenerContents, currentContents = '' }) {
  const account = parseEnvironment(accountContents);
  const listener = parseEnvironment(listenerContents);
  const current = parseEnvironment(currentContents);

  exact(account, 'BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com', 'Account production');
  exact(listener, 'EARLY_BIRDS_AUTH_BASE_URL', 'https://listen.harmonicbeacon.com', 'Listener production');
  const enabled = listener.get('BEACON_LISTENER_ACCOUNT_ENABLED') ?? '0';
  if (enabled !== '0') fail('Listener Account must remain disabled while preparing the bundle');
  for (const key of [
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING',
  ]) {
    if (listener.has(key) && listener.get(key) !== '') fail(`Listener runtime ${key} must be absent while disabled`);
  }

  const clientSecret = secret(account, 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', 'Account production');
  const currentKeys = [...current.keys()].sort();
  if (currentKeys.length > 0 && currentKeys.join('\n') !== [
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET',
    'BEACON_LISTENER_ACCOUNT_STATE_SECRET',
  ].sort().join('\n')) {
    fail('current Listener Account bundle contains unexpected keys');
  }
  const stateSecret = current.has('BEACON_LISTENER_ACCOUNT_STATE_SECRET')
    ? secret(current, 'BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'current Listener bundle')
    : randomBytes(32).toString('base64url');
  if (stateSecret === clientSecret) fail('Listener client and state secrets must differ');

  return [
    `BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=${clientSecret}`,
    `BEACON_LISTENER_ACCOUNT_STATE_SECRET=${stateSecret}`,
    '',
  ].join('\n');
}

async function main() {
  if (process.getuid?.() !== 0) fail('run as root');
  if (process.argv.length !== 2) fail('this command accepts no paths or secret values');
  const currentContents = await readFile(CURRENT_BUNDLE, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const bundle = buildProductionBundle({
    accountContents: await readFile(ACCOUNT_ENV, 'utf8'),
    listenerContents: await readFile(LISTENER_ENV, 'utf8'),
    currentContents,
  });
  await writeFile(CANDIDATE_BUNDLE, bundle, { flag: 'wx', mode: 0o600 });
  process.stdout.write('Listener production Account bundle prepared; feature remains OFF.\n');
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`Listener production Account bundle failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
